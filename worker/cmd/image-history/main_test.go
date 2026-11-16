package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	narraw "narra-image-worker/internal/worker"
)

const historyCommandVolumeID = "326e32fb-6e71-4ef7-a41b-6a88db3f2343"

type historyCommandReader struct {
	narraw.ImageHistoryReadRepository
	page     narraw.ImageHistoryScanPage
	scans    int
	readOnly bool
}

func (reader *historyCommandReader) ScanImageHistory(_ context.Context, input narraw.ImageHistoryScanInput) (narraw.ImageHistoryScanPage, error) {
	reader.scans++
	if !reader.readOnly || input.Limit < 1 || input.Limit > narraw.ImageHistoryPageSize {
		return narraw.ImageHistoryScanPage{}, errors.New("non-read-only/unbounded scanner")
	}
	return reader.page, nil
}

type historyCommandMutationCounts struct {
	writerSessions     int
	writerFactories    int
	inspectorFactories int
	manifestFileOpens  int
	closed             int
}

func historyCommandFixture(t *testing.T) (historyCommandDeps, []byte, string, *historyCommandMutationCounts) {
	t.Helper()
	rootPath := t.TempDir()
	localCfg := narraw.LocalImageStoreConfig{RootDirectory: rootPath, VolumeID: historyCommandVolumeID}
	if _, err := narraw.InitializeLocalImageVolume(context.Background(), localCfg); err != nil {
		t.Fatal(err)
	}
	local, err := narraw.NewLocalImageStore(localCfg)
	if err != nil {
		t.Fatal(err)
	}
	data, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	if _, err := local.Put(context.Background(), narraw.LocalImagePutInput{LocalImageObject: narraw.LocalImageObject{Key: "images/legacy.png", ByteLength: int64(len(data)), SHA256: hex.EncodeToString(digest[:])}, Bytes: data}); err != nil {
		t.Fatal(err)
	}
	location, _ := narraw.NewImageLocalLocation(historyCommandVolumeID)
	owner := "fixture-owner"
	snapshotHash := strings.Repeat("a", 64)
	sourceURL := "https://images.invalid/images/legacy.png?signature=private-value"
	snapshot, _ := json.Marshal(map[string]any{"id": "legacy-image", "ownerId": owner, "sourceProvider": "LOCAL", "storageLocation": location.ID,
		"storageEndpoint": nil, "storageRegion": nil, "storageBucket": nil, "storageKey": "images/legacy.png", "mediaAssetId": nil})
	reader := &historyCommandReader{page: narraw.ImageHistoryScanPage{UpperBound: "2026-11-15T00:00:00Z", Candidates: []narraw.ImageHistoryCandidate{{
		SubjectKind: "CANVAS_IMPORT", SubjectID: "legacy-image", OwnerID: &owner, ExactURL: &sourceURL, SnapshotHash: snapshotHash,
		Snapshot:       snapshot,
		Classification: "SOURCE_BINDING_REQUIRED", CreatedAt: "2026-11-01T00:00:00Z",
	}}}}
	manifest, err := json.Marshal(narraw.ImageHistoryManifest{SchemaVersion: 1, Locations: []narraw.ImageLocationInput{location}, Bindings: []narraw.ImageHistorySourceBinding{{
		SubjectKind: "CANVAS_IMPORT", SubjectID: "legacy-image", ExpectedSnapshotHash: snapshotHash, LocationID: location.ID, Key: "images/legacy.png", OwnerID: owner,
	}}})
	if err != nil {
		t.Fatal(err)
	}
	counts := &historyCommandMutationCounts{}
	deps := historyCommandDeps{
		loadURL: func() (string, error) { return "postgres://fixture-only", nil },
		loadStorage: func() (narraw.Config, error) {
			return narraw.Config{ImageStoragePath: rootPath, ImageStorageVolumeID: historyCommandVolumeID}, nil
		},
		open: func(_ context.Context, _ string, apply bool) (historyCommandSession, error) {
			if apply {
				counts.writerSessions++
			}
			reader.readOnly = !apply
			return historyCommandSession{reader: reader, verify: func(context.Context) error { return nil }, close: func() { counts.closed++ }}, nil
		},
		openManifest: func(string) (io.ReadCloser, error) {
			counts.manifestFileOpens++
			return nil, errors.New("unexpected manifest file open")
		},
		newInspector: func(cfg narraw.Config, locations []narraw.ImageLocationInput) (narraw.ImageHistoryReadOnlyIO, error) {
			counts.inspectorFactories++
			return narraw.NewImageHistoryInspector(cfg, locations)
		},
		newWriter: func(narraw.Config, []narraw.ImageLocationInput) (narraw.ImageHistoryApplyIO, error) {
			counts.writerFactories++
			return nil, errors.New("unexpected writer construction")
		},
	}
	return deps, manifest, rootPath, counts
}

func TestImageHistoryDefaultCommandInitializesOnlyReadOnlyDependencies(t *testing.T) {
	deps, manifest, _, counts := historyCommandFixture(t)
	var output bytes.Buffer
	exitCode := runImageHistoryCommand(context.Background(), []string{"--bindings", "-", "--target-location", "local-v1:" + historyCommandVolumeID}, bytes.NewReader(manifest), &output, deps)
	if exitCode != 0 || counts.writerSessions != 0 || counts.writerFactories != 0 || counts.manifestFileOpens != 0 || counts.inspectorFactories != 1 || counts.closed != 1 {
		t.Fatalf("default command enabled mutations: counts=%+v exit=%d output=%s", counts, exitCode, output.String())
	}
	var result historyCommandResult
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.DryRun || result.Plan == nil || result.Plan.Scanned != 1 || result.Plan.VerifiedSourceBytes == 0 || !result.Plan.TargetReadVerified || result.Plan.TargetWritableVerified {
		t.Fatalf("unexpected read-only report: %s", output.String())
	}
	if strings.Contains(output.String(), "private-value") || strings.Contains(output.String(), "fixture-only") {
		t.Fatal("inventory leaked credentials/signed query")
	}
}

func TestImageHistoryCommandRejectsAmbiguousMutationFlagsBeforeInitialization(t *testing.T) {
	for _, args := range [][]string{
		{"--dry-run=false"}, {"--apply", "--dry-run"}, {"--retire-source"},
		{"--apply", "--cursor", "opaque"}, {"--item-id", "value"}, {"--limit", "0"},
		{"--limit", "1001"}, {"--timeout", "48h"}, {"--unknown-token", "never-print-this"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			deps := historyCommandDeps{loadURL: func() (string, error) { t.Fatal("invalid flags reached configuration"); return "", nil }}
			var output bytes.Buffer
			if code := runImageHistoryCommand(context.Background(), args, strings.NewReader(""), &output, deps); code != 1 {
				t.Fatalf("invalid flags accepted: %s", output.String())
			}
			if strings.Contains(output.String(), "never-print-this") {
				t.Fatal("parser exposed raw supplied arguments")
			}
		})
	}
}

func TestImageHistoryCommandHelpAndEmptyDiscoveryNeedNoStorageConfiguration(t *testing.T) {
	var help bytes.Buffer
	if code := runImageHistoryCommand(context.Background(), []string{"--help"}, strings.NewReader(""), &help, historyCommandDeps{}); code != 0 {
		t.Fatalf("help required runtime dependencies: %d", code)
	}
	reader := &historyCommandReader{readOnly: true, page: narraw.ImageHistoryScanPage{UpperBound: "2026-11-15T00:00:00Z", Candidates: []narraw.ImageHistoryCandidate{}}}
	deps := historyCommandDeps{
		loadURL: func() (string, error) { return "fixture", nil },
		loadStorage: func() (narraw.Config, error) {
			t.Fatal("empty discovery read storage credentials")
			return narraw.Config{}, nil
		},
		open: func(_ context.Context, _ string, apply bool) (historyCommandSession, error) {
			if apply {
				t.Fatal("discovery selected writer session")
			}
			return historyCommandSession{reader: reader, verify: func(context.Context) error { return nil }, close: func() {}}, nil
		},
		newInspector: func(cfg narraw.Config, locations []narraw.ImageLocationInput) (narraw.ImageHistoryReadOnlyIO, error) {
			return narraw.NewImageHistoryInspector(cfg, locations)
		},
	}
	var output bytes.Buffer
	if code := runImageHistoryCommand(context.Background(), nil, strings.NewReader(""), &output, deps); code != 0 {
		t.Fatalf("empty discovery failed: %d %s", code, output.String())
	}
}

func TestImageHistoryCommandManifestBoundAndSafeDatabaseErrors(t *testing.T) {
	deps := historyCommandDeps{loadURL: func() (string, error) { return "", errors.New("postgres://user:secret@real.example/app") }}
	var output bytes.Buffer
	code := runImageHistoryCommand(context.Background(), []string{"--bindings", "-"}, strings.NewReader(strings.Repeat(" ", narraw.ImageHistoryManifestMaxBytes+1)), &output, deps)
	if code != 1 || !strings.Contains(output.String(), "IMAGE_INVALID_INPUT") {
		t.Fatalf("unbounded manifest accepted: %s", output.String())
	}
	output.Reset()
	code = runImageHistoryCommand(context.Background(), nil, strings.NewReader(""), &output, deps)
	if code != 1 || strings.Contains(output.String(), "secret") || strings.Contains(output.String(), "real.example") {
		t.Fatalf("raw configuration error escaped: %s", output.String())
	}
}

type historyWaitingManifest struct {
	*io.PipeReader
	started chan struct{}
	once    sync.Once
}

func (reader *historyWaitingManifest) Read(buffer []byte) (int, error) {
	reader.once.Do(func() { close(reader.started) })
	return reader.PipeReader.Read(buffer)
}

func TestImageHistoryCommandCancellationInterruptsManifestPipeBeforeDependencies(t *testing.T) {
	pipe, writer := io.Pipe()
	defer writer.Close()
	reader := &historyWaitingManifest{PipeReader: pipe, started: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var output bytes.Buffer
	finished := make(chan int, 1)
	deps := historyCommandDeps{loadURL: func() (string, error) {
		t.Error("cancelled manifest opened database dependencies")
		return "", errors.New("unexpected")
	}}
	go func() { finished <- runImageHistoryCommand(ctx, []string{"--bindings", "-"}, reader, &output, deps) }()
	select {
	case <-reader.started:
	case <-time.After(time.Second):
		t.Fatal("command never began manifest read")
	}
	cancel()
	select {
	case code := <-finished:
		if code != 1 || !strings.Contains(output.String(), "IMAGE_HISTORY_INTERRUPTED") {
			t.Fatalf("cancelled stdin was not stopped safely: %d %s", code, output.String())
		}
	case <-time.After(time.Second):
		t.Fatal("command ignored cancellation while reading manifest stdin")
	}
}

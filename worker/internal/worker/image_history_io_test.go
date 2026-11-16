package worker

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func imageHistoryPNG(t *testing.T) []byte {
	t.Helper()
	data, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func imageHistoryExpected(data []byte) *ImageHistoryExpectedContent {
	digest := sha256.Sum256(data)
	return &ImageHistoryExpectedContent{ByteLength: int64(len(data)), SHA256: hex.EncodeToString(digest[:]), MimeType: "image/png"}
}

func requireImageHistoryCode(t *testing.T, err error, code string) {
	t.Helper()
	if err == nil || err.Error() != code {
		t.Fatalf("want safe code %s, got %v", code, err)
	}
}

func TestImageHistoryLocalInspectReadsActualContentAndRetainsImmutableProof(t *testing.T) {
	local, cfg := localImageFixture(t)
	data := imageHistoryPNG(t)
	put := localImageInput(data)
	if _, err := local.Put(context.Background(), put); err != nil {
		t.Fatal(err)
	}
	location, _ := NewImageLocalLocation(cfg.VolumeID)
	inspector, err := NewImageHistoryInspector(Config{ImageStoragePath: cfg.RootDirectory, ImageStorageVolumeID: cfg.VolumeID}, []ImageLocationInput{location})
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		actual, err := inspector.Inspect(context.Background(), location, put.Key, imageHistoryExpected(data), true)
		if err != nil || actual.ReadResult != "FULL" || actual.ByteLength == nil || *actual.ByteLength != int64(len(data)) || !bytes.Equal(actual.Data, data) || !actual.LocalFinalImmutable || !imagePublicTokenPattern.MatchString(actual.WriterProofSHA256) {
			t.Fatalf("unexpected local observation: %+v %v", actual, err)
		}
	}
	// Head merely repeats the registered hash. The history reader must discover
	// same-length corruption and may not use that metadata as verification.
	objectName, _, _ := LocalImageObjectNames(put.Key)
	corrupted := bytes.Clone(data)
	corrupted[len(corrupted)-1] ^= 1
	if err := os.WriteFile(filepath.Join(cfg.RootDirectory, objectName), corrupted, 0o600); err != nil {
		t.Fatal(err)
	}
	actual, err := inspector.Inspect(context.Background(), location, put.Key, imageHistoryExpected(data), true)
	requireImageHistoryCode(t, err, "CONTENT_MISMATCH")
	if actual.Data != nil || actual.LocalFinalImmutable || actual.WriterProofSHA256 != "" {
		t.Fatal("failed content observation exposed reusable bytes/proof")
	}
	assertLocalImageFiles(t, cfg.RootDirectory, 2)
}

func TestImageHistoryLocalInspectorNeverPreparesVolumeOrRemovesStaging(t *testing.T) {
	rootPath := t.TempDir()
	location, _ := NewImageLocalLocation(localImageTestVolumeID)
	inspector, err := NewImageHistoryInspector(Config{ImageStoragePath: rootPath, ImageStorageVolumeID: localImageTestVolumeID}, []ImageLocationInput{location})
	if err != nil {
		t.Fatal(err)
	}
	if err := inspector.Verify(context.Background(), location); err == nil {
		t.Fatal("missing marker reported ready")
	}
	assertLocalImageFiles(t, rootPath, 0)
	if _, err := InitializeLocalImageVolume(context.Background(), LocalImageStoreConfig{RootDirectory: rootPath, VolumeID: localImageTestVolumeID}); err != nil {
		t.Fatal(err)
	}
	_, stageName, _ := LocalImageObjectNames("images/stale.png")
	stagePath := filepath.Join(rootPath, stageName)
	if err := os.WriteFile(stagePath, []byte("part of an interrupted upload"), 0o600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-365 * 24 * time.Hour)
	if err := os.Chtimes(stagePath, old, old); err != nil {
		t.Fatal(err)
	}
	actual, err := inspector.Inspect(context.Background(), location, "images/stale.png", nil, false)
	requireImageHistoryCode(t, err, "WRITE_PENDING")
	if actual.ReadResult == "MISSING" || actual.ReadResult == "FULL" {
		t.Fatal("stale staging was used as missing/publication proof")
	}
	contents, err := os.ReadFile(stagePath)
	if err != nil || string(contents) != "part of an interrupted upload" {
		t.Fatal("read-only observation altered abandoned staging")
	}
	assertLocalImageFiles(t, rootPath, 2)
}

func TestImageHistoryLocalInspectorRechecksStageAfterActualRead(t *testing.T) {
	local, cfg := localImageFixture(t)
	data := imageHistoryPNG(t)
	put := localImageInput(data)
	if _, err := local.Put(context.Background(), put); err != nil {
		t.Fatal(err)
	}
	location, _ := NewImageLocalLocation(cfg.VolumeID)
	store := &imageHistoryLocalStore{local: local, location: location}
	root, err := os.OpenRoot(cfg.RootDirectory)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	_, stageName, _ := LocalImageObjectNames(put.Key)
	checks := 0
	hooked := localImageLookupHookRoot{Root: root, afterLstat: func(name string, _ os.FileInfo, _ error) {
		if name == stageName {
			checks++
			if checks == 2 {
				if err := os.WriteFile(filepath.Join(cfg.RootDirectory, stageName), []byte("late writer"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
		}
	}}
	actual, err := store.inspectRoot(context.Background(), hooked, put.Key, imageHistoryExpected(data), false)
	if err == nil || actual.LocalFinalImmutable || actual.ReadResult == "FULL" {
		t.Fatalf("concurrent staging was accepted: %+v %v", actual, err)
	}
	assertLocalImageFiles(t, cfg.RootDirectory, 3)
}

type imageHistoryS3Fixture struct {
	mu          sync.Mutex
	data        []byte
	heads       int
	gets        int
	puts        int
	deletes     int
	wrongGet    bool
	versioned   bool
	changedHead bool
	tooLarge    bool
	deny        bool
}

func newImageHistoryS3Fixture(t *testing.T) (*imageHistoryS3Fixture, ImageLocationInput, Config) {
	t.Helper()
	fixture := &imageHistoryS3Fixture{data: imageHistoryPNG(t)}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		fixture.mu.Lock()
		defer fixture.mu.Unlock()
		if !strings.HasPrefix(request.Header.Get("Authorization"), "AWS4-HMAC-SHA256 ") {
			t.Error("S3 inspector omitted exact credential authentication")
		}
		if request.URL.Path == "/history" && request.URL.Query().Has("versioning") {
			response.Header().Set("Content-Type", "application/xml")
			_, _ = io.WriteString(response, `<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>`)
			return
		}
		if request.URL.Path != "/history/images/source.png" {
			t.Errorf("unbound key accessed: %s", request.URL.Path)
			response.WriteHeader(http.StatusForbidden)
			return
		}
		if fixture.deny {
			response.WriteHeader(http.StatusForbidden)
			return
		}
		response.Header().Set("ETag", `"fixture-content"`)
		response.Header().Set("Last-Modified", "Sun, 15 Nov 2026 10:00:00 GMT")
		response.Header().Set("Content-Type", "image/png")
		if fixture.versioned {
			response.Header().Set("x-amz-version-id", "unexpected-version")
		}
		switch request.Method {
		case http.MethodHead:
			fixture.heads++
			length := int64(len(fixture.data))
			if fixture.tooLarge {
				length = ImageHistoryObservationMaxBytes + 1
			}
			response.Header().Set("Content-Length", strconv.FormatInt(length, 10))
			if fixture.changedHead && fixture.heads > 1 {
				response.Header().Set("ETag", `"changed-after-read"`)
			}
		case http.MethodGet:
			fixture.gets++
			if request.Header.Get("If-Match") != `"fixture-content"` {
				t.Error("GET did not bind the HEAD object identity")
			}
			content := bytes.Clone(fixture.data)
			if fixture.wrongGet {
				content[len(content)-1] ^= 1
			}
			response.Header().Set("Content-Length", strconv.Itoa(len(content)))
			_, _ = response.Write(content)
		case http.MethodPut:
			fixture.puts++
			if request.Header.Get("If-None-Match") != "*" {
				t.Error("COPY PUT omitted immutable create-only precondition")
			}
			data, _ := io.ReadAll(io.LimitReader(request.Body, ImageMaxBytes+1))
			fixture.data = data
		case http.MethodDelete:
			fixture.deletes++
		default:
			t.Errorf("unexpected request method %s", request.Method)
		}
	}))
	t.Cleanup(server.Close)
	location, err := NewImageS3Location(server.URL, "auto", "history", "")
	if err != nil {
		t.Fatal(err)
	}
	return fixture, location, Config{S3AccessKeyID: "isolated-history-access", S3SecretAccessKey: "isolated-history-secret"}
}

func TestImageHistoryS3ReadbackUsesFullContentAndHasZeroMutations(t *testing.T) {
	fixture, location, cfg := newImageHistoryS3Fixture(t)
	inspector, err := NewImageHistoryInspector(cfg, []ImageLocationInput{location})
	if err != nil {
		t.Fatal(err)
	}
	actual, err := inspector.Inspect(context.Background(), location, "images/source.png", imageHistoryExpected(fixture.data), true)
	if err != nil || actual.ReadResult != "FULL" || actual.VersionEvidence != "UNVERSIONED" || !bytes.Equal(actual.Data, fixture.data) || actual.LocalFinalImmutable || actual.WriterProofSHA256 != "" {
		t.Fatalf("unexpected S3 result: %+v %v", actual, err)
	}
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	if fixture.puts != 0 || fixture.deletes != 0 || fixture.heads != 2 || fixture.gets != 1 {
		t.Fatalf("unexpected IO counts: %+v", fixture)
	}
}

func TestImageHistoryS3MismatchesAndVersionEvidenceRetainSource(t *testing.T) {
	for _, scenario := range []string{"wrong-content", "versioned", "changed", "too-large", "denied"} {
		t.Run(scenario, func(t *testing.T) {
			fixture, location, cfg := newImageHistoryS3Fixture(t)
			fixture.wrongGet = scenario == "wrong-content"
			fixture.versioned = scenario == "versioned"
			fixture.changedHead = scenario == "changed"
			fixture.tooLarge = scenario == "too-large"
			fixture.deny = scenario == "denied"
			inspector, err := NewImageHistoryInspector(cfg, []ImageLocationInput{location})
			if err != nil {
				t.Fatal(err)
			}
			actual, err := inspector.Inspect(context.Background(), location, "images/source.png", imageHistoryExpected(fixture.data), true)
			if err == nil || actual.Data != nil || actual.LocalFinalImmutable {
				t.Fatalf("invalid object supplied copy bytes: %+v %v", actual, err)
			}
			fixture.mu.Lock()
			defer fixture.mu.Unlock()
			if fixture.puts != 0 || fixture.deletes != 0 {
				t.Fatal("inspection mutated source")
			}
			if scenario == "too-large" && (fixture.gets != 0 || actual.ByteLength == nil || *actual.ByteLength != ImageHistoryObservationMaxBytes+1) {
				t.Fatal("over-bound object was downloaded or its known bytes hidden")
			}
			if scenario == "versioned" && (actual.VersionEvidence != "VERSIONED" || actual.VersionID != "unexpected-version") {
				t.Fatal("known version receipt was dropped during error normalization")
			}
		})
	}
}

func TestImageHistoryS3NeverFollowsObjectRedirectOrUsesCandidateEndpoint(t *testing.T) {
	fixture, location, cfg := newImageHistoryS3Fixture(t)
	requests := 0
	transport := canvasTestRoundTripper(func(request *http.Request) (*http.Response, error) {
		requests++
		if request.URL.Query().Has("versioning") {
			return canvasTestStorageResponse(request, 200, `<VersioningConfiguration/>`), nil
		}
		response := canvasTestStorageResponse(request, http.StatusTemporaryRedirect, "")
		response.Header.Set("Location", "https://unbound.invalid/private")
		return response, nil
	})
	inspector, err := newImageHistoryInspector(cfg, []ImageLocationInput{location}, transport)
	if err != nil {
		t.Fatal(err)
	}
	_, err = inspector.Inspect(context.Background(), location, "images/source.png", imageHistoryExpected(fixture.data), false)
	if err == nil || requests != 2 {
		t.Fatalf("redirect or implicit retries occurred: %d %v", requests, err)
	}
	other, _ := NewImageS3Location("https://unbound.invalid", "auto", "history", "")
	_, err = inspector.Inspect(context.Background(), other, "images/source.png", nil, false)
	requireImageHistoryCode(t, err, "IMAGE_LOCATION_CONFLICT")
	if requests != 2 {
		t.Fatal("an unbound namespace reached the network")
	}
}

func TestImageHistoryObservationLengthBoundAndCancellation(t *testing.T) {
	data := imageHistoryPNG(t)
	for _, length := range []int64{int64(len(data) - 1), int64(len(data) + 1)} {
		_, err := readImageHistoryContent(context.Background(), bytes.NewReader(data), length, nil, true)
		requireImageHistoryCode(t, err, "CONTENT_MISMATCH")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := readImageHistoryContent(ctx, bytes.NewReader(data), int64(len(data)), nil, true)
	if err == nil || errors.Is(err, io.EOF) {
		t.Fatal("cancelled observation reported success")
	}
}

package worker

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestImageMaintenanceContractRejectsLegacyRevisionTwo(t *testing.T) {
	data, err := readImageContractArtifact("maintenance.json", 16*1024)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateImageMaintenanceContract(data); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"storageRevision", "readerRevision", "executorRevision"} {
		t.Run(field, func(t *testing.T) {
			var contract map[string]json.RawMessage
			if err := json.Unmarshal(data, &contract); err != nil {
				t.Fatal(err)
			}
			contract[field] = json.RawMessage("2")
			legacy, err := json.Marshal(contract)
			if err != nil {
				t.Fatal(err)
			}
			if err := validateImageMaintenanceContract(legacy); err == nil {
				t.Fatal("legacy revision 2 was advertised as history-compatible")
			}
		})
	}
}

type fakeImageMaintenanceRepository struct {
	mu        sync.Mutex
	locations []ImageLocation
	claims    [][]ImageDeleteClaim
	finished  []ImageFinishMaintenanceInput
	finish    func(ImageFinishMaintenanceInput) (ImageDeleteReceipt, error)
	denyLease bool
	tokens    []string
	releases  int
	queued    chan struct{}
}

func (repo *fakeImageMaintenanceRepository) VerifySchema(context.Context) error { return nil }

func (repo *fakeImageMaintenanceRepository) ListMaintenanceLocations(context.Context) ([]ImageLocation, error) {
	return repo.locations, nil
}
func (repo *fakeImageMaintenanceRepository) AcquireMaintenanceLease(_ context.Context, input ImageMaintenanceLeaseInput) (bool, error) {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	repo.tokens = append(repo.tokens, input.Token)
	return !repo.denyLease, nil
}
func (repo *fakeImageMaintenanceRepository) ReleaseMaintenanceLease(context.Context, ImageMaintenanceLeaseInput) (bool, error) {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	repo.releases++
	return true, nil
}
func (repo *fakeImageMaintenanceRepository) EnqueueDueCleanup(context.Context) (*ImageMaintenanceJob, error) {
	select {
	case repo.queued <- struct{}{}:
	default:
	}
	return nil, nil
}
func (repo *fakeImageMaintenanceRepository) CloseExpiredReservations(context.Context, int) (ImageReservationCleanupResult, error) {
	return ImageReservationCleanupResult{}, nil
}
func (repo *fakeImageMaintenanceRepository) ClaimMaintenance(context.Context, ImageClaimMaintenanceInput) ([]ImageDeleteClaim, error) {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	if len(repo.claims) == 0 {
		return nil, nil
	}
	result := repo.claims[0]
	repo.claims = repo.claims[1:]
	return result, nil
}
func (repo *fakeImageMaintenanceRepository) FinishMaintenanceObject(_ context.Context, input ImageFinishMaintenanceInput) (ImageDeleteReceipt, error) {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	repo.finished = append(repo.finished, input)
	if repo.finish != nil {
		return repo.finish(input)
	}
	return ImageDeleteReceipt{Accepted: true}, nil
}

func imageMaintenanceClaim(location ImageLocation, object LocalImageObject) ImageDeleteClaim {
	token := "00112233-4455-4677-8899-aabbccddeeff"
	expires := time.Now().Add(time.Minute)
	expiresText := expires.Format(time.RFC3339Nano)
	return ImageDeleteClaim{JobID: "00112233-4455-4677-8899-aabbccddeeff", ItemID: "11223344-5566-4788-99aa-bbccddeeff00", Mode: "MANUAL_ALL",
		Location: location, DeleteToken: token, DeleteExpiresAt: expires,
		Object: ImageObjectRecord{ID: "22334455-6677-4899-aabb-ccddeeff0011", AssetID: "33445566-7788-49aa-bbcc-ddeeff001122",
			LocationID: location.ID, PhysicalNamespace: location.PhysicalNamespace, Key: object.Key, ByteLength: object.ByteLength, SHA256: object.SHA256,
			MimeType: "image/png", Provenance: "WRITE", State: "DELETING", PutOutcome: "CONFIRMED", Accounted: true, DeleteToken: &token, DeleteExpiresAt: &expiresText}}
}

func TestImageMaintenanceUsesPersistedObservedAndReconciledProof(t *testing.T) {
	for _, scenario := range []string{"observed", "reconciled", "missing-observation", "unknown-unreconciled", "versioned-observation"} {
		t.Run(scenario, func(t *testing.T) {
			_, adapter, claim, config := imageMaintenanceLocalFixture(t)
			proofID := "44556677-8899-4abb-8cdd-eeff00112233"
			claim.Mode = "SOURCE_RETIREMENT"
			claim.Object.Provenance = "OBSERVED"
			claim.Object.PutOutcome = "NOT_APPLICABLE"
			claim.Object.SourceObservationID = &proofID
			switch scenario {
			case "reconciled":
				claim.Object.Provenance = "WRITE"
				claim.Object.SourceObservationID = nil
				claim.Object.PutOutcome = "UNKNOWN"
				claim.Object.ReconciliationObservationID = &proofID
			case "missing-observation":
				claim.Object.SourceObservationID = nil
			case "unknown-unreconciled":
				claim.Object.Provenance = "WRITE"
				claim.Object.SourceObservationID = nil
				claim.Object.PutOutcome = "UNKNOWN"
			case "versioned-observation":
				version := "unexpected-version"
				claim.Object.VersionID = &version
			}
			outcome, err := adapter.Delete(context.Background(), claim)
			name, _, _ := LocalImageObjectNames(claim.Object.Key)
			_, statErr := os.Stat(filepath.Join(config.RootDirectory, name))
			allowed := scenario == "observed" || scenario == "reconciled"
			if allowed {
				if err != nil || outcome != "DELETED" || !errors.Is(statErr, os.ErrNotExist) {
					t.Fatalf("verified physical source not deleted: outcome=%s error=%v stat=%v", outcome, err, statErr)
				}
			} else if err == nil || statErr != nil {
				t.Fatalf("unproven source was deleted: outcome=%s error=%v stat=%v", outcome, err, statErr)
			}
		})
	}
}

func imageMaintenanceLocalFixture(t *testing.T) (*Storage, imageMaintenanceStorage, ImageDeleteClaim, LocalImageStoreConfig) {
	t.Helper()
	local, config := localImageFixture(t)
	object := localImageInput([]byte("retained physical image"))
	if _, err := local.Put(context.Background(), object); err != nil {
		t.Fatal(err)
	}
	identity, _ := NewImageLocalLocation(config.VolumeID)
	location := ImageLocation{ImageLocationInput: identity, PhysicalNamespace: identity.ID}
	storage := &Storage{cfg: Config{ImageStorageManagedEnabled: true, ImageStorageBackend: "local", ImageStoragePath: config.RootDirectory, ImageStorageVolumeID: config.VolumeID}, localImages: local}
	adapter, err := storage.maintenanceStorage(context.Background(), location)
	if err != nil {
		t.Fatal(err)
	}
	return storage, adapter, imageMaintenanceClaim(location, object.LocalImageObject), config
}

func imageMaintenanceTestScheduler(t *testing.T, repo imageMaintenanceRepository, adapter imageMaintenanceStorage) *imageMaintenanceScheduler {
	t.Helper()
	scheduler, err := newImageMaintenanceScheduler("maintenance-test-worker", repo, func(context.Context, ImageLocation) (imageMaintenanceStorage, error) { return adapter, nil }, nil)
	if err != nil {
		t.Fatal(err)
	}
	scheduler.canClaim = func() bool { return true }
	scheduler.checkReady = func(context.Context) error { return nil }
	return scheduler
}

func TestImageMaintenanceDeletesRealLocalBytesAndUsesReceiptDelta(t *testing.T) {
	_, adapter, claim, config := imageMaintenanceLocalFixture(t)
	repo := &fakeImageMaintenanceRepository{locations: []ImageLocation{claim.Location}, claims: [][]ImageDeleteClaim{{claim}, {claim}}}
	completed := false
	repo.finish = func(input ImageFinishMaintenanceInput) (ImageDeleteReceipt, error) {
		if !completed {
			if input.Outcome != "DELETED" {
				t.Fatalf("first receipt: %+v", input)
			}
			completed = true
			return ImageDeleteReceipt{Accepted: true, ReleasedBytes: claim.Object.ByteLength}, nil
		}
		if input.Outcome != "MISSING" {
			t.Fatalf("repeat exact key did not observe missing: %+v", input)
		}
		return ImageDeleteReceipt{Accepted: true, Replayed: true, ReleasedBytes: 0}, nil
	}
	scheduler := imageMaintenanceTestScheduler(t, repo, adapter)
	scheduler.runPass(context.Background())
	name, _, _ := LocalImageObjectNames(claim.Object.Key)
	if _, err := os.Stat(filepath.Join(config.RootDirectory, name)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("physical file still exists: %v", err)
	}
	if len(repo.finished) != 2 || scheduler.snapshot(true).ReclaimedBytes != claim.Object.ByteLength {
		t.Fatal("replayed finalizer doubled physical reclamation")
	}
}

func TestImageMaintenanceProtectsPendingUnknownAndExpiredDeletes(t *testing.T) {
	for _, scenario := range []string{"pending-file", "unknown-put", "versioned", "expired-claim", "lease-held-elsewhere"} {
		t.Run(scenario, func(t *testing.T) {
			_, adapter, claim, config := imageMaintenanceLocalFixture(t)
			name, staging, _ := LocalImageObjectNames(claim.Object.Key)
			switch scenario {
			case "pending-file":
				if err := os.WriteFile(filepath.Join(config.RootDirectory, staging), []byte("pending"), 0o600); err != nil {
					t.Fatal(err)
				}
			case "unknown-put":
				claim.Object.PutOutcome = "UNKNOWN"
			case "versioned":
				version := "null"
				claim.Object.VersionID = &version
			case "expired-claim":
				claim.DeleteExpiresAt = time.Now().Add(-time.Second)
			}
			repo := &fakeImageMaintenanceRepository{locations: []ImageLocation{claim.Location}, claims: [][]ImageDeleteClaim{{claim}}, denyLease: scenario == "lease-held-elsewhere"}
			scheduler := imageMaintenanceTestScheduler(t, repo, adapter)
			scheduler.runPass(context.Background())
			if _, err := os.Stat(filepath.Join(config.RootDirectory, name)); err != nil {
				t.Fatalf("protected image removed: %v", err)
			}
			if scheduler.snapshot(true).ReclaimedBytes != 0 {
				t.Fatal("failure reported reclaimed bytes")
			}
			if scenario == "lease-held-elsewhere" && len(repo.finished) != 0 {
				t.Fatal("non-owner reached finalizer")
			}
		})
	}
}

func TestImageMaintenanceKeepsUnacknowledgedDeleteAsRecoveryWork(t *testing.T) {
	_, adapter, claim, config := imageMaintenanceLocalFixture(t)
	repo := &fakeImageMaintenanceRepository{locations: []ImageLocation{claim.Location}, claims: [][]ImageDeleteClaim{{claim}},
		finish: func(ImageFinishMaintenanceInput) (ImageDeleteReceipt, error) {
			return ImageDeleteReceipt{}, errors.New("lost database acknowledgement")
		}}
	scheduler := imageMaintenanceTestScheduler(t, repo, adapter)
	scheduler.runPass(context.Background())
	name, _, _ := LocalImageObjectNames(claim.Object.Key)
	if _, err := os.Stat(filepath.Join(config.RootDirectory, name)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("fixture did not exercise real deletion")
	}
	if metrics := scheduler.snapshot(true); metrics.ReclaimedBytes != 0 || metrics.FinalizationFailures != 1 {
		t.Fatalf("unconfirmed accounting: %+v", metrics)
	}
}

func TestImageMaintenanceS3DeletesOnlyVerifiedExactObjects(t *testing.T) {
	for _, scenario := range []string{"deleted", "missing", "denied", "server-error", "delete-marker", "version-id", "version-changed"} {
		t.Run(scenario, func(t *testing.T) {
			var probes, deletes atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.Method == http.MethodGet && request.URL.Path == "/images" && request.URL.Query().Has("versioning") {
					probe := probes.Add(1)
					writer.Header().Set("Content-Type", "application/xml")
					if scenario == "version-changed" && probe > 1 {
						_, _ = writer.Write([]byte("<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>"))
					} else {
						_, _ = writer.Write([]byte("<VersioningConfiguration/>"))
					}
					return
				}
				// The SDK may append its operation identifier; no version selector
				// or other query may change this exact bucket/key deletion.
				validDeleteQuery := request.URL.RawQuery == "" || request.URL.RawQuery == "x-id=DeleteObject"
				if request.Method != http.MethodDelete || request.URL.Path != "/images/images/fixture.png" || !validDeleteQuery {
					t.Errorf("wrong physical operation: %s %s", request.Method, request.URL)
					writer.WriteHeader(500)
					return
				}
				deletes.Add(1)
				switch scenario {
				case "missing":
					writer.WriteHeader(404)
					_, _ = writer.Write([]byte("<Error><Code>NoSuchKey</Code></Error>"))
				case "denied":
					writer.WriteHeader(403)
					_, _ = writer.Write([]byte("<Error><Code>AccessDenied</Code></Error>"))
				case "server-error":
					writer.WriteHeader(500)
					_, _ = writer.Write([]byte("<Error><Code>InternalError</Code></Error>"))
				default:
					if scenario == "delete-marker" {
						writer.Header().Set("x-amz-delete-marker", "false")
					}
					if scenario == "version-id" {
						writer.Header().Set("x-amz-version-id", "null")
					}
					writer.WriteHeader(204)
				}
			}))
			defer server.Close()
			identity, err := NewImageS3Location(server.URL, "us-east-1", "images", "")
			if err != nil {
				t.Fatal(err)
			}
			location := ImageLocation{ImageLocationInput: identity, PhysicalNamespace: identity.ID}
			storage := &Storage{cfg: Config{ImageStorageManagedEnabled: true, S3AccessKeyID: "fixture", S3SecretAccessKey: "fixture"}}
			adapter, err := storage.maintenanceStorage(context.Background(), location)
			if err != nil {
				t.Fatal(err)
			}
			if err := adapter.Verify(context.Background()); err != nil {
				t.Fatal(err)
			}
			claim := imageMaintenanceClaim(location, localImageInput([]byte("bytes")).LocalImageObject)
			outcome, err := adapter.Delete(context.Background(), claim)
			success := scenario == "deleted" || scenario == "missing"
			expectedOutcome := canvasDeleteUnknown
			switch scenario {
			case "deleted":
				expectedOutcome = canvasDeleteDeleted
			case "missing":
				expectedOutcome = canvasDeleteMissing
			case "denied", "server-error":
				expectedOutcome = canvasDeleteFailed
			}
			if (err == nil) != success || outcome != expectedOutcome {
				t.Fatalf("invalid receipt %q: %v", outcome, err)
			}
			if scenario == "version-changed" && deletes.Load() != 0 {
				t.Fatal("deleted after version capability changed")
			}
			if scenario != "version-changed" && deletes.Load() != 1 {
				t.Fatal("physical delete was retried outside durable queue")
			}
		})
	}
}

func TestManagedWorkerStartsOneImageMaintenanceLoopAndJoinsOnShutdown(t *testing.T) {
	for _, mode := range []RuntimeMode{RuntimeModeDedicated, RuntimeModeEmbedded} {
		t.Run(string(mode), func(t *testing.T) {
			worker, baseURL := newRuntimeTestWorker(t, func(ctx context.Context, _ context.Context, _ int) { <-ctx.Done() })
			worker.cfg.RuntimeMode, worker.cfg.Concurrency, worker.cfg.ImageStorageManagedEnabled = mode, 4, true
			worker.cfg.ImageStorageBackend, worker.cfg.ImageStorageVolumeID = "local", localImageTestVolumeID
			worker.storageFactory = func(context.Context, Config) (*Storage, error) { return &Storage{cfg: worker.cfg}, nil }
			worker.checkImageStorage = func(context.Context) error { return nil }
			repo := &fakeImageMaintenanceRepository{queued: make(chan struct{}, 1)}
			worker.imageRepository = repo
			var starts atomic.Int32
			worker.imageSchedulerRunner = func(ctx context.Context, scheduler *imageMaintenanceScheduler) { starts.Add(1); scheduler.Run(ctx) }
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() { done <- worker.Run(ctx) }()
			waitForSignal(t, repo.queued, time.Second, "managed image scheduling without a browser")
			status, payload := getRuntimeJSON(t, baseURL+"/readyz")
			if status != 200 {
				t.Fatalf("managed worker not ready: %v", payload)
			}
			images := payload["capabilities"].(map[string]any)["images"].(map[string]any)
			if images["storageRevision"] != float64(ImageStorageRevision) || images["executorRevision"] != float64(ImageMaintenanceRevision) || images["readerRevision"] != float64(ImageReaderRevision) || images["maintenance"] != "running" {
				t.Fatalf("old reader/executor advertised: %v", images)
			}
			cancel()
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Fatal("image scheduler was not joined")
			}
			if starts.Load() != 1 || worker.state.snapshot().ImageMaintenanceRunning || repo.releases != 1 {
				t.Fatal("per-consumer or leaked scheduler")
			}
		})
	}
}

func TestManagedWorkerFailsReadinessWhenImageSchedulerExits(t *testing.T) {
	worker, _ := newRuntimeTestWorker(t, func(ctx context.Context, _ context.Context, _ int) { <-ctx.Done() })
	worker.cfg.ImageStorageManagedEnabled = true
	worker.imageRepository = &fakeImageMaintenanceRepository{}
	worker.checkImageStorage = func(context.Context) error { return nil }
	worker.imageSchedulerRunner = func(context.Context, *imageMaintenanceScheduler) {}
	if err := worker.Run(context.Background()); err == nil {
		t.Fatal("dead image scheduler left worker running")
	}
	if worker.evaluateReadiness(context.Background()).Ready {
		t.Fatal("dead executor advertised ready")
	}
}

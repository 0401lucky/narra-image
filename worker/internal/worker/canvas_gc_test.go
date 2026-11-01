package worker

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

type canvasFinishCall struct{ assetID, token, outcome, code string }

type fakeCanvasGCRepository struct {
	mu             sync.Mutex
	assets         []canvasGCAsset
	tokens         []string
	claimLocations []string
	claimLimits    []int
	finishes       []canvasFinishCall
	leaseDenied    bool
	leaseErr       error
	claimErr       error
	finishErr      error
	finishLost     bool
	beforeAcquire  func()
	beforeClaim    func()
	afterFinish    chan struct{}
}

func (repository *fakeCanvasGCRepository) AcquireLease(ctx context.Context, token string) (bool, error) {
	if repository.beforeAcquire != nil {
		repository.beforeAcquire()
	}
	repository.mu.Lock()
	defer repository.mu.Unlock()
	repository.tokens = append(repository.tokens, token)
	if ctx.Err() != nil {
		return false, ctx.Err()
	}
	return !repository.leaseDenied, repository.leaseErr
}

func (repository *fakeCanvasGCRepository) ClaimImports(ctx context.Context, _ string, location string, limit int) ([]canvasGCAsset, error) {
	if repository.beforeClaim != nil {
		repository.beforeClaim()
	}
	repository.mu.Lock()
	defer repository.mu.Unlock()
	repository.claimLocations = append(repository.claimLocations, location)
	repository.claimLimits = append(repository.claimLimits, limit)
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	return append([]canvasGCAsset(nil), repository.assets...), repository.claimErr
}

func (repository *fakeCanvasGCRepository) FinishDelete(ctx context.Context, id, token, outcome, code string) (bool, error) {
	repository.mu.Lock()
	defer repository.mu.Unlock()
	repository.finishes = append(repository.finishes, canvasFinishCall{id, token, outcome, code})
	if repository.afterFinish != nil {
		select {
		case repository.afterFinish <- struct{}{}:
		default:
		}
	}
	if ctx.Err() != nil {
		return false, ctx.Err()
	}
	return !repository.finishLost, repository.finishErr
}

type fakeCanvasGCStorage struct {
	location CanvasStorageLocation
	verify   func(context.Context) error
	remove   func(context.Context, canvasGCAsset) (string, error)
}

func (storage *fakeCanvasGCStorage) Location() CanvasStorageLocation { return storage.location }
func (storage *fakeCanvasGCStorage) Verify(ctx context.Context) error {
	if storage.verify != nil {
		return storage.verify(ctx)
	}
	return nil
}
func (storage *fakeCanvasGCStorage) Delete(ctx context.Context, asset canvasGCAsset) (string, error) {
	if storage.remove != nil {
		return storage.remove(ctx, asset)
	}
	return canvasDeleteDeleted, nil
}

func runtimeCanvasContract(t *testing.T) CanvasContract {
	t.Helper()
	contract, err := LoadCanvasContract()
	if err != nil {
		t.Fatalf("load actual canvas contract: %v", err)
	}
	return contract
}

func runtimeCanvasLocation(t *testing.T) CanvasStorageLocation {
	t.Helper()
	location, err := NewCanvasStorageLocation("https://storage.example.invalid", "auto", "imports")
	if err != nil {
		t.Fatal(err)
	}
	return location
}

func runtimeCanvasAsset(t *testing.T) canvasGCAsset {
	t.Helper()
	location := runtimeCanvasLocation(t)
	return canvasGCAsset{
		ID: "asset-1", OwnerID: "owner-1", Kind: "IMPORT", State: "DELETING",
		StorageLocation: location.ID, StorageEndpoint: location.Endpoint, StorageRegion: location.Region,
		StorageBucket: location.Bucket, StorageKey: "canvas-imports/original.png",
		DeleteToken: "b45212b5-28a9-490e-a834-13d3c3b50932", ByteLength: 900,
		PutOutcome: "CONFIRMED", PhysicalBytesAccounted: true,
	}
}

func runtimeCanvasScheduler(t *testing.T, repository *fakeCanvasGCRepository, storage *fakeCanvasGCStorage) *canvasGCScheduler {
	t.Helper()
	if storage == nil {
		storage = &fakeCanvasGCStorage{location: runtimeCanvasLocation(t)}
	}
	scheduler, err := newCanvasGCScheduler(Config{}, runtimeCanvasContract(t), repository, storage, nil)
	if err != nil {
		t.Fatal(err)
	}
	scheduler.canClaim = func() bool { return true }
	scheduler.checkReady = storage.Verify
	return scheduler
}

func TestCanvasGCUsesSharedBoundsAndRenewableRuntimeToken(t *testing.T) {
	repository := &fakeCanvasGCRepository{}
	scheduler := runtimeCanvasScheduler(t, repository, nil)
	contract := runtimeCanvasContract(t)
	if scheduler.interval != time.Duration(contract.Limits.GcIntervalSeconds)*time.Second ||
		scheduler.batchSize != contract.Limits.GcBatchSize ||
		scheduler.passTimeout != time.Duration(contract.Limits.SweepTimeoutSeconds)*time.Second ||
		scheduler.deleteTimeout != time.Duration(contract.Limits.DeleteTimeoutSeconds)*time.Second {
		t.Fatal("scheduler does not consume shared limits")
	}
	for range 3 {
		scheduler.runPass(context.Background())
	}
	if len(repository.tokens) != 3 || len(repository.tokens[0]) != 36 || repository.tokens[0] != repository.tokens[1] || repository.tokens[1] != repository.tokens[2] {
		t.Fatalf("each pass must renew one runtime UUID, got %v", repository.tokens)
	}
	if !reflect.DeepEqual(repository.claimLimits, []int{20, 20, 20}) || repository.claimLocations[0] != runtimeCanvasLocation(t).ID {
		t.Fatalf("claims did not use bounded current location: %+v", repository)
	}
	for _, cfg := range []Config{{CanvasAssetGCInterval: 59 * time.Second}, {CanvasAssetGCBatchSize: -1}, {CanvasAssetGCBatchSize: 101}} {
		if _, err := newCanvasGCScheduler(cfg, contract, repository, scheduler.storage, nil); err == nil {
			t.Fatalf("invalid config accepted: %+v", cfg)
		}
	}
}

func TestCanvasGCStopsBeforeClaimOnDrainAndLeaseLoss(t *testing.T) {
	for _, where := range []string{"before-pass", "after-probe", "after-lease", "denied", "error"} {
		t.Run(where, func(t *testing.T) {
			claimable := true
			repository := &fakeCanvasGCRepository{}
			scheduler := runtimeCanvasScheduler(t, repository, nil)
			scheduler.canClaim = func() bool { return claimable }
			switch where {
			case "before-pass":
				claimable = false
			case "after-probe":
				scheduler.checkReady = func(context.Context) error { claimable = false; return nil }
			case "after-lease":
				repository.beforeAcquire = func() { claimable = false }
			case "denied":
				repository.leaseDenied = true
			case "error":
				repository.leaseErr = errors.New("database down")
			}
			scheduler.runPass(context.Background())
			if len(repository.claimLimits) != 0 {
				t.Fatal("claimed after drain or a failed fleet lease")
			}
		})
	}
}

func TestCanvasGCDefersOnReadinessFailureAndOverlargeClaim(t *testing.T) {
	for _, code := range []error{errCanvasSchemaNotReady, errCanvasGenerationSchemaNotReady, errCanvasStorageCapability} {
		repository := &fakeCanvasGCRepository{}
		scheduler := runtimeCanvasScheduler(t, repository, nil)
		scheduler.checkReady = func(context.Context) error { return code }
		scheduler.runPass(context.Background())
		if len(repository.tokens) != 0 || scheduler.snapshot(true).LastErrorCode != canvasGCErrorCode(code) {
			t.Fatal("readiness failure was not fenced/observed")
		}
	}
	repository := &fakeCanvasGCRepository{assets: []canvasGCAsset{runtimeCanvasAsset(t), runtimeCanvasAsset(t)}}
	scheduler := runtimeCanvasScheduler(t, repository, nil)
	scheduler.batchSize = 1
	scheduler.runPass(context.Background())
	if len(repository.finishes) != 0 || scheduler.snapshot(true).LastErrorCode != "CANVAS_INTERNAL_ERROR" {
		t.Fatal("oversized batch was not rejected")
	}
}

func TestCanvasGCFinalizationOwnsAccountingAndBackoff(t *testing.T) {
	for _, scenario := range []struct {
		name             string
		outcome          string
		failure          error
		putUnknown, lost bool
		wantBytes        int64
		wantCode         string
	}{
		{name: "deleted", outcome: canvasDeleteDeleted, wantBytes: 900},
		{name: "missing", outcome: canvasDeleteMissing, wantBytes: 900},
		{name: "late-put-tombstone", outcome: canvasDeleteDeleted, putUnknown: true},
		{name: "late-put-missing", outcome: canvasDeleteMissing, putUnknown: true},
		{name: "old-delete-token", outcome: canvasDeleteDeleted, lost: true, wantCode: "CANVAS_LEASE_LOST"},
		{name: "denied", outcome: canvasDeleteFailed, failure: errors.New("denied"), wantCode: "CANVAS_STORAGE_UNAVAILABLE"},
		{name: "timed-out", outcome: canvasDeleteUnknown, failure: context.DeadlineExceeded, wantCode: "CANVAS_STORAGE_UNAVAILABLE"},
		{name: "invalid-success", outcome: canvasDeleteDeleted, failure: errors.New("failed receipt"), wantCode: "CANVAS_STORAGE_UNAVAILABLE"},
		{name: "versioned", outcome: canvasDeleteUnknown, failure: errCanvasStorageCapability, wantCode: "CANVAS_STORAGE_CAPABILITY_INVALID"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			asset := runtimeCanvasAsset(t)
			if scenario.putUnknown {
				asset.PutOutcome = "UNKNOWN"
				asset.State = "DELETED"
			}
			repository := &fakeCanvasGCRepository{assets: []canvasGCAsset{asset}, finishLost: scenario.lost}
			storage := &fakeCanvasGCStorage{location: runtimeCanvasLocation(t), remove: func(context.Context, canvasGCAsset) (string, error) { return scenario.outcome, scenario.failure }}
			scheduler := runtimeCanvasScheduler(t, repository, storage)
			scheduler.runPass(context.Background())
			metrics := scheduler.snapshot(true)
			if metrics.ReclaimedBytes != scenario.wantBytes || metrics.LastErrorCode != scenario.wantCode {
				t.Fatalf("incorrect accounting/failure: %+v", metrics)
			}
			if len(repository.finishes) != 1 || repository.finishes[0].token != asset.DeleteToken || repository.finishes[0].assetID != asset.ID {
				t.Fatal("finalization lost immutable asset fence")
			}
			if scenario.failure != nil && repository.finishes[0].outcome != canvasDeleteFailed && repository.finishes[0].outcome != canvasDeleteUnknown {
				t.Fatal("remote failure finalized as reclaimed")
			}
		})
	}
}

func TestCanvasGCPassAndObjectsAreSequentialAndBounded(t *testing.T) {
	repository := &fakeCanvasGCRepository{assets: []canvasGCAsset{runtimeCanvasAsset(t), runtimeCanvasAsset(t), runtimeCanvasAsset(t)}}
	active, maximum, attempts := 0, 0, 0
	storage := &fakeCanvasGCStorage{location: runtimeCanvasLocation(t), remove: func(ctx context.Context, _ canvasGCAsset) (string, error) {
		active++
		attempts++
		if active > maximum {
			maximum = active
		}
		<-ctx.Done()
		active--
		return canvasDeleteUnknown, ctx.Err()
	}}
	scheduler := runtimeCanvasScheduler(t, repository, storage)
	scheduler.passTimeout, scheduler.deleteTimeout = 25*time.Millisecond, 15*time.Millisecond
	started := time.Now()
	scheduler.runPass(context.Background())
	if elapsed := time.Since(started); elapsed > 250*time.Millisecond {
		t.Fatalf("pass exceeded its bound: %s", elapsed)
	}
	if maximum != 1 || attempts != 2 || scheduler.snapshot(true).ReclaimedBytes != 0 {
		t.Fatalf("invalid remote concurrency/accounting: maximum=%d attempts=%d", maximum, attempts)
	}
}

func TestCanvasGCStopsBatchOnCapabilityLoss(t *testing.T) {
	repository := &fakeCanvasGCRepository{assets: []canvasGCAsset{runtimeCanvasAsset(t), runtimeCanvasAsset(t)}}
	deletes := 0
	storage := &fakeCanvasGCStorage{location: runtimeCanvasLocation(t), remove: func(context.Context, canvasGCAsset) (string, error) {
		deletes++
		return canvasDeleteUnknown, errCanvasStorageCapability
	}}
	scheduler := runtimeCanvasScheduler(t, repository, storage)
	scheduler.runPass(context.Background())
	if deletes != 1 || len(repository.finishes) != 1 {
		t.Fatal("continued deleting after unknown/versioned storage")
	}
}

func TestCanvasGCOnlyDeletesValidRegisteredImports(t *testing.T) {
	for name, edit := range map[string]func(*canvasGCAsset){
		"generated":          func(a *canvasGCAsset) { a.Kind = "GENERATED" },
		"legacy":             func(a *canvasGCAsset) { a.Kind = "LEGACY" },
		"ready":              func(a *canvasGCAsset) { a.State = "READY" },
		"missing-owner":      func(a *canvasGCAsset) { a.OwnerID = "" },
		"missing-fence":      func(a *canvasGCAsset) { a.DeleteToken = "" },
		"version-id":         func(a *canvasGCAsset) { value := "null"; a.StorageVersionID = &value },
		"different-endpoint": func(a *canvasGCAsset) { a.StorageEndpoint = "https://another.example.invalid" },
		"different-region":   func(a *canvasGCAsset) { a.StorageRegion = "other" },
		"different-bucket":   func(a *canvasGCAsset) { a.StorageBucket = "other" },
		"different-hash":     func(a *canvasGCAsset) { a.StorageLocation = "wrong" },
		"url-not-key":        func(a *canvasGCAsset) { a.StorageKey = "https://example.invalid/image.png" },
		"traversal":          func(a *canvasGCAsset) { a.StorageKey = "canvas-imports/../original.png" },
		"encoded-traversal":  func(a *canvasGCAsset) { a.StorageKey = "%2e%2e/original.png" },
		"long-key":           func(a *canvasGCAsset) { a.StorageKey = strings.Repeat("a", 513) },
		"control-key":        func(a *canvasGCAsset) { a.StorageKey = "image\n.png" },
	} {
		t.Run(name, func(t *testing.T) {
			asset := runtimeCanvasAsset(t)
			edit(&asset)
			repository := &fakeCanvasGCRepository{assets: []canvasGCAsset{asset}}
			storage := &fakeCanvasGCStorage{location: runtimeCanvasLocation(t), remove: func(context.Context, canvasGCAsset) (string, error) {
				t.Fatal("invalid inventory reached S3")
				return "", nil
			}}
			scheduler := runtimeCanvasScheduler(t, repository, storage)
			scheduler.runPass(context.Background())
			if scheduler.snapshot(true).ReclaimedBytes != 0 || repository.finishes[0].outcome != canvasDeleteUnknown {
				t.Fatal("invalid asset was treated as reclaimed")
			}
		})
	}
}

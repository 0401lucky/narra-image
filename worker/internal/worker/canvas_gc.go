package worker

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

const canvasDatabaseTimeout = 2 * time.Second

var (
	errCanvasSchemaNotReady           = errors.New("CANVAS_SCHEMA_CONTRACT_MISMATCH")
	errCanvasGenerationSchemaNotReady = errors.New("SCHEMA_NOT_READY")
)

type canvasGCMetrics struct {
	Running              bool   `json:"running"`
	Passes               int64  `json:"passes"`
	LeaseMisses          int64  `json:"lease_misses"`
	Claimed              int64  `json:"claimed"`
	Deleted              int64  `json:"deleted"`
	Missing              int64  `json:"missing"`
	DeleteFailures       int64  `json:"delete_failures"`
	FinalizationFailures int64  `json:"finalization_failures"`
	ReclaimedBytes       int64  `json:"reclaimed_bytes"`
	LastErrorCode        string `json:"last_error_code,omitempty"`
}

type canvasGCScheduler struct {
	contract      CanvasContract
	repository    canvasGCRepository
	storage       canvasGCStorage
	checkReady    func(context.Context) error
	canClaim      func() bool
	logger        *slog.Logger
	sweepToken    string
	interval      time.Duration
	batchSize     int
	passTimeout   time.Duration
	deleteTimeout time.Duration
	ticker        func(time.Duration) (<-chan time.Time, func())
	metricsMu     sync.Mutex
	metrics       canvasGCMetrics
}

func newCanvasGCScheduler(cfg Config, contract CanvasContract, repository canvasGCRepository, storage canvasGCStorage, logger *slog.Logger) (*canvasGCScheduler, error) {
	if repository == nil || storage == nil {
		return nil, errors.New("canvas GC dependencies are not configured")
	}
	interval := cfg.CanvasAssetGCInterval
	if interval == 0 {
		interval = time.Duration(contract.Limits.GcIntervalSeconds) * time.Second
	}
	batchSize := cfg.CanvasAssetGCBatchSize
	if batchSize == 0 {
		batchSize = contract.Limits.GcBatchSize
	}
	if interval < time.Duration(contract.Limits.GcIntervalSeconds)*time.Second || batchSize < 1 || batchSize > contract.Limits.MaximumGcBatchSize {
		return nil, errors.New("canvas GC controls are outside the shared contract bounds")
	}
	var identity [16]byte
	if _, err := rand.Read(identity[:]); err != nil {
		return nil, err
	}
	identity[6] = (identity[6] & 0x0f) | 0x40
	identity[8] = (identity[8] & 0x3f) | 0x80
	// Keep one token for this runtime: a fresh token every 60s would collide
	// with our own still-valid 90s fleet lease instead of renewing it.
	token := fmt.Sprintf("%x-%x-%x-%x-%x", identity[:4], identity[4:6], identity[6:8], identity[8:10], identity[10:])
	return &canvasGCScheduler{
		contract: contract, repository: repository, storage: storage, logger: logger,
		sweepToken: token, interval: interval, batchSize: batchSize,
		passTimeout:   time.Duration(contract.Limits.SweepTimeoutSeconds) * time.Second,
		deleteTimeout: time.Duration(contract.Limits.DeleteTimeoutSeconds) * time.Second,
		ticker: func(interval time.Duration) (<-chan time.Time, func()) {
			ticker := time.NewTicker(interval)
			return ticker.C, ticker.Stop
		},
	}, nil
}

func (scheduler *canvasGCScheduler) snapshot(running bool) canvasGCMetrics {
	scheduler.metricsMu.Lock()
	defer scheduler.metricsMu.Unlock()
	snapshot := scheduler.metrics
	snapshot.Running = running
	return snapshot
}

func (scheduler *canvasGCScheduler) record(update func(*canvasGCMetrics)) {
	scheduler.metricsMu.Lock()
	defer scheduler.metricsMu.Unlock()
	update(&scheduler.metrics)
}

func (scheduler *canvasGCScheduler) Run(ctx context.Context) {
	ticks, stop := scheduler.ticker(scheduler.interval)
	defer stop()
	for {
		if ctx.Err() != nil {
			return
		}
		scheduler.runPass(ctx)
		select {
		case <-ctx.Done():
			return
		case _, ok := <-ticks:
			if !ok {
				return // Worker.Run treats an unexpected scheduler exit as fatal.
			}
		}
	}
}

func (scheduler *canvasGCScheduler) runPass(runtimeCtx context.Context) {
	ctx, cancel := context.WithTimeout(runtimeCtx, scheduler.passTimeout)
	defer cancel()
	if ctx.Err() != nil || scheduler.canClaim == nil || !scheduler.canClaim() {
		return
	}
	scheduler.record(func(metrics *canvasGCMetrics) { metrics.Passes++ })
	if scheduler.checkReady == nil {
		scheduler.fail("CANVAS_INTERNAL_ERROR")
		return
	}
	if err := scheduler.checkReady(ctx); err != nil {
		scheduler.fail(canvasGCErrorCode(err))
		return
	}
	if ctx.Err() != nil || !scheduler.canClaim() {
		return
	}
	leaseCtx, leaseCancel := context.WithTimeout(ctx, canvasDatabaseTimeout)
	acquired, err := scheduler.repository.AcquireLease(leaseCtx, scheduler.sweepToken)
	leaseCancel()
	if err != nil {
		scheduler.fail("CANVAS_INTERNAL_ERROR")
		return
	}
	if !acquired {
		scheduler.record(func(metrics *canvasGCMetrics) { metrics.LeaseMisses++ })
		return
	}
	if ctx.Err() != nil || !scheduler.canClaim() {
		return
	}
	claimCtx, claimCancel := context.WithTimeout(ctx, canvasDatabaseTimeout)
	assets, err := scheduler.repository.ClaimImports(claimCtx, scheduler.sweepToken, scheduler.storage.Location().ID, scheduler.batchSize)
	claimCancel()
	if err != nil || len(assets) > scheduler.batchSize {
		scheduler.fail("CANVAS_INTERNAL_ERROR")
		return
	}
	scheduler.record(func(metrics *canvasGCMetrics) { metrics.Claimed += int64(len(assets)) })
	for _, asset := range assets {
		if ctx.Err() != nil || !scheduler.canClaim() {
			return // Unfinished fences remain durable retry work; no DB/S3 hold.
		}
		outcome := canvasDeleteUnknown
		deleteErr := validateCanvasGCAsset(asset, scheduler.storage.Location())
		if deleteErr == nil {
			deleteCtx, deleteCancel := context.WithTimeout(ctx, scheduler.deleteTimeout)
			outcome, deleteErr = scheduler.storage.Delete(deleteCtx, asset)
			deleteCancel()
		}
		code := ""
		if deleteErr != nil {
			code = canvasGCErrorCode(deleteErr)
			if outcome != canvasDeleteFailed && outcome != canvasDeleteUnknown {
				outcome = canvasDeleteUnknown
			}
		} else if outcome != canvasDeleteDeleted && outcome != canvasDeleteMissing {
			outcome, code = canvasDeleteUnknown, "CANVAS_STORAGE_UNAVAILABLE"
		}
		if code != "" {
			scheduler.record(func(metrics *canvasGCMetrics) { metrics.DeleteFailures++ })
			scheduler.fail(code)
		}
		finishCtx, finishCancel := context.WithTimeout(ctx, canvasDatabaseTimeout)
		finished, finishErr := scheduler.repository.FinishDelete(finishCtx, asset.ID, asset.DeleteToken, outcome, code)
		finishCancel()
		if finishErr != nil || !finished {
			scheduler.record(func(metrics *canvasGCMetrics) { metrics.FinalizationFailures++ })
			scheduler.fail("CANVAS_LEASE_LOST")
		} else if outcome == canvasDeleteDeleted || outcome == canvasDeleteMissing {
			scheduler.record(func(metrics *canvasGCMetrics) {
				if outcome == canvasDeleteDeleted {
					metrics.Deleted++
				} else {
					metrics.Missing++
				}
				// UNKNOWN PUTs keep physical accounting even after a missing-key
				// receipt: the SQL tombstone must still reconcile a late write.
				if asset.PutOutcome == "CONFIRMED" && asset.PhysicalBytesAccounted {
					metrics.ReclaimedBytes += asset.ByteLength
				}
			})
		}
		if errors.Is(deleteErr, errCanvasStorageCapability) {
			return // Never continue a batch after observing versioned/unknown storage.
		}
	}
}

func (scheduler *canvasGCScheduler) fail(code string) {
	scheduler.record(func(metrics *canvasGCMetrics) { metrics.LastErrorCode = code })
	if scheduler.logger != nil {
		scheduler.logger.Warn("Canvas import GC operation deferred", "event", "canvas_gc_deferred", "error_code", code)
	}
}

func canvasGCErrorCode(err error) string {
	switch {
	case errors.Is(err, errCanvasStorageCapability):
		return "CANVAS_STORAGE_CAPABILITY_INVALID"
	case errors.Is(err, errCanvasGCAssetInvalid):
		return "CANVAS_INVALID_INPUT"
	case errors.Is(err, errCanvasSchemaNotReady):
		return "CANVAS_SCHEMA_CONTRACT_MISMATCH"
	case errors.Is(err, errCanvasGenerationSchemaNotReady):
		return "SCHEMA_NOT_READY"
	default:
		return "CANVAS_STORAGE_UNAVAILABLE"
	}
}

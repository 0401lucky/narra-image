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

type imageMaintenanceRepository interface {
	VerifySchema(context.Context) error
	ListMaintenanceLocations(context.Context) ([]ImageLocation, error)
	AcquireMaintenanceLease(context.Context, ImageMaintenanceLeaseInput) (bool, error)
	ReleaseMaintenanceLease(context.Context, ImageMaintenanceLeaseInput) (bool, error)
	EnqueueDueCleanup(context.Context) (*ImageMaintenanceJob, error)
	CloseExpiredReservations(context.Context, int) (ImageReservationCleanupResult, error)
	ClaimMaintenance(context.Context, ImageClaimMaintenanceInput) ([]ImageDeleteClaim, error)
	FinishMaintenanceObject(context.Context, ImageFinishMaintenanceInput) (ImageDeleteReceipt, error)
}

type imageMaintenanceMetrics struct {
	Running              bool   `json:"running"`
	Passes               int64  `json:"passes"`
	Claimed              int64  `json:"claimed"`
	LeaseMisses          int64  `json:"lease_misses"`
	DeleteFailures       int64  `json:"delete_failures"`
	FinalizationFailures int64  `json:"finalization_failures"`
	ReclaimedBytes       int64  `json:"reclaimed_bytes"`
	LastErrorCode        string `json:"last_error_code,omitempty"`
}

type imageMaintenanceScheduler struct {
	repository    imageMaintenanceRepository
	storage       func(context.Context, ImageLocation) (imageMaintenanceStorage, error)
	checkReady    func(context.Context) error
	canClaim      func() bool
	logger        *slog.Logger
	workerID      string
	token         string
	interval      time.Duration
	passTimeout   time.Duration
	deleteTimeout time.Duration
	ticker        func(time.Duration) (<-chan time.Time, func())
	metricsMu     sync.Mutex
	metrics       imageMaintenanceMetrics
}

func newImageMaintenanceToken() (string, error) {
	var identity [16]byte
	if _, err := rand.Read(identity[:]); err != nil {
		return "", err
	}
	identity[6], identity[8] = (identity[6]&0x0f)|0x40, (identity[8]&0x3f)|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", identity[:4], identity[4:6], identity[6:8], identity[8:10], identity[10:]), nil
}

func newImageMaintenanceScheduler(workerID string, repository imageMaintenanceRepository, storage func(context.Context, ImageLocation) (imageMaintenanceStorage, error), logger *slog.Logger) (*imageMaintenanceScheduler, error) {
	if workerID == "" || repository == nil || storage == nil {
		return nil, ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
	token, err := newImageMaintenanceToken()
	if err != nil {
		return nil, err
	}
	return &imageMaintenanceScheduler{
		repository: repository, storage: storage, workerID: workerID, token: token, logger: logger,
		interval:      time.Duration(ImageMaintenancePollMilliseconds) * time.Millisecond,
		passTimeout:   time.Duration(ImageMaintenancePassSeconds) * time.Second,
		deleteTimeout: time.Duration(ImageMaintenanceDeleteSeconds) * time.Second,
		ticker: func(interval time.Duration) (<-chan time.Time, func()) {
			ticker := time.NewTicker(interval)
			return ticker.C, ticker.Stop
		},
	}, nil
}

func (scheduler *imageMaintenanceScheduler) record(update func(*imageMaintenanceMetrics)) {
	scheduler.metricsMu.Lock()
	defer scheduler.metricsMu.Unlock()
	update(&scheduler.metrics)
}

func (scheduler *imageMaintenanceScheduler) snapshot(running bool) imageMaintenanceMetrics {
	scheduler.metricsMu.Lock()
	defer scheduler.metricsMu.Unlock()
	result := scheduler.metrics
	result.Running = running
	return result
}

func (scheduler *imageMaintenanceScheduler) fail(err error) {
	code := imageMaintenanceErrorCode(err)
	scheduler.record(func(metrics *imageMaintenanceMetrics) { metrics.LastErrorCode = code })
	if scheduler.logger != nil {
		scheduler.logger.Warn("Image maintenance deferred", "event", "image_maintenance_deferred", "error_code", code)
	}
}

func (scheduler *imageMaintenanceScheduler) Run(ctx context.Context) {
	ticks, stop := scheduler.ticker(scheduler.interval)
	defer stop()
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), canvasDatabaseTimeout)
		defer cancel()
		_, _ = scheduler.repository.ReleaseMaintenanceLease(releaseCtx, ImageMaintenanceLeaseInput{WorkerID: scheduler.workerID, Token: scheduler.token})
	}()
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
				return // Worker.Run turns an unexpected loop exit into a failure.
			}
		}
	}
}

func (scheduler *imageMaintenanceScheduler) runPass(runtimeCtx context.Context) {
	ctx, cancel := context.WithTimeout(runtimeCtx, scheduler.passTimeout)
	defer cancel()
	if scheduler.canClaim == nil || !scheduler.canClaim() || ctx.Err() != nil {
		return
	}
	scheduler.record(func(metrics *imageMaintenanceMetrics) { metrics.Passes++ })
	if scheduler.checkReady == nil {
		scheduler.fail(ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"})
		return
	}
	if err := scheduler.checkReady(ctx); err != nil {
		scheduler.fail(err)
		return
	}
	leaseCtx, leaseCancel := context.WithTimeout(ctx, canvasDatabaseTimeout)
	acquired, err := scheduler.repository.AcquireMaintenanceLease(leaseCtx, ImageMaintenanceLeaseInput{WorkerID: scheduler.workerID, Token: scheduler.token})
	leaseCancel()
	if err != nil {
		scheduler.fail(err)
		return
	}
	if !acquired {
		scheduler.record(func(metrics *imageMaintenanceMetrics) { metrics.LeaseMisses++ })
		return
	}
	if ctx.Err() != nil || !scheduler.canClaim() {
		return
	}
	maintenanceCtx, maintenanceCancel := context.WithTimeout(ctx, canvasDatabaseTimeout)
	_, err = scheduler.repository.CloseExpiredReservations(maintenanceCtx, 100)
	maintenanceCancel()
	if err != nil {
		scheduler.fail(err)
		return
	}
	queueCtx, queueCancel := context.WithTimeout(ctx, canvasDatabaseTimeout)
	_, err = scheduler.repository.EnqueueDueCleanup(queueCtx)
	queueCancel()
	if err != nil {
		scheduler.fail(err)
		return
	}
	locationsCtx, locationsCancel := context.WithTimeout(ctx, canvasDatabaseTimeout)
	locations, err := scheduler.repository.ListMaintenanceLocations(locationsCtx)
	locationsCancel()
	if err != nil {
		scheduler.fail(err)
		return
	}
	verified := make(map[string]imageMaintenanceStorage, len(locations))
	locationIDs := make([]string, 0, len(locations))
	for _, location := range locations {
		if ctx.Err() != nil || !scheduler.canClaim() {
			return
		}
		probeCtx, probeCancel := context.WithTimeout(ctx, canvasDatabaseTimeout)
		adapter, probeErr := scheduler.storage(probeCtx, location)
		if probeErr == nil {
			probeErr = adapter.Verify(probeCtx)
		}
		probeCancel()
		if probeErr != nil {
			scheduler.fail(probeErr)
			continue
		}
		verified[location.ID] = adapter
		locationIDs = append(locationIDs, location.ID)
	}
	for ctx.Err() == nil && scheduler.canClaim() {
		claimCtx, claimCancel := context.WithTimeout(ctx, canvasDatabaseTimeout)
		claims, claimErr := scheduler.repository.ClaimMaintenance(claimCtx, ImageClaimMaintenanceInput{ExecutorToken: scheduler.token, VerifiedLocationIDs: locationIDs})
		claimCancel()
		if claimErr != nil {
			scheduler.fail(claimErr)
			return
		}
		if len(claims) == 0 {
			return
		}
		scheduler.record(func(metrics *imageMaintenanceMetrics) { metrics.Claimed += int64(len(claims)) })
		for _, claim := range claims {
			if ctx.Err() != nil || !scheduler.canClaim() {
				return // Claimed but unfinished items retain their durable fences.
			}
			adapter, ok := verified[claim.Location.ID]
			if !ok {
				scheduler.fail(ImageStorageError{Code: "IMAGE_LOCATION_CONFLICT"})
				return
			}
			deadline := time.Now().Add(scheduler.deleteTimeout)
			if expiry := claim.DeleteExpiresAt.Add(-5 * time.Second); expiry.Before(deadline) {
				deadline = expiry
			}
			deleteCtx, deleteCancel := context.WithDeadline(ctx, deadline)
			outcome, deleteErr := adapter.Delete(deleteCtx, claim)
			deleteCancel()
			code := ""
			if deleteErr != nil {
				code = imageMaintenanceErrorCode(deleteErr)
				if outcome != canvasDeleteFailed && outcome != canvasDeleteUnknown {
					outcome = canvasDeleteUnknown
				}
			} else if outcome != canvasDeleteDeleted && outcome != canvasDeleteMissing {
				outcome, code = canvasDeleteUnknown, "IMAGE_STORAGE_UNAVAILABLE"
			}
			if code != "" {
				scheduler.record(func(metrics *imageMaintenanceMetrics) { metrics.DeleteFailures++ })
				scheduler.fail(ImageStorageError{Code: code})
			}
			// A completed DELETE can be acknowledged during drain; this does not
			// permit another physical operation and has its own short deadline.
			finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(runtimeCtx), canvasDatabaseTimeout)
			receipt, finishErr := scheduler.repository.FinishMaintenanceObject(finishCtx, ImageFinishMaintenanceInput{
				JobID: claim.JobID, ItemID: claim.ItemID, ObjectID: claim.Object.ID, DeleteToken: claim.DeleteToken, Outcome: outcome, ErrorCode: code,
			})
			finishCancel()
			if finishErr != nil || !receipt.Accepted {
				scheduler.record(func(metrics *imageMaintenanceMetrics) { metrics.FinalizationFailures++ })
				scheduler.fail(ImageStorageError{Code: "IMAGE_MAINTENANCE_CONFLICT"})
				return
			}
			scheduler.record(func(metrics *imageMaintenanceMetrics) { metrics.ReclaimedBytes += receipt.ReleasedBytes })
			if errors.Is(deleteErr, errCanvasStorageCapability) {
				return
			}
		}
	}
}

func (w *Worker) setupImageMaintenance() error {
	if err := LoadImageMaintenanceContract(); err != nil {
		return ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE", Cause: err}
	}
	if w.imageRepository == nil {
		w.imageRepository = NewImageRepository(w.pool)
	}
	storageFactory := w.imageStorageFactory
	if storageFactory == nil {
		storageFactory = w.storage.maintenanceStorage
	}
	scheduler, err := newImageMaintenanceScheduler(w.cfg.WorkerID, w.imageRepository, storageFactory, w.logger)
	if err != nil {
		return err
	}
	scheduler.canClaim = func() bool {
		state := w.state.snapshot()
		return state.Phase == runtimePhaseReady && state.TopologyHeld && state.ConsumersRunning && state.ImageMaintenanceRunning
	}
	scheduler.checkReady = func(ctx context.Context) error {
		probeCtx, cancel := context.WithTimeout(ctx, canvasDatabaseTimeout)
		defer cancel()
		if w.checkSchema == nil {
			return ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
		}
		if report, err := w.checkSchema(probeCtx); err != nil || !report.Ready() {
			return ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
		}
		// Idle queue polling only checks database contracts. Physical target
		// capabilities are verified after discovering pending locations, before
		// claims (and once more before each S3 DELETE).
		return w.imageRepository.VerifySchema(probeCtx)
	}
	w.imageMaintenance = scheduler
	w.state.markImageMaintenanceConfigured()
	return nil
}

func (w *Worker) probeImageStorage(ctx context.Context) error {
	if w.checkImageStorage != nil {
		return w.checkImageStorage(ctx)
	}
	if w.storage == nil {
		return ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
	return w.storage.verifyManagedImages(ctx)
}

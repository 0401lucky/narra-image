package worker

import (
	"context"
	"time"
)

func (w *Worker) setupCanvasRuntime(ctx context.Context) error {
	contract, err := w.canvasContractLoader()
	if err != nil {
		return err
	}
	storage, err := w.canvasStorageFactory(w.storage)
	if err != nil {
		return err
	}
	scheduler, err := newCanvasGCScheduler(w.cfg, contract, w.canvasRepository, storage, w.logger)
	if err != nil {
		return err
	}
	scheduler.canClaim = func() bool {
		snapshot := w.state.snapshot()
		return snapshot.Phase == runtimePhaseReady && snapshot.TopologyHeld && snapshot.ConsumersRunning && snapshot.CanvasGCRunning
	}
	scheduler.checkReady = func(ctx context.Context) error {
		probeCtx, cancel := context.WithTimeout(ctx, canvasDatabaseTimeout)
		defer cancel()
		if w.checkSchema == nil {
			return errCanvasGenerationSchemaNotReady
		}
		report, err := w.checkSchema(probeCtx)
		if err != nil || !report.Ready() {
			return errCanvasGenerationSchemaNotReady
		}
		return w.probeCanvasDependencies(probeCtx, storage)
	}
	// Publish dependencies once; the state mutex supplies the publication fence
	// for HTTP readers, which never inspect canvasGC before CanvasConfigured.
	w.canvasGC = scheduler
	w.state.markCanvasConfigured()
	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()
	for attempt := 1; ; attempt++ {
		if err := scheduler.checkReady(ctx); err == nil {
			return nil
		} else if attempt == 1 || attempt%30 == 0 {
			w.logger.Info("Waiting for canvas schema/storage readiness", "event", "canvas_startup_wait", "error_code", canvasGCErrorCode(err))
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (w *Worker) probeCanvasDependencies(ctx context.Context, storage canvasGCStorage) error {
	if w.checkCanvasSchema == nil {
		return errCanvasSchemaNotReady
	}
	report, err := w.checkCanvasSchema(ctx)
	if err != nil || !report.Ready() {
		return errCanvasSchemaNotReady
	}
	if storage == nil || storage.Verify(ctx) != nil {
		return errCanvasStorageCapability
	}
	return nil
}

func (w *Worker) canvasReadiness(ctx context.Context, snapshot runtimeSnapshot) readinessResult {
	if !snapshot.CanvasConfigured || w.canvasGC == nil {
		return readinessResult{Code: readinessCodeCanvasNotReady}
	}
	if err := w.probeCanvasDependencies(ctx, w.canvasGC.storage); err != nil {
		return readinessResult{Code: canvasGCErrorCode(err)}
	}
	if !w.state.snapshot().CanvasGCRunning {
		return readinessResult{Code: readinessCodeCanvasGCNotReady}
	}
	capability := w.canvasGC.contract.Capability.ReadyCapability
	return readinessResult{Ready: true, Canvas: &capability}
}

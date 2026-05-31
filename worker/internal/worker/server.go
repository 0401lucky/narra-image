package worker

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

type queueMetrics struct {
	OldestPendingAgeMs float64 `json:"oldest_pending_age_ms"`
	Pending            int64   `json:"pending"`
	Processing         int64   `json:"processing"`
}

type completionMetrics struct {
	DurationAvgMs   float64 `json:"duration_avg_ms"`
	DurationP95Ms   float64 `json:"duration_p95_ms"`
	DurationP99Ms   float64 `json:"duration_p99_ms"`
	Failed          int64   `json:"failed"`
	ProcessingAvgMs float64 `json:"processing_avg_ms"`
	QueuedAvgMs     float64 `json:"queued_avg_ms"`
	Succeeded       int64   `json:"succeeded"`
	SuccessRate     float64 `json:"success_rate"`
	WindowSeconds   int64   `json:"window_seconds"`
}

type metricsResponse struct {
	Completed   completionMetrics `json:"completed"`
	GeneratedAt string            `json:"generated_at"`
	Queue       queueMetrics      `json:"queue"`
	WorkerID    string            `json:"worker_id"`
}

func (w *Worker) runHTTPServer(ctx context.Context) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", w.handleHealth)
	mux.HandleFunc("/metrics", w.handleMetrics)

	server := &http.Server{
		Addr:              w.cfg.HTTPAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		w.logger.Info("Worker HTTP 服务已启动", "addr", w.cfg.HTTPAddr)
		errCh <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			return err
		}
		err := <-errCh
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func (w *Worker) handleHealth(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
	defer cancel()

	if err := w.pool.Ping(ctx); err != nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"database":  "down",
			"error":     err.Error(),
			"status":    "unhealthy",
			"worker_id": w.cfg.WorkerID,
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"database":     "ok",
		"generated_at": time.Now().UTC().Format(time.RFC3339),
		"status":       "ok",
		"worker_id":    w.cfg.WorkerID,
	})
}

func (w *Worker) handleMetrics(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(request.Context(), 5*time.Second)
	defer cancel()

	metrics, err := w.collectMetrics(ctx)
	if err != nil {
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"error":     err.Error(),
			"status":    "error",
			"worker_id": w.cfg.WorkerID,
		})
		return
	}

	writeJSON(writer, http.StatusOK, metrics)
}

func (w *Worker) collectMetrics(ctx context.Context) (metricsResponse, error) {
	since := time.Now().UTC().Add(-w.cfg.MetricsWindow)
	response := metricsResponse{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		WorkerID:    w.cfg.WorkerID,
	}

	err := w.pool.QueryRow(ctx, `
SELECT
  COUNT(*) FILTER (WHERE "workerManaged" = true AND status = 'PENDING'),
  COUNT(*) FILTER (WHERE "workerManaged" = true AND status = 'PROCESSING'),
  COUNT(*) FILTER (WHERE "workerManaged" = true AND status = 'SUCCEEDED' AND "completedAt" >= $1),
  COUNT(*) FILTER (WHERE "workerManaged" = true AND status = 'FAILED' AND "completedAt" >= $1)
FROM "GenerationJob"
`, since).Scan(
		&response.Queue.Pending,
		&response.Queue.Processing,
		&response.Completed.Succeeded,
		&response.Completed.Failed,
	)
	if err != nil {
		return metricsResponse{}, err
	}

	var oldestPendingAge sql.NullFloat64
	err = w.pool.QueryRow(ctx, `
SELECT (EXTRACT(EPOCH FROM (NOW() - MIN("createdAt"))) * 1000)::double precision
FROM "GenerationJob"
WHERE "workerManaged" = true AND status = 'PENDING'
`).Scan(&oldestPendingAge)
	if err != nil {
		return metricsResponse{}, err
	}
	if oldestPendingAge.Valid {
		response.Queue.OldestPendingAgeMs = oldestPendingAge.Float64
	}

	err = w.pool.QueryRow(ctx, `
SELECT
  COALESCE(AVG((EXTRACT(EPOCH FROM ("startedAt" - "createdAt")) * 1000)::double precision), 0),
  COALESCE(AVG((EXTRACT(EPOCH FROM ("completedAt" - COALESCE("startedAt", "createdAt"))) * 1000)::double precision), 0),
  COALESCE(AVG((EXTRACT(EPOCH FROM ("completedAt" - "createdAt")) * 1000)::double precision), 0),
  COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (EXTRACT(EPOCH FROM ("completedAt" - "createdAt")) * 1000)::double precision), 0),
  COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY (EXTRACT(EPOCH FROM ("completedAt" - "createdAt")) * 1000)::double precision), 0)
FROM "GenerationJob"
WHERE "workerManaged" = true
  AND "completedAt" IS NOT NULL
  AND "createdAt" >= $1
`, since).Scan(
		&response.Completed.QueuedAvgMs,
		&response.Completed.ProcessingAvgMs,
		&response.Completed.DurationAvgMs,
		&response.Completed.DurationP95Ms,
		&response.Completed.DurationP99Ms,
	)
	if err != nil {
		return metricsResponse{}, err
	}

	totalCompleted := response.Completed.Succeeded + response.Completed.Failed
	if totalCompleted > 0 {
		response.Completed.SuccessRate = float64(response.Completed.Succeeded) / float64(totalCompleted)
	}
	response.Completed.WindowSeconds = int64(w.cfg.MetricsWindow.Seconds())

	return response, nil
}

func writeJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(payload)
}

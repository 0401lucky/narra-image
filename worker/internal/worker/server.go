package worker

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"
)

const workerHTTPAPISchemaVersion = 1

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

type reliabilityMetrics struct {
	ErrorClassCounts map[string]int64 `json:"error_class_counts"`
	RetryAttempts    int64            `json:"retry_attempts"`
	RetryExhausted   int64            `json:"retry_exhausted"`
	UnknownHandoffs  int64            `json:"unknown_handoffs"`
}

type runtimeMetrics struct {
	Draining      bool         `json:"draining"`
	Mode          RuntimeMode  `json:"mode"`
	State         runtimePhase `json:"state"`
	UptimeSeconds int64        `json:"uptime_seconds"`
}

type metricsResponse struct {
	Completed     completionMetrics  `json:"completed"`
	GeneratedAt   string             `json:"generated_at"`
	Queue         queueMetrics       `json:"queue"`
	Reliability   reliabilityMetrics `json:"reliability"`
	Runtime       runtimeMetrics     `json:"runtime"`
	SchemaVersion int                `json:"schema_version"`
	WorkerID      string             `json:"worker_id"`
}

type readinessResult struct {
	Code  string `json:"code,omitempty"`
	Ready bool   `json:"-"`
}

type workerHTTPServer struct {
	done   <-chan error
	server *http.Server
}

func (w *Worker) startHTTPServer() (*workerHTTPServer, error) {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", w.handleHealth)
	mux.HandleFunc("/readyz", w.handleReady)
	mux.HandleFunc("/metrics", w.handleMetrics)

	listener, err := net.Listen("tcp", w.cfg.HTTPAddr)
	if err != nil {
		return nil, err
	}
	server := &http.Server{
		Addr:              w.cfg.HTTPAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	done := make(chan error, 1)
	go func() {
		serveErr := server.Serve(listener)
		if errors.Is(serveErr, http.ErrServerClosed) {
			serveErr = nil
		}
		done <- serveErr
		close(done)
	}()

	w.logger.Info(
		"Worker HTTP 服务已启动",
		"event", "http_server_started",
		"addr", listener.Addr().String(),
	)
	return &workerHTTPServer{done: done, server: server}, nil
}

func (server *workerHTTPServer) shutdown(ctx context.Context) error {
	shutdownErr := server.server.Shutdown(ctx)
	select {
	case serveErr := <-server.done:
		if shutdownErr != nil {
			return shutdownErr
		}
		return serveErr
	case <-ctx.Done():
		if shutdownErr != nil {
			return shutdownErr
		}
		return ctx.Err()
	}
}

func (w *Worker) handleHealth(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"generated_at":   time.Now().UTC().Format(time.RFC3339),
		"schema_version": workerHTTPAPISchemaVersion,
		"status":         "ok",
	})
}

func (w *Worker) handleReady(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
	defer cancel()
	result := w.evaluateReadiness(ctx)
	if !result.Ready {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"code":           result.Code,
			"generated_at":   time.Now().UTC().Format(time.RFC3339),
			"schema_version": workerHTTPAPISchemaVersion,
			"status":         "not_ready",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"generated_at":   time.Now().UTC().Format(time.RFC3339),
		"schema_version": workerHTTPAPISchemaVersion,
		"status":         "ready",
	})
}

func (w *Worker) evaluateReadiness(ctx context.Context) readinessResult {
	snapshot := w.state.snapshot()
	if snapshot.Phase == runtimePhaseDraining || snapshot.Phase == runtimePhaseStopped {
		code := snapshot.ReadinessCode
		if code != readinessCodeTopologyConflict && code != readinessCodeTopologyLockLost {
			code = readinessCodeDraining
		}
		return readinessResult{Code: code}
	}
	if w.pingDatabase == nil || w.pingDatabase(ctx) != nil {
		return readinessResult{Code: readinessCodeDatabaseUnavailable}
	}
	if w.checkSchema == nil {
		return readinessResult{Code: readinessCodeSchemaNotReady}
	}
	report, err := w.checkSchema(ctx)
	if err != nil || !report.Ready() {
		return readinessResult{Code: readinessCodeSchemaNotReady}
	}
	if !snapshot.TopologyHeld {
		if snapshot.ReadinessCode == readinessCodeTopologyConflict || snapshot.ReadinessCode == readinessCodeTopologyLockLost {
			return readinessResult{Code: snapshot.ReadinessCode}
		}
		return readinessResult{Code: readinessCodeTopologyNotReady}
	}
	if !snapshot.ConsumersRunning {
		return readinessResult{Code: readinessCodeConsumerNotReady}
	}
	if snapshot.Phase != runtimePhaseReady {
		return readinessResult{Code: readinessCodeBooting}
	}
	return readinessResult{Ready: true}
}

func (w *Worker) handleMetrics(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !w.metricsAuthorized(request) {
		writeJSON(writer, http.StatusUnauthorized, map[string]any{
			"code":   "METRICS_UNAUTHORIZED",
			"status": "error",
		})
		return
	}

	ctx, cancel := context.WithTimeout(request.Context(), 5*time.Second)
	defer cancel()
	if w.metricsCollector == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"code":   "METRICS_UNAVAILABLE",
			"status": "error",
		})
		return
	}
	metrics, err := w.metricsCollector(ctx)
	if err != nil {
		w.logger.Warn("Worker 指标采集失败", "event", "metrics_collection_failed", "error", err)
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"code":   "METRICS_UNAVAILABLE",
			"status": "error",
		})
		return
	}

	writeJSON(writer, http.StatusOK, metrics)
}

func (w *Worker) metricsAuthorized(request *http.Request) bool {
	expected := strings.TrimSpace(w.cfg.MetricsToken)
	if expected == "" {
		return true
	}
	parts := strings.Fields(request.Header.Get("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return false
	}
	provided := []byte(parts[1])
	wanted := []byte(expected)
	return len(provided) == len(wanted) && subtle.ConstantTimeCompare(provided, wanted) == 1
}

func (w *Worker) collectMetrics(ctx context.Context) (metricsResponse, error) {
	now := time.Now().UTC()
	since := now.Add(-w.cfg.MetricsWindow)
	snapshot := w.state.snapshot()
	response := metricsResponse{
		GeneratedAt: now.Format(time.RFC3339),
		Reliability: reliabilityMetrics{ErrorClassCounts: map[string]int64{}},
		Runtime: runtimeMetrics{
			Draining:      snapshot.Phase == runtimePhaseDraining,
			Mode:          w.cfg.RuntimeMode,
			State:         snapshot.Phase,
			UptimeSeconds: int64(now.Sub(snapshot.StartedAt).Seconds()),
		},
		SchemaVersion: workerHTTPAPISchemaVersion,
		WorkerID:      w.cfg.WorkerID,
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

	err = w.pool.QueryRow(ctx, `
SELECT
  COUNT(*) FILTER (WHERE status = 'FAILED_RETRYABLE'),
  COUNT(*) FILTER (WHERE "errorCode" = $2),
  COUNT(*) FILTER (WHERE status = 'UNKNOWN')
FROM "GenerationAttempt"
WHERE "createdAt" >= $1
`, since, errorMaxAttemptsExhausted).Scan(
		&response.Reliability.RetryAttempts,
		&response.Reliability.RetryExhausted,
		&response.Reliability.UnknownHandoffs,
	)
	if err != nil {
		return metricsResponse{}, err
	}

	rows, err := w.pool.Query(ctx, `
SELECT "errorCode", COUNT(*)
FROM "GenerationJob"
WHERE "workerManaged" = true
  AND status = 'FAILED'
  AND "completedAt" >= $1
  AND "errorCode" IS NOT NULL
GROUP BY "errorCode"
ORDER BY "errorCode"
`, since)
	if err != nil {
		return metricsResponse{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var code string
		var count int64
		if err := rows.Scan(&code, &count); err != nil {
			return metricsResponse{}, err
		}
		response.Reliability.ErrorClassCounts[code] = count
	}
	if err := rows.Err(); err != nil {
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

package worker

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestHealthzIsPureLiveness(t *testing.T) {
	worker := New(nil, Config{}, nil)
	worker.pingDatabase = func(context.Context) error {
		t.Fatal("healthz must not query the database")
		return nil
	}

	recorder := httptest.NewRecorder()
	worker.handleHealth(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", recorder.Code)
	}
	payload := decodeResponse(t, recorder)
	if payload["status"] != "ok" {
		t.Fatalf("unexpected health payload: %v", payload)
	}
}

func TestReadyzReturnsStableStatusWithoutRawErrors(t *testing.T) {
	worker := readyTestWorker()
	worker.pingDatabase = func(context.Context) error {
		return errors.New("postgresql://admin:secret@db/app?token=private")
	}

	recorder := httptest.NewRecorder()
	worker.handleReady(recorder, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("unexpected status: %d", recorder.Code)
	}
	payload := decodeResponse(t, recorder)
	if payload["code"] != readinessCodeDatabaseUnavailable || payload["status"] != "not_ready" {
		t.Fatalf("unexpected ready payload: %v", payload)
	}
	if strings.Contains(recorder.Body.String(), "secret") || strings.Contains(recorder.Body.String(), "postgresql://") {
		t.Fatalf("readyz leaked raw error: %s", recorder.Body.String())
	}
}

func TestReadyzCoversSchemaTopologyConsumerAndDraining(t *testing.T) {
	tests := []struct {
		name string
		edit func(*Worker)
		code string
	}{
		{
			name: "schema",
			edit: func(worker *Worker) {
				worker.checkSchema = func(context.Context) (SchemaContractReport, error) {
					return SchemaContractReport{Issues: []SchemaIssue{{Kind: "missing_table"}}}, nil
				}
			},
			code: readinessCodeSchemaNotReady,
		},
		{
			name: "topology",
			edit: func(worker *Worker) {
				worker.state.markTopologyUnavailable("")
			},
			code: readinessCodeTopologyNotReady,
		},
		{
			name: "consumer",
			edit: func(worker *Worker) {
				worker.state = newRuntimeState(worker.state.snapshot().StartedAt)
				worker.state.markTopologyAcquired()
			},
			code: readinessCodeConsumerNotReady,
		},
		{
			name: "draining",
			edit: func(worker *Worker) {
				worker.state.beginDraining("")
			},
			code: readinessCodeDraining,
		},
		{
			name: "topology lock lost",
			edit: func(worker *Worker) {
				worker.state.markTopologyUnavailable(readinessCodeTopologyLockLost)
				worker.state.beginDraining(readinessCodeTopologyLockLost)
			},
			code: readinessCodeTopologyLockLost,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			worker := readyTestWorker()
			test.edit(worker)
			result := worker.evaluateReadiness(context.Background())
			if result.Ready || result.Code != test.code {
				t.Fatalf("unexpected readiness result: %+v", result)
			}
		})
	}
}

func TestReadyzRecoversAfterDatabaseProbeSucceeds(t *testing.T) {
	worker := readyTestWorker()
	var available atomic.Bool
	worker.pingDatabase = func(context.Context) error {
		if !available.Load() {
			return errors.New("database unavailable")
		}
		return nil
	}

	if result := worker.evaluateReadiness(context.Background()); result.Code != readinessCodeDatabaseUnavailable {
		t.Fatalf("unexpected unavailable result: %+v", result)
	}
	available.Store(true)
	if result := worker.evaluateReadiness(context.Background()); !result.Ready {
		t.Fatalf("worker did not recover readiness: %+v", result)
	}
}

func TestMetricsRequiresConfiguredBearerToken(t *testing.T) {
	worker := New(nil, Config{MetricsToken: "metrics-secret-12"}, nil)
	worker.metricsCollector = func(context.Context) (metricsResponse, error) {
		t.Fatal("unauthorized request must not collect metrics")
		return metricsResponse{}, nil
	}

	recorder := httptest.NewRecorder()
	worker.handleMetrics(recorder, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unexpected unauthorized status: %d", recorder.Code)
	}

	request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	request.Header.Set("Authorization", "Bearer metrics-secret-12")
	worker.metricsCollector = func(context.Context) (metricsResponse, error) {
		return metricsResponse{SchemaVersion: workerHTTPAPISchemaVersion}, nil
	}
	recorder = httptest.NewRecorder()
	worker.handleMetrics(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected authorized status: %d", recorder.Code)
	}
	payload := decodeResponse(t, recorder)
	if payload["schema_version"] != float64(workerHTTPAPISchemaVersion) {
		t.Fatalf("missing metrics schema version: %v", payload)
	}
}

func TestMetricsFailureDoesNotLeakCause(t *testing.T) {
	worker := New(nil, Config{}, nil)
	worker.metricsCollector = func(context.Context) (metricsResponse, error) {
		return metricsResponse{}, errors.New("SELECT secret FROM postgresql://admin:password@db/app")
	}
	recorder := httptest.NewRecorder()
	worker.handleMetrics(recorder, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("unexpected status: %d", recorder.Code)
	}
	if strings.Contains(recorder.Body.String(), "password") || strings.Contains(recorder.Body.String(), "SELECT") {
		t.Fatalf("metrics response leaked cause: %s", recorder.Body.String())
	}
}

func readyTestWorker() *Worker {
	worker := New(nil, Config{RuntimeMode: RuntimeModeDedicated}, nil)
	worker.pingDatabase = func(context.Context) error { return nil }
	worker.checkSchema = func(context.Context) (SchemaContractReport, error) {
		return SchemaContractReport{ContractVersion: 1}, nil
	}
	worker.state.markTopologyAcquired()
	worker.state.markConsumersRunning(true)
	worker.state.markReady()
	return worker
}

func decodeResponse(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return payload
}

func TestPromptSyncRequiresPostMethod(t *testing.T) {
	worker := New(nil, Config{}, nil)
	recorder := httptest.NewRecorder()
	worker.handlePromptSync(recorder, httptest.NewRequest(http.MethodGet, "/internal/prompt-sync", nil))
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("unexpected status: %d", recorder.Code)
	}
}

func TestPromptSyncRequiresConfiguredBearerToken(t *testing.T) {
	worker := New(nil, Config{MetricsToken: "metrics-secret-12"}, nil)
	recorder := httptest.NewRecorder()
	worker.handlePromptSync(recorder, httptest.NewRequest(http.MethodPost, "/internal/prompt-sync", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unexpected unauthorized status: %d", recorder.Code)
	}

	request := httptest.NewRequest(http.MethodPost, "/internal/prompt-sync", nil)
	request.Header.Set("Authorization", "Bearer metrics-secret-12")
	recorder = httptest.NewRecorder()
	worker.handlePromptSync(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected pool-unavailable 503, got %d", recorder.Code)
	}
}

func TestPromptSyncRejectsInvalidBody(t *testing.T) {
	worker := New(nil, Config{MetricsToken: "metrics-secret-12"}, nil)
	worker.pool = &pgxpool.Pool{}
	request := httptest.NewRequest(http.MethodPost, "/internal/prompt-sync", strings.NewReader("{not-json"))
	request.Header.Set("Authorization", "Bearer metrics-secret-12")
	recorder := httptest.NewRecorder()
	worker.handlePromptSync(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid body 400, got %d", recorder.Code)
	}
}

func TestPromptSyncWithoutTokenIsAllowedWhenUnset(t *testing.T) {
	// 未配置 token 时与 /metrics 一致，允许 loopback 内部调用。
	worker := New(nil, Config{}, nil)
	request := httptest.NewRequest(http.MethodPost, "/internal/prompt-sync", nil)
	recorder := httptest.NewRecorder()
	worker.handlePromptSync(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected pool-unavailable 503 (not 401), got %d", recorder.Code)
	}
}

func TestPromptSyncSuccessResponseUsesLowercaseJSON(t *testing.T) {
	worker := New(nil, Config{MetricsToken: "metrics-secret-12"}, nil)
	worker.pool = &pgxpool.Pool{}
	worker.promptSyncRunner = func(ctx context.Context, sourceID string) ([]PromptSyncResult, error) {
		return []PromptSyncResult{{Count: 3, Slug: "awesome-gpt-image", Status: "SUCCESS"}}, nil
	}

	request := httptest.NewRequest(http.MethodPost, "/internal/prompt-sync", nil)
	request.Header.Set("Authorization", "Bearer metrics-secret-12")
	recorder := httptest.NewRecorder()
	worker.handlePromptSync(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", recorder.Code)
	}

	// Node 契约类型（src/lib/prompts/service.ts）期望小写字段，
	// 大写 JSON tag 会让 Node 侧拿不到 count/slug/status。
	var payload struct {
		Results []struct {
			Count  int    `json:"count"`
			Slug   string `json:"slug"`
			Status string `json:"status"`
		} `json:"results"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Results) != 1 || payload.Results[0].Count != 3 ||
		payload.Results[0].Slug != "awesome-gpt-image" || payload.Results[0].Status != "SUCCESS" {
		t.Fatalf("unexpected results payload: %s", recorder.Body.String())
	}
	for _, key := range []string{"Count", "Slug", "Status"} {
		if strings.Contains(recorder.Body.String(), key) {
			t.Fatalf("response serialized non-lowercase json tag %q: %s", key, recorder.Body.String())
		}
	}
}

package worker

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestWorkerRunKeepsHTTPAliveDuringDrain(t *testing.T) {
	consumerStarted := make(chan struct{})
	worker, baseURL := newRuntimeTestWorker(t, func(claimCtx context.Context, processingCtx context.Context, _ int) {
		close(consumerStarted)
		<-claimCtx.Done()
		<-processingCtx.Done()
	})
	worker.cfg.ShutdownGrace = 300 * time.Millisecond
	worker.cfg.ShutdownHardTimeout = 100 * time.Millisecond

	runCtx, cancelRun := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- worker.Run(runCtx) }()
	waitForSignal(t, consumerStarted, time.Second, "consumer start")
	waitForRuntimePhase(t, worker, runtimePhaseReady, time.Second)

	status, payload := getRuntimeJSON(t, baseURL+"/readyz")
	if status != http.StatusOK || payload["status"] != "ready" {
		t.Fatalf("worker was not ready before drain: status=%d payload=%v", status, payload)
	}

	cancelRun()
	waitForRuntimePhase(t, worker, runtimePhaseDraining, time.Second)
	status, payload = getRuntimeJSON(t, baseURL+"/healthz")
	if status != http.StatusOK || payload["status"] != "ok" {
		t.Fatalf("healthz stopped during drain: status=%d payload=%v", status, payload)
	}
	status, payload = getRuntimeJSON(t, baseURL+"/readyz")
	if status != http.StatusServiceUnavailable || payload["code"] != readinessCodeDraining {
		t.Fatalf("readyz stayed ready during drain: status=%d payload=%v", status, payload)
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("graceful drain returned error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("worker did not finish drain")
	}
}

func TestWorkerRunStartsHTTPBeforeSchemaIsReady(t *testing.T) {
	schemaChecked := make(chan struct{}, 1)
	worker, baseURL := newRuntimeTestWorker(t, func(context.Context, context.Context, int) {})
	worker.checkSchema = func(context.Context) (SchemaContractReport, error) {
		select {
		case schemaChecked <- struct{}{}:
		default:
		}
		return SchemaContractReport{Issues: []SchemaIssue{{Kind: "missing_table"}}}, nil
	}

	runCtx, cancelRun := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- worker.Run(runCtx) }()
	waitForSignal(t, schemaChecked, time.Second, "schema probe")

	status, payload := getRuntimeJSON(t, baseURL+"/healthz")
	if status != http.StatusOK || payload["status"] != "ok" {
		t.Fatalf("healthz was unavailable while schema was pending: status=%d payload=%v", status, payload)
	}
	status, payload = getRuntimeJSON(t, baseURL+"/readyz")
	if status != http.StatusServiceUnavailable || payload["code"] != readinessCodeSchemaNotReady {
		t.Fatalf("readyz did not report schema pending: status=%d payload=%v", status, payload)
	}

	cancelRun()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("schema-wait shutdown returned error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("worker did not stop while waiting for schema")
	}
}

func TestWorkerRunReturnsHardStopErrorForHungConsumer(t *testing.T) {
	consumerStarted := make(chan struct{})
	releaseConsumer := make(chan struct{})
	worker, _ := newRuntimeTestWorker(t, func(context.Context, context.Context, int) {
		close(consumerStarted)
		<-releaseConsumer
	})
	worker.cfg.ShutdownGrace = 10 * time.Millisecond
	worker.cfg.ShutdownHardTimeout = 15 * time.Millisecond

	runCtx, cancelRun := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- worker.Run(runCtx) }()
	waitForSignal(t, consumerStarted, time.Second, "consumer start")
	cancelRun()

	select {
	case err := <-done:
		if !errors.Is(err, ErrShutdownHardTimeout) {
			t.Fatalf("expected hard stop error, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("worker did not honor hard stop timeout")
	}
	close(releaseConsumer)
}

func TestWorkerRunPropagatesTopologyLockLoss(t *testing.T) {
	consumerStarted := make(chan struct{})
	worker, _ := newRuntimeTestWorker(t, func(claimCtx context.Context, _ context.Context, _ int) {
		close(consumerStarted)
		<-claimCtx.Done()
	})
	conn := &fakeTopologyConnection{acquired: true}
	worker.topologyConnect = func(context.Context) (topologyConnection, error) { return conn, nil }
	worker.cfg.PollInterval = 250 * time.Millisecond

	done := make(chan error, 1)
	go func() { done <- worker.Run(context.Background()) }()
	waitForSignal(t, consumerStarted, time.Second, "consumer start")
	conn.mu.Lock()
	conn.pingErr = errors.New("lock connection closed")
	conn.mu.Unlock()

	select {
	case err := <-done:
		if !errors.Is(err, ErrTopologyLockLost) {
			t.Fatalf("expected lock loss error, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("worker did not fence lost topology lock")
	}
}

func TestWorkerRunPropagatesConsumerPanic(t *testing.T) {
	worker, _ := newRuntimeTestWorker(t, func(context.Context, context.Context, int) {
		panic("consumer failure")
	})

	done := make(chan error, 1)
	go func() { done <- worker.Run(context.Background()) }()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "panic") {
			t.Fatalf("consumer panic was not propagated: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("worker did not propagate consumer panic")
	}
}

func TestWorkerRunReturnsHTTPListenFailure(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve listener: %v", err)
	}
	defer listener.Close()
	worker := New(nil, Config{HTTPAddr: listener.Addr().String()}, nil)

	err = worker.Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "HTTP") {
		t.Fatalf("expected HTTP listen error, got %v", err)
	}
	if worker.state.snapshot().Phase != runtimePhaseStopped {
		t.Fatalf("unexpected state after HTTP failure: %+v", worker.state.snapshot())
	}
}

func newRuntimeTestWorker(
	t *testing.T,
	consumer func(context.Context, context.Context, int),
) (*Worker, string) {
	t.Helper()
	addr := freeRuntimeAddr(t)
	cfg := Config{
		Concurrency:         1,
		HTTPAddr:            addr,
		JobTimeout:          time.Second,
		PollInterval:        250 * time.Millisecond,
		RuntimeMode:         RuntimeModeDedicated,
		ShutdownGrace:       20 * time.Millisecond,
		ShutdownHardTimeout: 50 * time.Millisecond,
		WorkerID:            "runtime-test-worker",
	}
	worker := New(nil, cfg, nil)
	worker.storageFactory = func(context.Context, Config) (*Storage, error) {
		return &Storage{cfg: cfg}, nil
	}
	worker.checkSchema = func(context.Context) (SchemaContractReport, error) {
		return SchemaContractReport{ContractVersion: 1}, nil
	}
	worker.pingDatabase = func(context.Context) error { return nil }
	worker.consumerLoop = consumer
	worker.topologyConnect = func(context.Context) (topologyConnection, error) {
		return &fakeTopologyConnection{acquired: true}, nil
	}
	return worker, "http://" + addr
}

func freeRuntimeAddr(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("allocate test address: %v", err)
	}
	addr := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("release test address: %v", err)
	}
	return addr
}

func waitForRuntimePhase(t *testing.T, worker *Worker, phase runtimePhase, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if worker.state.snapshot().Phase == phase {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("runtime did not reach phase %s: %+v", phase, worker.state.snapshot())
}

func waitForSignal(t *testing.T, signal <-chan struct{}, timeout time.Duration, name string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(timeout):
		t.Fatalf("timed out waiting for %s", name)
	}
}

func getRuntimeJSON(t *testing.T, rawURL string) (int, map[string]any) {
	t.Helper()
	client := &http.Client{Timeout: time.Second}
	response, err := client.Get(rawURL)
	if err != nil {
		t.Fatalf("GET %s: %v", rawURL, err)
	}
	defer response.Body.Close()
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode %s: %v", rawURL, err)
	}
	return response.StatusCode, payload
}

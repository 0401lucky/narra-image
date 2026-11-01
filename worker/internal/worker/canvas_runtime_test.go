package worker

import (
	"context"
	"errors"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func newCanvasRuntimeWorker(t *testing.T, mode RuntimeMode) (*Worker, string, *fakeCanvasGCRepository) {
	t.Helper()
	worker, baseURL := newRuntimeTestWorker(t, func(ctx context.Context, _ context.Context, _ int) { <-ctx.Done() })
	worker.cfg.CanvasEnabled = true
	worker.cfg.RuntimeMode = mode
	worker.cfg.PollInterval = 10 * time.Millisecond
	worker.checkCanvasSchema = func(context.Context) (SchemaContractReport, error) {
		return SchemaContractReport{ContractVersion: 1}, nil
	}
	repository := &fakeCanvasGCRepository{assets: []canvasGCAsset{runtimeCanvasAsset(t)}, afterFinish: make(chan struct{}, 8)}
	worker.canvasRepository = repository
	storage := &fakeCanvasGCStorage{location: runtimeCanvasLocation(t)}
	worker.canvasStorageFactory = func(*Storage) (canvasGCStorage, error) { return storage, nil }
	return worker, baseURL, repository
}

func TestCanvasWorkerRunStartsOneManagedGCInBothTopologies(t *testing.T) {
	for _, mode := range []RuntimeMode{RuntimeModeEmbedded, RuntimeModeDedicated} {
		for _, concurrency := range []int{1, 4} {
			t.Run(string(mode)+"/slots-"+strconv.Itoa(concurrency), func(t *testing.T) {
				worker, baseURL, repository := newCanvasRuntimeWorker(t, mode)
				worker.cfg.Concurrency = concurrency
				ticks, stopped := make(chan time.Time, 1), make(chan struct{})
				var starts atomic.Int32
				worker.canvasSchedulerRunner = func(ctx context.Context, scheduler *canvasGCScheduler) {
					starts.Add(1)
					scheduler.ticker = func(interval time.Duration) (<-chan time.Time, func()) {
						if interval < 60*time.Second {
							panic("interval shorter than retention contract allows")
						}
						return ticks, func() { close(stopped) }
					}
					scheduler.Run(ctx)
				}
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				done := make(chan error, 1)
				go func() { done <- worker.Run(ctx) }()
				waitForSignal(t, repository.afterFinish, time.Second, "immediate GC pass")
				status, payload := getRuntimeJSON(t, baseURL+"/readyz")
				if status != http.StatusOK {
					t.Fatalf("enabled worker not ready: %v", payload)
				}
				capabilities, ok := payload["capabilities"].(map[string]any)
				if !ok {
					t.Fatal("enabled readiness omitted capability location")
				}
				capability := worker.canvasGC.contract.Capability.ReadyCapability
				want := map[string]any{"version": float64(capability.Version), "schema": capability.Schema, "storage": capability.Storage, "gc": capability.GC}
				if !reflect.DeepEqual(capabilities["canvas"], want) {
					t.Fatalf("wrong capability: %v", capabilities)
				}
				ticks <- time.Now()
				waitForSignal(t, repository.afterFinish, time.Second, "second GC pass")
				cancel()
				select {
				case err := <-done:
					if err != nil {
						t.Fatal(err)
					}
				case <-time.After(time.Second):
					t.Fatal("managed scheduler was not joined")
				}
				select {
				case <-stopped:
				default:
					t.Fatal("GC ticker remained alive after Run")
				}
				if starts.Load() != 1 || worker.state.snapshot().CanvasGCRunning {
					t.Fatal("scheduler was per-slot or not stopped")
				}
				repository.mu.Lock()
				defer repository.mu.Unlock()
				if len(repository.tokens) != 2 || repository.tokens[0] != repository.tokens[1] {
					t.Fatalf("lease did not renew: %v", repository.tokens)
				}
			})
		}
	}
}

func TestCanvasWorkerRunWaitsForSchemaAndStorageBeforeConsumers(t *testing.T) {
	for _, kind := range []string{"schema", "storage"} {
		t.Run(kind, func(t *testing.T) {
			worker, baseURL, repository := newCanvasRuntimeWorker(t, RuntimeModeDedicated)
			var available atomic.Bool
			checked := make(chan struct{}, 1)
			probe := func() bool {
				select {
				case checked <- struct{}{}:
				default:
				}
				return available.Load()
			}
			wantCode := "CANVAS_SCHEMA_CONTRACT_MISMATCH"
			if kind == "schema" {
				worker.checkCanvasSchema = func(context.Context) (SchemaContractReport, error) {
					if probe() {
						return SchemaContractReport{ContractVersion: 1}, nil
					}
					return SchemaContractReport{Issues: []SchemaIssue{{Kind: "missing_table"}}}, nil
				}
			} else {
				wantCode = "CANVAS_STORAGE_CAPABILITY_INVALID"
				worker.canvasStorageFactory = func(*Storage) (canvasGCStorage, error) {
					return &fakeCanvasGCStorage{location: runtimeCanvasLocation(t), verify: func(context.Context) error {
						if probe() {
							return nil
						}
						return errCanvasStorageCapability
					}}, nil
				}
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() { done <- worker.Run(ctx) }()
			waitForSignal(t, checked, time.Second, "canvas startup probe")
			status, payload := getRuntimeJSON(t, baseURL+"/readyz")
			if status != http.StatusServiceUnavailable || payload["code"] != wantCode {
				t.Fatalf("startup gate reported ready/wrong code: %v", payload)
			}
			if worker.state.snapshot().ConsumersRunning || worker.state.snapshot().CanvasGCRunning {
				t.Fatal("consumption started before enabled canvas readiness")
			}
			status, _ = getRuntimeJSON(t, baseURL+"/healthz")
			if status != http.StatusOK {
				t.Fatal("startup prerequisite changed pure liveness")
			}
			available.Store(true)
			waitForSignal(t, repository.afterFinish, time.Second, "enabled recovery GC pass")
			available.Store(false)
			status, payload = getRuntimeJSON(t, baseURL+"/readyz")
			if status != http.StatusServiceUnavailable || payload["capabilities"] != nil {
				t.Fatal("readiness kept advertising a stale capability")
			}
			cancel()
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Fatal("startup/readiness test did not stop")
			}
		})
	}
}

func TestCanvasWorkerFeatureOffDoesNotLoadContractsOrStorage(t *testing.T) {
	worker, baseURL := newRuntimeTestWorker(t, func(ctx context.Context, _ context.Context, _ int) { <-ctx.Done() })
	worker.canvasContractLoader = func() (CanvasContract, error) {
		t.Error("off runtime loaded canvas contracts")
		return CanvasContract{}, errors.New("must not run")
	}
	worker.checkCanvasSchema = func(context.Context) (SchemaContractReport, error) {
		t.Error("off runtime queried canvas schema")
		return SchemaContractReport{}, nil
	}
	worker.canvasStorageFactory = func(*Storage) (canvasGCStorage, error) {
		t.Error("off runtime created canvas storage")
		return nil, errors.New("must not run")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- worker.Run(ctx) }()
	waitForRuntimePhase(t, worker, runtimePhaseReady, time.Second)
	status, payload := getRuntimeJSON(t, baseURL+"/readyz")
	if status != http.StatusOK || payload["capabilities"] != nil {
		t.Fatal("feature-off legacy capability changed")
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("off runtime did not stop")
	}
}

func TestCanvasWorkerRejectsMissingContractFiles(t *testing.T) {
	worker, _, _ := newCanvasRuntimeWorker(t, RuntimeModeDedicated)
	worker.canvasContractLoader = func() (CanvasContract, error) {
		return CanvasContract{}, errors.New("required canvas contract unavailable")
	}
	if err := worker.Run(context.Background()); err == nil || !strings.Contains(err.Error(), "contract unavailable") {
		t.Fatalf("missing contract did not fail closed: %v", err)
	}
	if worker.state.snapshot().ConsumersRunning {
		t.Fatal("missing contract started consumers")
	}
}

func TestCanvasWorkerStopsClaimOnDrainAndJoinsExistingDeadline(t *testing.T) {
	worker, _, repository := newCanvasRuntimeWorker(t, RuntimeModeDedicated)
	acquiring, release := make(chan struct{}), make(chan struct{})
	repository.beforeAcquire = func() { close(acquiring); <-release }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- worker.Run(ctx) }()
	waitForSignal(t, acquiring, time.Second, "lease acquisition")
	cancel()
	waitForRuntimePhase(t, worker, runtimePhaseDraining, time.Second)
	select {
	case <-done:
		t.Fatal("Run returned before GC joined")
	default:
	}
	close(release)
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("GC join did not finish")
	}
	if len(repository.claimLocations) != 0 {
		t.Fatal("claimed after drain")
	}
}

func TestCanvasWorkerTopologyLossStopsGCInBothModes(t *testing.T) {
	for _, mode := range []RuntimeMode{RuntimeModeDedicated, RuntimeModeEmbedded} {
		t.Run(string(mode), func(t *testing.T) {
			worker, _, repository := newCanvasRuntimeWorker(t, mode)
			conn := &fakeTopologyConnection{acquired: true}
			worker.topologyConnect = func(context.Context) (topologyConnection, error) { return conn, nil }
			done := make(chan error, 1)
			go func() { done <- worker.Run(context.Background()) }()
			waitForSignal(t, repository.afterFinish, time.Second, "first GC pass")
			conn.mu.Lock()
			conn.pingErr = errors.New("lock lost")
			conn.mu.Unlock()
			select {
			case err := <-done:
				if !errors.Is(err, ErrTopologyLockLost) {
					t.Fatalf("lock loss not fatal: %v", err)
				}
			case <-time.After(time.Second):
				t.Fatal("topology loss did not stop runtime")
			}
			if worker.state.snapshot().CanvasGCRunning {
				t.Fatal("GC outlived topology loss")
			}
		})
	}
}

func TestCanvasWorkerPropagatesGCPanicExitAndHardStop(t *testing.T) {
	for _, failure := range []string{"panic", "exit", "hang"} {
		t.Run(failure, func(t *testing.T) {
			worker, _, _ := newCanvasRuntimeWorker(t, RuntimeModeDedicated)
			started, release := make(chan struct{}), make(chan struct{})
			worker.cfg.ShutdownGrace, worker.cfg.ShutdownHardTimeout = 10*time.Millisecond, 15*time.Millisecond
			worker.canvasSchedulerRunner = func(context.Context, *canvasGCScheduler) {
				close(started)
				if failure == "panic" {
					panic("GC failure")
				}
				if failure == "hang" {
					<-release
				}
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() { done <- worker.Run(ctx) }()
			waitForSignal(t, started, time.Second, "GC runner")
			if failure == "hang" {
				cancel()
			}
			select {
			case err := <-done:
				if failure == "hang" {
					close(release)
					if !errors.Is(err, ErrShutdownHardTimeout) {
						t.Fatalf("GC received a separate/unbounded shutdown budget: %v", err)
					}
				} else if err == nil || !strings.Contains(err.Error(), "canvas GC") {
					t.Fatalf("GC failure did not fail runtime: %v", err)
				}
			case <-time.After(time.Second):
				t.Fatal("GC bypassed runtime hard-stop")
			}
			if worker.evaluateReadiness(context.Background()).Ready {
				t.Fatal("dead scheduler remained ready")
			}
		})
	}
}

func TestWorkerReadinessRechecksDrainAfterSlowProbe(t *testing.T) {
	worker := readyTestWorker()
	worker.checkSchema = func(context.Context) (SchemaContractReport, error) {
		worker.state.beginDraining(readinessCodeDraining)
		return SchemaContractReport{}, nil
	}
	if result := worker.evaluateReadiness(context.Background()); result.Ready || result.Code != readinessCodeDraining {
		t.Fatalf("pre-probe snapshot escaped lifecycle fence: %+v", result)
	}
}

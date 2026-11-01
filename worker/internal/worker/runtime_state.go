package worker

import (
	"errors"
	"sync"
	"time"
)

type RuntimeMode string

const (
	RuntimeModeDedicated RuntimeMode = "dedicated"
	RuntimeModeEmbedded  RuntimeMode = "embedded"
)

const (
	readinessCodeBooting             = "BOOTING"
	readinessCodeCanvasNotReady      = "CANVAS_NOT_READY"
	readinessCodeCanvasGCNotReady    = "CANVAS_GC_NOT_RUNNING"
	readinessCodeConsumerNotReady    = "CONSUMER_NOT_READY"
	readinessCodeDatabaseUnavailable = "DATABASE_UNAVAILABLE"
	readinessCodeDraining            = "DRAINING"
	readinessCodeRuntimeFailure      = "RUNTIME_FAILURE"
	readinessCodeSchemaNotReady      = "SCHEMA_NOT_READY"
	readinessCodeTopologyConflict    = "TOPOLOGY_CONFLICT"
	readinessCodeTopologyLockLost    = "TOPOLOGY_LOCK_LOST"
	readinessCodeTopologyNotReady    = "TOPOLOGY_NOT_READY"
)

type runtimePhase string

const (
	runtimePhaseBooting  runtimePhase = "booting"
	runtimePhaseDraining runtimePhase = "draining"
	runtimePhaseReady    runtimePhase = "ready"
	runtimePhaseStopped  runtimePhase = "stopped"
)

var ErrShutdownHardTimeout = errors.New("Worker 超过硬停止期限")

type runtimeSnapshot struct {
	CanvasConfigured bool
	CanvasGCRunning  bool
	ConsumersRunning bool
	Phase            runtimePhase
	ReadinessCode    string
	StartedAt        time.Time
	TopologyHeld     bool
}

type runtimeState struct {
	mu               sync.RWMutex
	canvasRequired   bool
	canvasConfigured bool
	canvasGCRunning  bool
	consumersRunning bool
	phase            runtimePhase
	readinessCode    string
	startedAt        time.Time
	topologyHeld     bool
}

func newRuntimeState(now time.Time) *runtimeState {
	return &runtimeState{
		phase:         runtimePhaseBooting,
		readinessCode: readinessCodeBooting,
		startedAt:     now.UTC(),
	}
}

func (state *runtimeState) snapshot() runtimeSnapshot {
	state.mu.RLock()
	defer state.mu.RUnlock()
	return runtimeSnapshot{
		CanvasConfigured: state.canvasConfigured,
		CanvasGCRunning:  state.canvasGCRunning,
		ConsumersRunning: state.consumersRunning,
		Phase:            state.phase,
		ReadinessCode:    state.readinessCode,
		StartedAt:        state.startedAt,
		TopologyHeld:     state.topologyHeld,
	}
}

func (state *runtimeState) markTopologyAcquired() {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.topologyHeld = true
	if state.phase == runtimePhaseBooting {
		state.readinessCode = readinessCodeBooting
	}
}

func (state *runtimeState) markTopologyUnavailable(code string) {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.topologyHeld = false
	if code != "" {
		state.readinessCode = code
	}
}

func (state *runtimeState) markConsumersRunning(running bool) {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.consumersRunning = running
	if !running && state.phase == runtimePhaseReady {
		state.phase = runtimePhaseDraining
		state.readinessCode = readinessCodeConsumerNotReady
	}
}

func (state *runtimeState) markReady() bool {
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.phase != runtimePhaseBooting || !state.topologyHeld || !state.consumersRunning ||
		(state.canvasRequired && (!state.canvasConfigured || !state.canvasGCRunning)) {
		return false
	}
	state.phase = runtimePhaseReady
	state.readinessCode = ""
	return true
}

func (state *runtimeState) requireCanvas(required bool) {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.canvasRequired = required
}

func (state *runtimeState) markCanvasConfigured() {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.canvasConfigured = true
}

func (state *runtimeState) markCanvasGCRunning(running bool) {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.canvasGCRunning = running
	if !running && state.phase == runtimePhaseReady {
		state.phase = runtimePhaseDraining
		state.readinessCode = readinessCodeCanvasGCNotReady
	}
}

func (state *runtimeState) beginDraining(code string) {
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.phase == runtimePhaseStopped {
		return
	}
	state.phase = runtimePhaseDraining
	if code == "" {
		code = readinessCodeDraining
	}
	state.readinessCode = code
}

func (state *runtimeState) markStopped() {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.phase = runtimePhaseStopped
	state.consumersRunning = false
	state.canvasGCRunning = false
	state.topologyHeld = false
	if state.readinessCode == "" {
		state.readinessCode = readinessCodeDraining
	}
}

type shutdownController struct {
	done chan struct{}
	err  error
	mu   sync.RWMutex
	once sync.Once
}

func newShutdownController() *shutdownController {
	return &shutdownController{done: make(chan struct{})}
}

func (controller *shutdownController) request(err error) {
	controller.once.Do(func() {
		controller.mu.Lock()
		controller.err = err
		controller.mu.Unlock()
		close(controller.done)
	})
}

func (controller *shutdownController) cause() error {
	controller.mu.RLock()
	defer controller.mu.RUnlock()
	return controller.err
}

func (controller *shutdownController) requested() bool {
	select {
	case <-controller.done:
		return true
	default:
		return false
	}
}

func waitForProcessingDrain(
	drained <-chan struct{},
	cancelProcessing func(),
	grace time.Duration,
	hardTimeout time.Duration,
) error {
	if grace <= 0 {
		grace = 30 * time.Second
	}
	if hardTimeout <= 0 {
		hardTimeout = 10 * time.Second
	}

	graceTimer := time.NewTimer(grace)
	defer graceTimer.Stop()
	select {
	case <-drained:
		return nil
	case <-graceTimer.C:
		cancelProcessing()
	}

	hardTimer := time.NewTimer(hardTimeout)
	defer hardTimer.Stop()
	select {
	case <-drained:
		return nil
	case <-hardTimer.C:
		return ErrShutdownHardTimeout
	}
}

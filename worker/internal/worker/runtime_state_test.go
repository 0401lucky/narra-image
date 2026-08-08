package worker

import (
	"errors"
	"testing"
	"time"
)

func TestRuntimeStateRequiresTopologyAndConsumersBeforeReady(t *testing.T) {
	state := newRuntimeState(time.Now())
	if state.markReady() {
		t.Fatal("runtime became ready without topology and consumers")
	}
	state.markTopologyAcquired()
	state.markConsumersRunning(true)
	if !state.markReady() {
		t.Fatal("runtime did not become ready")
	}
	if state.snapshot().Phase != runtimePhaseReady {
		t.Fatalf("unexpected runtime phase: %s", state.snapshot().Phase)
	}

	state.beginDraining("")
	snapshot := state.snapshot()
	if snapshot.Phase != runtimePhaseDraining || snapshot.ReadinessCode != readinessCodeDraining {
		t.Fatalf("unexpected draining state: %+v", snapshot)
	}
}

func TestWaitForProcessingDrainCancelsAtGraceAndStopsAtHardTimeout(t *testing.T) {
	drained := make(chan struct{})
	cancelled := make(chan struct{})
	err := waitForProcessingDrain(
		drained,
		func() { close(cancelled) },
		5*time.Millisecond,
		5*time.Millisecond,
	)
	if !errors.Is(err, ErrShutdownHardTimeout) {
		t.Fatalf("expected hard timeout, got %v", err)
	}
	select {
	case <-cancelled:
	default:
		t.Fatal("processing context was not cancelled after grace")
	}
}

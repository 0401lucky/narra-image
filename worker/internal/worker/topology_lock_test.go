package worker

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

type fakeTopologyConnection struct {
	acquired bool
	closed   bool
	mu       sync.Mutex
	pingErr  error
	queries  []string
}

func (conn *fakeTopologyConnection) Close(context.Context) error {
	conn.mu.Lock()
	defer conn.mu.Unlock()
	conn.closed = true
	return nil
}

func (conn *fakeTopologyConnection) Ping(context.Context) error {
	conn.mu.Lock()
	defer conn.mu.Unlock()
	return conn.pingErr
}

func (conn *fakeTopologyConnection) QueryRow(_ context.Context, query string, _ ...any) pgx.Row {
	conn.mu.Lock()
	defer conn.mu.Unlock()
	conn.queries = append(conn.queries, query)
	value := conn.acquired
	if strings.Contains(query, "unlock") {
		value = true
	}
	return fakeTopologyRow{value: value}
}

type fakeTopologyRow struct {
	value bool
}

func (row fakeTopologyRow) Scan(dest ...any) error {
	target, ok := dest[0].(*bool)
	if !ok {
		return errors.New("目标类型不是 bool")
	}
	*target = row.value
	return nil
}

func TestAcquireTopologyLockUsesModeSpecificAdvisoryLock(t *testing.T) {
	tests := []struct {
		mode       RuntimeMode
		wantShared bool
	}{
		{mode: RuntimeModeDedicated, wantShared: true},
		{mode: RuntimeModeEmbedded, wantShared: false},
	}

	for _, test := range tests {
		t.Run(string(test.mode), func(t *testing.T) {
			conn := &fakeTopologyConnection{acquired: true}
			worker := New(nil, Config{
				PollInterval: time.Millisecond,
				RuntimeMode:  test.mode,
				WorkerID:     "test-worker",
			}, nil)
			worker.topologyConnect = func(context.Context) (topologyConnection, error) {
				return conn, nil
			}

			lock, err := worker.acquireTopologyLock(context.Background())
			if err != nil {
				t.Fatalf("acquireTopologyLock returned error: %v", err)
			}
			defer func() { _ = lock.release(context.Background()) }()

			conn.mu.Lock()
			query := conn.queries[0]
			conn.mu.Unlock()
			if strings.Contains(query, "_shared") != test.wantShared {
				t.Fatalf("unexpected lock query for %s: %s", test.mode, query)
			}
			if !worker.state.snapshot().TopologyHeld {
				t.Fatal("topology state was not marked as acquired")
			}
		})
	}
}

func TestAcquireTopologyLockRejectsConflict(t *testing.T) {
	conn := &fakeTopologyConnection{acquired: false}
	worker := New(nil, Config{
		PollInterval: time.Millisecond,
		RuntimeMode:  RuntimeModeEmbedded,
	}, nil)
	worker.topologyConnect = func(context.Context) (topologyConnection, error) {
		return conn, nil
	}

	_, err := worker.acquireTopologyLock(context.Background())
	if !errors.Is(err, ErrTopologyConflict) {
		t.Fatalf("expected topology conflict, got %v", err)
	}
	snapshot := worker.state.snapshot()
	if snapshot.ReadinessCode != readinessCodeTopologyConflict || snapshot.TopologyHeld {
		t.Fatalf("unexpected topology state: %+v", snapshot)
	}
}

func TestTopologyLockMonitorFencesLostConnection(t *testing.T) {
	conn := &fakeTopologyConnection{acquired: true, pingErr: errors.New("connection lost")}
	lock := &topologyLock{conn: conn, mode: RuntimeModeDedicated}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	err := lock.monitor(ctx, 250*time.Millisecond)
	if !errors.Is(err, ErrTopologyLockLost) {
		t.Fatalf("expected topology lock lost error, got %v", err)
	}
}

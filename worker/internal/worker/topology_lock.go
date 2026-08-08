package worker

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// 固定键属于 embedded/dedicated 拓扑协议，所有版本必须使用同一键空间。
const topologyAdvisoryLockKey int64 = 5638890724896395090

var (
	ErrTopologyConflict = errors.New("Worker 运行拓扑冲突")
	ErrTopologyLockLost = errors.New("Worker 拓扑锁连接已丢失")
)

type topologyConnection interface {
	Close(context.Context) error
	Ping(context.Context) error
	QueryRow(context.Context, string, ...any) pgx.Row
}

type topologyConnectionFactory func(context.Context) (topologyConnection, error)

type topologyLock struct {
	conn topologyConnection
	mode RuntimeMode
}

func (w *Worker) acquireTopologyLock(ctx context.Context) (*topologyLock, error) {
	connect := w.topologyConnect
	if connect == nil {
		connect = func(connectCtx context.Context) (topologyConnection, error) {
			return pgx.Connect(connectCtx, w.cfg.DatabaseURL)
		}
	}

	query := `SELECT pg_try_advisory_lock_shared($1)`
	if w.cfg.RuntimeMode == RuntimeModeEmbedded {
		query = `SELECT pg_try_advisory_lock($1)`
	}

	for attempt := 1; ; attempt++ {
		conn, err := connect(ctx)
		if err != nil {
			w.logTopologyRetry(attempt, err)
			if err := waitForRetry(ctx, w.cfg.PollInterval); err != nil {
				return nil, err
			}
			continue
		}

		var acquired bool
		err = conn.QueryRow(ctx, query, topologyAdvisoryLockKey).Scan(&acquired)
		if err != nil {
			closeTopologyConnection(conn)
			w.logTopologyRetry(attempt, err)
			if err := waitForRetry(ctx, w.cfg.PollInterval); err != nil {
				return nil, err
			}
			continue
		}
		if !acquired {
			closeTopologyConnection(conn)
			w.state.markTopologyUnavailable(readinessCodeTopologyConflict)
			return nil, ErrTopologyConflict
		}

		lock := &topologyLock{conn: conn, mode: w.cfg.RuntimeMode}
		w.state.markTopologyAcquired()
		w.logger.Info(
			"Worker 拓扑锁已获取",
			"component", "generation_worker",
			"event", "topology_lock_acquired",
			"runtime_mode", w.cfg.RuntimeMode,
			"worker_id", w.cfg.WorkerID,
		)
		return lock, nil
	}
}

func closeTopologyConnection(conn topologyConnection) {
	_ = closeTopologyConnectionWithError(conn)
}

func closeTopologyConnectionWithError(conn topologyConnection) error {
	closeCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return conn.Close(closeCtx)
}

func (w *Worker) logTopologyRetry(attempt int, err error) {
	if attempt != 1 && attempt%30 != 0 {
		return
	}
	w.logger.Warn(
		"等待 Worker 拓扑锁数据库连接",
		"component", "generation_worker",
		"event", "topology_lock_wait",
		"runtime_mode", w.cfg.RuntimeMode,
		"worker_id", w.cfg.WorkerID,
		"attempt", attempt,
		"error", err,
	)
}

func (lock *topologyLock) monitor(ctx context.Context, interval time.Duration) error {
	interval = topologyMonitorInterval(interval)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
			err := lock.conn.Ping(pingCtx)
			cancel()
			if err != nil {
				return fmt.Errorf("%w: %v", ErrTopologyLockLost, err)
			}
		}
	}
}

func (lock *topologyLock) release(ctx context.Context) error {
	query := `SELECT pg_advisory_unlock_shared($1)`
	if lock.mode == RuntimeModeEmbedded {
		query = `SELECT pg_advisory_unlock($1)`
	}

	var released bool
	unlockErr := lock.conn.QueryRow(ctx, query, topologyAdvisoryLockKey).Scan(&released)
	closeErr := closeTopologyConnectionWithError(lock.conn)
	if unlockErr != nil {
		return unlockErr
	}
	if !released {
		return ErrTopologyLockLost
	}
	return closeErr
}

func topologyMonitorInterval(pollInterval time.Duration) time.Duration {
	if pollInterval < 250*time.Millisecond {
		return 250 * time.Millisecond
	}
	if pollInterval > 5*time.Second {
		return 5 * time.Second
	}
	return pollInterval
}

func waitForRetry(ctx context.Context, interval time.Duration) error {
	if interval <= 0 {
		interval = time.Second
	}
	timer := time.NewTimer(interval)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

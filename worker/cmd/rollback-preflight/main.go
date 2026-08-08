package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	narraw "narra-image-worker/internal/worker"
)

const (
	exitRollbackSafe                = 0
	exitRollbackUnsafe              = 2
	exitRollbackConfigInvalid       = 3
	exitRollbackDatabaseUnavailable = 4
	exitRollbackCheckFailed         = 5
)

type rollbackPreflightResult struct {
	ActiveV1Jobs       int64  `json:"active_v1_jobs"`
	Code               string `json:"code"`
	SchemaVersion      int    `json:"schema_version"`
	Status             string `json:"status"`
	UnresolvedHandoffs int64  `json:"unresolved_handoffs"`
}

type rollbackPreflightDeps struct {
	check    func(context.Context, *pgxpool.Pool) (narraw.RollbackSafetyReport, error)
	close    func(*pgxpool.Pool)
	loadURL  func() (string, error)
	openPool func(context.Context, string) (*pgxpool.Pool, error)
	ping     func(context.Context, *pgxpool.Pool) error
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	logger := narraw.NewJSONLogger(os.Stderr, slog.LevelInfo).With(
		"component", "rollback_preflight",
	)
	os.Exit(runRollbackPreflight(ctx, os.Stdout, logger, defaultRollbackPreflightDeps()))
}

func defaultRollbackPreflightDeps() rollbackPreflightDeps {
	return rollbackPreflightDeps{
		check:   narraw.CheckRollbackSafety,
		close:   func(pool *pgxpool.Pool) { pool.Close() },
		loadURL: narraw.LoadDatabaseURL,
		openPool: func(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
			return pgxpool.New(ctx, databaseURL)
		},
		ping: func(ctx context.Context, pool *pgxpool.Pool) error {
			return pool.Ping(ctx)
		},
	}
}

func runRollbackPreflight(
	ctx context.Context,
	output io.Writer,
	logger *slog.Logger,
	deps rollbackPreflightDeps,
) int {
	databaseURL, err := deps.loadURL()
	if err != nil {
		logger.Error("回滚预检配置无效", "event", "rollback_preflight_config_invalid", "error", err)
		writeRollbackResult(output, rollbackPreflightResult{
			Code: "CONFIG_INVALID", SchemaVersion: 1, Status: "error",
		})
		return exitRollbackConfigInvalid
	}

	pool, err := deps.openPool(ctx, databaseURL)
	if err != nil {
		logger.Error("回滚预检数据库连接池创建失败", "event", "rollback_preflight_pool_failed", "error", err)
		writeRollbackResult(output, rollbackPreflightResult{
			Code: "DATABASE_UNAVAILABLE", SchemaVersion: 1, Status: "error",
		})
		return exitRollbackDatabaseUnavailable
	}
	defer deps.close(pool)
	if err := deps.ping(ctx, pool); err != nil {
		logger.Error("回滚预检数据库不可用", "event", "rollback_preflight_database_unavailable", "error", err)
		writeRollbackResult(output, rollbackPreflightResult{
			Code: "DATABASE_UNAVAILABLE", SchemaVersion: 1, Status: "error",
		})
		return exitRollbackDatabaseUnavailable
	}

	report, err := deps.check(ctx, pool)
	if err != nil {
		logger.Error("回滚安全检查失败", "event", "rollback_preflight_check_failed", "error", err)
		writeRollbackResult(output, rollbackPreflightResult{
			Code: "PREFLIGHT_FAILED", SchemaVersion: 1, Status: "error",
		})
		return exitRollbackCheckFailed
	}
	result := rollbackPreflightResult{
		ActiveV1Jobs:       report.ActiveV1Jobs,
		SchemaVersion:      1,
		UnresolvedHandoffs: report.UnresolvedHandoffs,
	}
	if !report.Safe() {
		result.Code = "ROLLBACK_UNSAFE"
		result.Status = "unsafe"
		writeRollbackResult(output, result)
		return exitRollbackUnsafe
	}
	result.Code = "ROLLBACK_SAFE"
	result.Status = "safe"
	writeRollbackResult(output, result)
	return exitRollbackSafe
}

func writeRollbackResult(output io.Writer, result rollbackPreflightResult) {
	_ = json.NewEncoder(output).Encode(result)
}

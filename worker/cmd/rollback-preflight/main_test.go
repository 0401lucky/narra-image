package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	narraw "narra-image-worker/internal/worker"
)

func TestRunRollbackPreflightStableExitCodes(t *testing.T) {
	tests := []struct {
		name     string
		deps     rollbackPreflightDeps
		wantCode string
		wantExit int
	}{
		{
			name:     "safe",
			deps:     testRollbackDeps(narraw.RollbackSafetyReport{}, nil),
			wantCode: "ROLLBACK_SAFE",
			wantExit: exitRollbackSafe,
		},
		{
			name:     "unsafe",
			deps:     testRollbackDeps(narraw.RollbackSafetyReport{ActiveV1Jobs: 2, UnresolvedHandoffs: 1}, nil),
			wantCode: "ROLLBACK_UNSAFE",
			wantExit: exitRollbackUnsafe,
		},
		{
			name: "config",
			deps: rollbackPreflightDeps{
				loadURL: func() (string, error) { return "", errors.New("secret config failure") },
			},
			wantCode: "CONFIG_INVALID",
			wantExit: exitRollbackConfigInvalid,
		},
		{
			name: "database",
			deps: func() rollbackPreflightDeps {
				deps := testRollbackDeps(narraw.RollbackSafetyReport{}, nil)
				deps.ping = func(context.Context, *pgxpool.Pool) error {
					return errors.New("postgresql://admin:password@db/app")
				}
				return deps
			}(),
			wantCode: "DATABASE_UNAVAILABLE",
			wantExit: exitRollbackDatabaseUnavailable,
		},
		{
			name:     "check",
			deps:     testRollbackDeps(narraw.RollbackSafetyReport{}, errors.New("unsafe query details")),
			wantCode: "PREFLIGHT_FAILED",
			wantExit: exitRollbackCheckFailed,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var output bytes.Buffer
			logger := narraw.NewJSONLogger(io.Discard, slog.LevelError)
			exitCode := runRollbackPreflight(context.Background(), &output, logger, test.deps)
			if exitCode != test.wantExit {
				t.Fatalf("unexpected exit code: %d", exitCode)
			}
			var payload rollbackPreflightResult
			if err := json.Unmarshal(output.Bytes(), &payload); err != nil {
				t.Fatalf("decode output: %v", err)
			}
			if payload.Code != test.wantCode || payload.SchemaVersion != 1 {
				t.Fatalf("unexpected payload: %+v", payload)
			}
			if bytes.Contains(output.Bytes(), []byte("password")) || bytes.Contains(output.Bytes(), []byte("query details")) {
				t.Fatalf("preflight output leaked internal cause: %s", output.String())
			}
		})
	}
}

func testRollbackDeps(report narraw.RollbackSafetyReport, checkErr error) rollbackPreflightDeps {
	return rollbackPreflightDeps{
		check: func(context.Context, *pgxpool.Pool) (narraw.RollbackSafetyReport, error) {
			return report, checkErr
		},
		close:   func(*pgxpool.Pool) {},
		loadURL: func() (string, error) { return "postgresql://test", nil },
		openPool: func(context.Context, string) (*pgxpool.Pool, error) {
			return nil, nil
		},
		ping: func(context.Context, *pgxpool.Pool) error { return nil },
	}
}

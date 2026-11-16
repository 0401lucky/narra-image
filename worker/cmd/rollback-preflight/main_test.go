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
			name:     "image storage revision without v1 jobs",
			deps:     testRollbackDeps(narraw.RollbackSafetyReport{ImageStorageRevision: 1, CanvasStorageRevision: 2}, nil),
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

func TestRunRollbackPreflightReportsImageState(t *testing.T) {
	for _, report := range []narraw.RollbackSafetyReport{
		{ImageStorageRevision: 1},
		{CanvasStorageRevision: 2},
		{ManagedImageAssets: 3},
		{LocalImageObjects: 4},
		{ActiveImageReservations: 2},
		{UnresolvedImageObjects: 1},
		{ImageStorageRevision: 3, CanvasStorageRevision: 3},
		{ActiveImageHistoryJobs: 1},
		{UnresolvedImageHistoryItems: 2},
		{UnresolvedImageObservations: 3},
		{ActiveImageHistoryHolds: 1},
	} {
		var output bytes.Buffer
		exitCode := runRollbackPreflight(context.Background(), &output, narraw.NewJSONLogger(io.Discard, slog.LevelError), testRollbackDeps(report, nil))
		if exitCode != exitRollbackUnsafe {
			t.Fatalf("image storage was reported safe with no v1 jobs: %+v", report)
		}
		var payload rollbackPreflightResult
		if err := json.Unmarshal(output.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		if payload.Status != "unsafe" || payload.Code != "ROLLBACK_UNSAFE" || payload.ActiveV1Jobs != 0 || payload.UnresolvedHandoffs != 0 ||
			payload.ImageStorageRevision != report.ImageStorageRevision || payload.CanvasStorageRevision != report.CanvasStorageRevision ||
			payload.ManagedImageAssets != report.ManagedImageAssets || payload.LocalImageObjects != report.LocalImageObjects ||
			payload.ActiveImageReservations != report.ActiveImageReservations || payload.UnresolvedImageObjects != report.UnresolvedImageObjects ||
			payload.ActiveImageHistoryJobs != report.ActiveImageHistoryJobs || payload.UnresolvedImageHistoryItems != report.UnresolvedImageHistoryItems ||
			payload.UnresolvedImageObservations != report.UnresolvedImageObservations || payload.ActiveImageHistoryHolds != report.ActiveImageHistoryHolds {
			t.Fatalf("image rollback diagnostics were lost: %+v", payload)
		}
	}
}

func TestRunRollbackPreflightDoesNotLogInspectionDetails(t *testing.T) {
	for _, phase := range []string{"configuration", "pool", "database", "inspection"} {
		t.Run(phase, func(t *testing.T) {
			var output, logs bytes.Buffer
			detail := errors.New("SELECT private-inspection-detail FROM /srv/private-volume; token=private-credential")
			deps := testRollbackDeps(narraw.RollbackSafetyReport{}, nil)
			want := exitRollbackCheckFailed
			switch phase {
			case "configuration":
				deps.loadURL = func() (string, error) { return "", detail }
				want = exitRollbackConfigInvalid
			case "pool":
				deps.openPool = func(context.Context, string) (*pgxpool.Pool, error) { return nil, detail }
				want = exitRollbackDatabaseUnavailable
			case "database":
				deps.ping = func(context.Context, *pgxpool.Pool) error { return detail }
				want = exitRollbackDatabaseUnavailable
			case "inspection":
				deps.check = func(context.Context, *pgxpool.Pool) (narraw.RollbackSafetyReport, error) {
					return narraw.RollbackSafetyReport{}, detail
				}
			}
			exitCode := runRollbackPreflight(context.Background(), &output, narraw.NewJSONLogger(&logs, slog.LevelError), deps)
			if exitCode != want {
				t.Fatalf("unexpected failure exit: %d", exitCode)
			}
			for _, sensitive := range []string{"private-inspection-detail", "/srv/private-volume", "private-credential"} {
				if bytes.Contains(output.Bytes(), []byte(sensitive)) || bytes.Contains(logs.Bytes(), []byte(sensitive)) {
					t.Fatalf("preflight leaked inspection/configuration details: stdout=%q stderr=%q", output.String(), logs.String())
				}
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

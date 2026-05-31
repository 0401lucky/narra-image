package worker

import (
	"testing"
	"time"
)

func TestNormalizeDatabaseURLMovesPrismaSchema(t *testing.T) {
	got := normalizeDatabaseURL("postgresql://user:pass@localhost:5432/app?schema=public&sslmode=disable")

	if got != "postgresql://user:pass@localhost:5432/app?search_path=public&sslmode=disable" {
		t.Fatalf("unexpected database url: %s", got)
	}
}

func TestLoadConfigReadsWorkerHTTPAndMetricsSettings(t *testing.T) {
	t.Setenv("AUTH_SECRET", "unit-test-secret")
	t.Setenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/app?schema=public")
	t.Setenv("WORKER_HTTP_ADDR", ":9090")
	t.Setenv("WORKER_METRICS_WINDOW_MINUTES", "30")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig returned error: %v", err)
	}
	if cfg.HTTPAddr != ":9090" {
		t.Fatalf("unexpected worker http addr: %s", cfg.HTTPAddr)
	}
	if cfg.MetricsWindow != 30*time.Minute {
		t.Fatalf("unexpected metrics window: %s", cfg.MetricsWindow)
	}
}

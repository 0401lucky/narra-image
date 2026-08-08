package worker

import (
	"log/slog"
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
	setRequiredConfigEnv(t, RuntimeModeDedicated)
	t.Setenv("WORKER_HTTP_ADDR", ":9090")
	t.Setenv("WORKER_METRICS_TOKEN", "metrics-token-1234")
	t.Setenv("WORKER_METRICS_WINDOW_MINUTES", "30")
	t.Setenv("WORKER_SHUTDOWN_HARD_TIMEOUT_SECONDS", "12")
	t.Setenv("LOG_LEVEL", "debug")

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
	if cfg.MetricsToken != "metrics-token-1234" {
		t.Fatalf("unexpected metrics token: %s", cfg.MetricsToken)
	}
	if cfg.ShutdownHardTimeout != 12*time.Second {
		t.Fatalf("unexpected hard timeout: %s", cfg.ShutdownHardTimeout)
	}
	if cfg.LogLevel != slog.LevelDebug {
		t.Fatalf("unexpected log level: %s", cfg.LogLevel)
	}
}

func TestLoadConfigReadsVideoSettings(t *testing.T) {
	setRequiredConfigEnv(t, RuntimeModeDedicated)
	t.Setenv("WORKER_VIDEO_POLL_INTERVAL_MS", "3000")
	t.Setenv("BUILTIN_PROVIDER_VIDEO_CREDIT_COST", "30")
	t.Setenv("BUILTIN_PROVIDER_VIDEO_MODEL", "sora-2")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig returned error: %v", err)
	}
	if cfg.VideoPollInterval != 3*time.Second {
		t.Fatalf("unexpected video poll interval: %s", cfg.VideoPollInterval)
	}
	if cfg.BuiltInProviderVideoCreditCost != 30 {
		t.Fatalf("unexpected video credit cost: %d", cfg.BuiltInProviderVideoCreditCost)
	}
	if cfg.BuiltInProviderVideoModel != "sora-2" {
		t.Fatalf("unexpected video model: %s", cfg.BuiltInProviderVideoModel)
	}
}

func TestLoadConfigVideoSettingsDefaults(t *testing.T) {
	setRequiredConfigEnv(t, RuntimeModeDedicated)

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig returned error: %v", err)
	}
	if cfg.VideoPollInterval != 5*time.Second {
		t.Fatalf("unexpected default video poll interval: %s", cfg.VideoPollInterval)
	}
	if cfg.BuiltInProviderVideoCreditCost != 20 {
		t.Fatalf("unexpected default video credit cost: %d", cfg.BuiltInProviderVideoCreditCost)
	}
}

func TestLoadConfigRequiresExplicitRuntimeMode(t *testing.T) {
	setRequiredConfigEnv(t, RuntimeModeDedicated)
	t.Setenv("WORKER_RUNTIME_MODE", "")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("expected missing runtime mode error")
	}

	t.Setenv("WORKER_RUNTIME_MODE", "mixed")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("expected invalid runtime mode error")
	}
}

func TestLoadConfigUsesModeSpecificHTTPDefault(t *testing.T) {
	setRequiredConfigEnv(t, RuntimeModeEmbedded)
	t.Setenv("WORKER_HTTP_ADDR", "")
	if cfg, err := LoadConfig(); err != nil {
		t.Fatalf("LoadConfig embedded returned error: %v", err)
	} else if cfg.HTTPAddr != "127.0.0.1:8081" {
		t.Fatalf("unexpected embedded HTTP addr: %s", cfg.HTTPAddr)
	}

	setRequiredConfigEnv(t, RuntimeModeDedicated)
	if cfg, err := LoadConfig(); err != nil {
		t.Fatalf("LoadConfig dedicated returned error: %v", err)
	} else if cfg.HTTPAddr != "127.0.0.1:8081" {
		t.Fatalf("unexpected dedicated HTTP addr: %s", cfg.HTTPAddr)
	}
}

func TestLoadConfigValidatesMetricsTokenAndHardTimeout(t *testing.T) {
	setRequiredConfigEnv(t, RuntimeModeDedicated)
	t.Setenv("WORKER_METRICS_TOKEN", "too-short")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("expected short metrics token error")
	}

	t.Setenv("WORKER_METRICS_TOKEN", "metrics-token-1234")
	t.Setenv("WORKER_SHUTDOWN_HARD_TIMEOUT_SECONDS", "301")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("expected hard timeout upper bound error")
	}

	t.Setenv("WORKER_SHUTDOWN_HARD_TIMEOUT_SECONDS", "0")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("expected hard timeout lower bound error")
	}
}

func TestLoadConfigMatchesProductionAuthSecretRules(t *testing.T) {
	setRequiredConfigEnv(t, RuntimeModeDedicated)
	t.Setenv("AUTH_SECRET", "change-me")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("expected public auth secret error")
	}

	t.Setenv("AUTH_SECRET", "short-production-secret")
	t.Setenv("NODE_ENV", "production")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("expected production auth secret length error")
	}

	t.Setenv("AUTH_SECRET", "production-secret-with-at-least-32-characters")
	if _, err := LoadConfig(); err != nil {
		t.Fatalf("expected production auth secret to pass: %v", err)
	}
}

func setRequiredConfigEnv(t *testing.T, mode RuntimeMode) {
	t.Helper()
	t.Setenv("NODE_ENV", "test")
	t.Setenv("AUTH_SECRET", "unit-test-secret")
	t.Setenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/app?schema=public")
	t.Setenv("WORKER_RUNTIME_MODE", string(mode))
}

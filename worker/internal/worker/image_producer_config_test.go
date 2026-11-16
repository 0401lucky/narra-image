package worker

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestManagedWorkerValidatesPublicImageURL(t *testing.T) {
	for _, scenario := range []struct {
		name, appURL, nodeEnv string
		managed, valid        bool
	}{
		{name: "production-missing", nodeEnv: "production", managed: true},
		{name: "production-localhost", appURL: "http://localhost:3000", nodeEnv: "production", managed: true},
		{name: "production-localhost-subdomain", appURL: "https://images.localhost", nodeEnv: "production", managed: true},
		{name: "production-localhost-dot", appURL: "https://LOCALHOST.", nodeEnv: "production", managed: true},
		{name: "production-ipv4-loopback", appURL: "http://127.0.0.2:3000", nodeEnv: "production", managed: true},
		{name: "production-ipv6-loopback", appURL: "http://[::1]:3000", nodeEnv: "production", managed: true},
		{name: "production-mapped-loopback", appURL: "http://[::ffff:127.0.0.1]", nodeEnv: "production", managed: true},
		{name: "production-ipv4-unspecified", appURL: "http://0.0.0.0:3000", nodeEnv: "production", managed: true},
		{name: "production-ipv6-unspecified", appURL: "http://[::]:3000", nodeEnv: "production", managed: true},
		{name: "unsupported-scheme", appURL: "file:///images", nodeEnv: "test", managed: true},
		{name: "missing-host", appURL: "http://:3000", nodeEnv: "test", managed: true},
		{name: "credentials", appURL: "https://user:private-value@images.example.test", nodeEnv: "test", managed: true},
		{name: "query", appURL: "https://images.example.test?key=private-value", nodeEnv: "test", managed: true},
		{name: "empty-query", appURL: "https://images.example.test?", nodeEnv: "test", managed: true},
		{name: "fragment", appURL: "https://images.example.test#private-value", nodeEnv: "test", managed: true},
		{name: "public-production", appURL: "https://images.example.test", nodeEnv: "production", managed: true, valid: true},
		{name: "development-default", nodeEnv: "development", managed: true, valid: true},
		{name: "development-loopback", appURL: "http://127.0.0.1:3000", nodeEnv: "test", managed: true, valid: true},
		{name: "legacy-production-default", nodeEnv: "production", valid: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			setRequiredConfigEnv(t, RuntimeModeDedicated)
			t.Setenv("AUTH_SECRET", "unit-test-production-secret-at-least-32-characters")
			t.Setenv("NODE_ENV", scenario.nodeEnv)
			t.Setenv("APP_URL", scenario.appURL)
			t.Setenv("WORKER_JOB_TIMEOUT_SECONDS", "900")
			t.Setenv("IMAGE_STORAGE_BACKEND", "s3")
			managed := "false"
			if scenario.managed {
				managed = "true"
			}
			t.Setenv("IMAGE_STORAGE_MANAGED_ENABLED", managed)
			cfg, err := LoadConfig()
			if scenario.valid {
				if err != nil {
					t.Fatalf("valid producer configuration rejected: %v", err)
				}
				expectedURL := scenario.appURL
				if expectedURL == "" {
					expectedURL = "http://localhost:3000"
				}
				if cfg.AppURL != expectedURL || cfg.NodeEnv != scenario.nodeEnv {
					t.Fatal("producer did not retain its validated configuration")
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), "APP_URL") {
				t.Fatalf("expected public URL configuration failure, got %v", err)
			}
			if strings.Contains(err.Error(), "private-value") {
				t.Fatal("configuration failure exposed URL credentials")
			}
		})
	}
}

func TestManagedStorageRejectsInvalidProducerURLBeforeLocalIO(t *testing.T) {
	for _, appURL := range []string{"", "http://localhost:3000", "https://images.example.test?secret=private-value"} {
		t.Run(appURL, func(t *testing.T) {
			root := t.TempDir()
			storage, err := NewStorage(context.Background(), Config{
				AppURL: appURL, NodeEnv: "production", ImageStorageManagedEnabled: true,
				ImageStorageBackend: "local", ImageStoragePath: root,
				ImageStorageVolumeID: "00112233-4455-4677-8899-aabbccddeeff",
			})
			if storage != nil || err == nil || !strings.Contains(err.Error(), "APP_URL") {
				t.Fatalf("invalid producer URL reached local volume setup: %v", err)
			}
			if strings.Contains(err.Error(), "private-value") {
				t.Fatal("producer setup exposed the rejected URL")
			}
			entries, err := os.ReadDir(root)
			if err != nil || len(entries) != 0 {
				t.Fatalf("invalid producer configuration modified the volume: %v", err)
			}
		})
	}
}

func TestManagedBackfillRequiresPublicURLButVolumeInitializationDoesNot(t *testing.T) {
	t.Setenv("AUTH_SECRET", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("WORKER_RUNTIME_MODE", "")
	t.Setenv("NODE_ENV", "production")
	t.Setenv("APP_URL", "")
	t.Setenv("IMAGE_STORAGE_MANAGED_ENABLED", "true")
	t.Setenv("IMAGE_STORAGE_BACKEND", "local")
	t.Setenv("IMAGE_STORAGE_PATH", t.TempDir())
	t.Setenv("IMAGE_STORAGE_VOLUME_ID", "00112233-4455-4677-8899-aabbccddeeff")
	cfg, err := LoadStorageConfig()
	if err != nil {
		t.Fatalf("volume initialization incorrectly requires producer settings: %v", err)
	}
	volume, err := InitializeLocalImageVolume(context.Background(), LocalImageStoreConfig{
		RootDirectory: cfg.ImageStoragePath, VolumeID: cfg.ImageStorageVolumeID,
	})
	if err != nil || volume.VolumeID != cfg.ImageStorageVolumeID {
		t.Fatalf("volume initialization failed: %v", err)
	}
	if _, err := NewStorage(context.Background(), cfg); err == nil || !strings.Contains(err.Error(), "APP_URL") {
		t.Fatalf("backfill accepted the default production URL: %v", err)
	}
	cfg.AppURL = "https://images.example.test"
	storage, err := NewStorage(context.Background(), cfg)
	if err != nil || storage.localImages == nil {
		t.Fatalf("valid producer could not use the initialized volume: %v", err)
	}
}

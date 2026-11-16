package worker

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5"
)

// fakeObjectStorage 注入到 Storage.client，让单测在不依赖真实 S3 的情况下验证持久化语义。
type fakeObjectStorage struct {
	puts []s3.PutObjectInput
	err  error
}

func (f *fakeObjectStorage) PutObject(_ context.Context, params *s3.PutObjectInput, _ ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	f.puts = append(f.puts, *params)
	if f.err != nil {
		return nil, f.err
	}
	return &s3.PutObjectOutput{}, nil
}

func s3TestStorage() *Storage {
	return &Storage{
		client: &fakeObjectStorage{},
		cfg: Config{
			S3Bucket:        "test-bucket",
			S3Endpoint:      "https://s3.example.test",
			S3PublicBaseURL: "https://cdn.example.test",
			S3Region:        "auto",
		},
	}
}

func TestPersistImageS3ReturnsMetadata(t *testing.T) {
	storage := s3TestStorage()
	persisted, err := storage.PersistImage(context.Background(), "user-1", minimalPNG(8, 8), "png", "image/png")
	if err != nil {
		t.Fatalf("PersistImage returned error: %v", err)
	}
	if persisted.MediaStorage != MediaStorageS3 {
		t.Fatalf("expected media storage S3, got %q", persisted.MediaStorage)
	}
	if !strings.HasPrefix(persisted.URL, "https://cdn.example.test/user-1/") {
		t.Fatalf("unexpected public url: %s", persisted.URL)
	}
	if persisted.StorageKey == "" || !strings.HasPrefix(persisted.StorageKey, "user-1/") {
		t.Fatalf("unexpected storage key: %q", persisted.StorageKey)
	}
}

func TestPersistImageDevelopmentFallbackIsB64(t *testing.T) {
	storage := &Storage{cfg: Config{EnableLocalImageFallback: true}}
	persisted, err := storage.PersistImage(context.Background(), "user-1", minimalPNG(8, 8), "png", "image/png")
	if err != nil {
		t.Fatalf("PersistImage returned error: %v", err)
	}
	if persisted.MediaStorage != MediaStorageB64 {
		t.Fatalf("expected media storage B64, got %q", persisted.MediaStorage)
	}
	if !strings.HasPrefix(persisted.URL, "data:image/png;base64,") {
		t.Fatalf("expected data url, got %s", persisted.URL[:min(len(persisted.URL), 40)])
	}
	if persisted.StorageKey != "" {
		t.Fatalf("expected empty storage key for B64, got %q", persisted.StorageKey)
	}
}

func TestPersistImageProductionRejectsFallbackWithNodeEnv(t *testing.T) {
	storage := &Storage{cfg: Config{
		EnableLocalImageFallback: true,
		NodeEnv:                  "production",
	}}
	_, err := storage.PersistImage(context.Background(), "user-1", minimalPNG(8, 8), "png", "image/png")
	if err == nil || !strings.Contains(err.Error(), "生产环境禁止") {
		t.Fatalf("expected production fallback rejection, got %v", err)
	}
}

func TestPersistImageProductionDatabaseStorage(t *testing.T) {
	for _, cfg := range []Config{
		{NodeEnv: "production", EnableDatabaseImageStorage: true},
		{AppURL: "https://narra.example.com", EnableDatabaseImageStorage: true},
		{NodeEnv: "production", EnableDatabaseImageStorage: true, EnableLocalImageFallback: true},
	} {
		t.Run(cfg.NodeEnv+cfg.AppURL, func(t *testing.T) {
			storage := &Storage{cfg: cfg}
			data := minimalPNG(8, 8)
			persisted, err := storage.PersistImage(context.Background(), "user-1", data, "png", "image/png")
			if err != nil {
				t.Fatalf("explicit production database storage rejected: %v", err)
			}
			assertDatabaseImage(t, persisted, data)
		})
	}
}

func TestPersistImageS3TakesPriorityOverDatabaseStorage(t *testing.T) {
	storage := s3TestStorage()
	storage.cfg.NodeEnv = "production"
	storage.cfg.EnableDatabaseImageStorage = true
	persisted, err := storage.PersistImage(context.Background(), "user-1", minimalPNG(8, 8), "png", "image/png")
	if err != nil {
		t.Fatal(err)
	}
	if persisted.MediaStorage != MediaStorageS3 || persisted.StorageKey == "" || !strings.HasPrefix(persisted.URL, "https://cdn.example.test/user-1/") {
		t.Fatalf("S3 priority was lost: %+v", persisted)
	}
}

func TestPersistImageS3FailureDoesNotFallBackToDatabase(t *testing.T) {
	storage := s3TestStorage()
	storage.cfg.NodeEnv = "production"
	storage.cfg.EnableDatabaseImageStorage = true
	storage.cfg.EnableLocalImageFallback = true
	failure := errors.New("fixture S3 PUT failed")
	storage.client.(*fakeObjectStorage).err = failure
	persisted, err := storage.PersistImage(context.Background(), "user-1", minimalPNG(8, 8), "png", "image/png")
	if !errors.Is(err, failure) || persisted != (PersistedMedia{}) {
		t.Fatalf("S3 failure was replaced by database persistence: %+v %v", persisted, err)
	}
}

func TestPersistImageManagedModeDoesNotFallBackWithoutRepository(t *testing.T) {
	for _, backend := range []string{"local", "s3"} {
		t.Run(backend, func(t *testing.T) {
			storage := s3TestStorage()
			storage.cfg.NodeEnv = "production"
			storage.cfg.ImageStorageManagedEnabled = true
			storage.cfg.ImageStorageBackend = backend
			storage.cfg.EnableDatabaseImageStorage = true
			storage.cfg.EnableLocalImageFallback = true
			persisted, err := storage.PersistImage(context.Background(), "user-1", minimalPNG(8, 8), "png", "image/png")
			var imageErr ImageStorageError
			if !errors.As(err, &imageErr) || imageErr.Code != "IMAGE_STORAGE_UNAVAILABLE" || persisted != (PersistedMedia{}) {
				t.Fatalf("managed failure escaped its storage policy: %+v %v", persisted, err)
			}
			if len(storage.client.(*fakeObjectStorage).puts) != 0 {
				t.Fatal("managed failure attempted a legacy S3 PUT")
			}
		})
	}
}

type imageStorageQuotaQueryer struct {
	location []byte
}

func (queryer *imageStorageQuotaQueryer) QueryRow(_ context.Context, query string, _ ...any) pgx.Row {
	switch {
	case strings.Contains(query, "SELECT image_register_location("):
		return imageTestRow{payload: queryer.location}
	case strings.Contains(query, "SELECT image_reserve_write("):
		return imageTestRow{err: ImageStorageError{Code: "IMAGE_QUOTA_EXCEEDED"}}
	case strings.Contains(query, "SELECT image_request_quota_cleanup("):
		return imageTestRow{payload: []byte("null")}
	default:
		return imageTestRow{err: errors.New("unexpected image storage query")}
	}
}

func TestPersistImageDatabaseOptInDoesNotBypassManagedQuota(t *testing.T) {
	for _, backend := range []string{"local", "s3"} {
		t.Run(backend, func(t *testing.T) {
			storage := s3TestStorage()
			storage.cfg.NodeEnv = "production"
			storage.cfg.AppURL = "https://narra.example.com"
			storage.cfg.ImageStorageManagedEnabled = true
			storage.cfg.ImageStorageBackend = backend
			storage.cfg.ImageStorageVolumeID = "00112233-4455-4677-8899-aabbccddeeff"
			storage.cfg.EnableDatabaseImageStorage = true
			storage.cfg.EnableLocalImageFallback = true
			location, err := storage.imageLocation()
			if err != nil {
				t.Fatal(err)
			}
			payload, err := json.Marshal(ImageLocation{ImageLocationInput: location, PhysicalNamespace: "fixture", CreatedAt: "2026-11-16T00:00:00Z"})
			if err != nil {
				t.Fatal(err)
			}
			storage.imageRepository = NewImageRepository(&imageStorageQuotaQueryer{location: payload})
			persisted, err := storage.PersistImage(context.Background(), "user-1", minimalPNG(8, 8), "png", "image/png")
			var imageErr ImageStorageError
			if !errors.As(err, &imageErr) || imageErr.Code != "IMAGE_QUOTA_EXCEEDED" || persisted != (PersistedMedia{}) {
				t.Fatalf("managed quota was replaced by another persistence mode: %+v %v", persisted, err)
			}
			if len(storage.client.(*fakeObjectStorage).puts) != 0 {
				t.Fatal("managed quota failure attempted a legacy S3 PUT")
			}
		})
	}
}

func TestPersistImageDatabaseStorageKeepsByteLimit(t *testing.T) {
	storage := &Storage{cfg: Config{NodeEnv: "production", EnableDatabaseImageStorage: true}}
	persisted, err := storage.PersistImage(context.Background(), "user-1", make([]byte, ImageMaxBytes+1), "png", "image/png")
	if err == nil || !strings.Contains(err.Error(), "超过 50MiB") || persisted != (PersistedMedia{}) {
		t.Fatalf("database image storage bypassed the byte limit: %+v %v", persisted, err)
	}
}

func TestPersistImageFromURLProductionDatabaseStorage(t *testing.T) {
	data := minimalPNG(8, 8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(data)
	}))
	defer server.Close()
	storage := &Storage{cfg: Config{NodeEnv: "production", EnableDatabaseImageStorage: true}}
	persisted, err := storage.PersistImageFromURL(context.Background(), "user-1", server.URL+"/temporary.png", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	assertDatabaseImage(t, PersistedMedia{URL: persisted.URL, MediaStorage: persisted.MediaStorage, StorageKey: persisted.StorageKey}, data)
	if persisted.MimeType != "image/png" || !bytes.Equal(persisted.Data, data) {
		t.Fatal("downloaded image content or MIME changed")
	}
}

func TestNormalizeGeneratedImageProductionDatabaseStorage(t *testing.T) {
	data := minimalPNG(8, 8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(data)
	}))
	defer server.Close()
	for name, item := range map[string]map[string]any{
		"base64":     {"b64_json": base64.StdEncoding.EncodeToString(data)},
		"remote-url": {"url": server.URL + "/temporary.png"},
	} {
		t.Run(name, func(t *testing.T) {
			storage := &Storage{cfg: Config{NodeEnv: "production", EnableDatabaseImageStorage: true}}
			image, err := normalizeGeneratedImage(context.Background(), storage, GenerationJob{UserID: "user-1", OutputFormat: "png"}, item, imagePayload{})
			if err != nil {
				t.Fatalf("production result could not be normalized: %v", err)
			}
			assertDatabaseImage(t, PersistedMedia{URL: image.URL, MediaStorage: image.MediaStorage, StorageKey: image.StorageKey}, data)
			if image.Width == nil || image.Height == nil || *image.Width != 8 || *image.Height != 8 {
				t.Fatal("production result lost its dimensions")
			}
		})
	}
}

func assertDatabaseImage(t *testing.T, persisted PersistedMedia, want []byte) {
	t.Helper()
	if persisted.MediaStorage != MediaStorageB64 || persisted.StorageKey != "" {
		t.Fatalf("incorrect database media metadata: %+v", persisted)
	}
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(persisted.URL, prefix) {
		t.Fatalf("database image does not have the expected MIME prefix")
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(persisted.URL, prefix))
	if err != nil || !bytes.Equal(decoded, want) {
		t.Fatalf("database image does not retain complete bytes: %v", err)
	}
}

func TestPersistImageProductionRejectsFallbackWithExplicitAppURL(t *testing.T) {
	storage := &Storage{cfg: Config{
		AppURL:                   "https://narra.example.com",
		EnableLocalImageFallback: true,
	}}
	_, err := storage.PersistImage(context.Background(), "user-1", minimalPNG(8, 8), "png", "image/png")
	if err == nil || !strings.Contains(err.Error(), "生产环境禁止") {
		t.Fatalf("expected production fallback rejection, got %v", err)
	}
}

func TestPersistImageWithoutStorageAndWithoutFallbackFails(t *testing.T) {
	storage := &Storage{cfg: Config{}}
	_, err := storage.PersistImage(context.Background(), "user-1", minimalPNG(8, 8), "png", "image/png")
	if err == nil || !strings.Contains(err.Error(), "没有可用的图片存储配置") {
		t.Fatalf("expected missing storage error, got %v", err)
	}
}

func TestPersistVideoWithoutObjectStorageFails(t *testing.T) {
	for _, cfg := range []Config{
		{EnableLocalImageFallback: true},
		{NodeEnv: "production", EnableDatabaseImageStorage: true},
		{NodeEnv: "production", ImageStorageManagedEnabled: true, ImageStorageBackend: "local", EnableDatabaseImageStorage: true, EnableLocalImageFallback: true},
	} {
		storage := &Storage{cfg: cfg}
		persisted, err := storage.PersistVideo(context.Background(), "user-1", []byte("mp4"))
		if err == nil || !strings.Contains(err.Error(), "未配置对象存储") || persisted != (PersistedMedia{}) {
			t.Fatalf("expected no-object-storage video error, got %v", err)
		}
	}
}

func TestPersistVideoS3ReturnsMetadata(t *testing.T) {
	storage := s3TestStorage()
	persisted, err := storage.PersistVideo(context.Background(), "user-1", []byte("fake-mp4"))
	if err != nil {
		t.Fatalf("PersistVideo returned error: %v", err)
	}
	if persisted.MediaStorage != MediaStorageS3 {
		t.Fatalf("expected media storage S3, got %q", persisted.MediaStorage)
	}
	if !strings.HasSuffix(persisted.URL, ".mp4") {
		t.Fatalf("unexpected video url: %s", persisted.URL)
	}
	if persisted.StorageKey == "" {
		t.Fatal("expected storage key for video")
	}
	fake := storage.client.(*fakeObjectStorage)
	if len(fake.puts) != 1 {
		t.Fatalf("expected 1 s3 put, got %d", len(fake.puts))
	}
	if aws.ToString(fake.puts[0].ContentType) != "video/mp4" {
		t.Fatalf("unexpected content type: %s", aws.ToString(fake.puts[0].ContentType))
	}
	if got := fake.puts[0].Body; got == nil || got == bytes.NewReader(nil) {
		t.Fatalf("missing body in s3 put")
	}
}

func TestIsProductionEnvironment(t *testing.T) {
	cases := []struct {
		cfg  Config
		want bool
	}{
		{Config{}, false},
		{Config{NodeEnv: "development"}, false},
		{Config{NodeEnv: "test"}, false},
		{Config{NodeEnv: "production"}, true},
		{Config{AppURL: "http://localhost:3000"}, false},
		{Config{AppURL: "http://127.0.0.1:3000"}, false},
		{Config{AppURL: "http://0.0.0.0:3000"}, false},
		{Config{AppURL: "http://api.localhost:3000"}, false},
		{Config{AppURL: "https://narra.example.com"}, true},
		{Config{NodeEnv: "development", AppURL: "https://narra.example.com"}, true},
	}
	for _, tc := range cases {
		if got := tc.cfg.isProductionEnvironment(); got != tc.want {
			t.Errorf("cfg %+v: isProductionEnvironment = %v, want %v", tc.cfg, got, tc.want)
		}
	}
}

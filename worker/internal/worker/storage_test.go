package worker

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// fakeObjectStorage 注入到 Storage.client，让单测在不依赖真实 S3 的情况下验证持久化语义。
type fakeObjectStorage struct {
	puts []s3.PutObjectInput
}

func (f *fakeObjectStorage) PutObject(_ context.Context, params *s3.PutObjectInput, _ ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	f.puts = append(f.puts, *params)
	return &s3.PutObjectOutput{}, nil
}

func s3TestStorage() *Storage {
	return &Storage{
		client: &fakeObjectStorage{},
		cfg: Config{
			S3Bucket:        "test-bucket",
			S3Endpoint:      "https://s3.example.test",
			S3PublicBaseURL: "https://cdn.example.test",
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
	storage := &Storage{cfg: Config{EnableLocalImageFallback: true}}
	_, err := storage.PersistVideo(context.Background(), "user-1", []byte("mp4"))
	if err == nil || !strings.Contains(err.Error(), "未配置对象存储") {
		t.Fatalf("expected no-object-storage video error, got %v", err)
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

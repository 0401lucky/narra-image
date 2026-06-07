package worker

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestGenerateVideoPollsUntilCompletedAndPersists(t *testing.T) {
	polls := 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/videos":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "vid_123", "status": "queued"})
		case r.Method == http.MethodGet && r.URL.Path == "/file.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("fake-mp4-bytes"))
		case r.Method == http.MethodGet && r.URL.Path == "/videos/vid_123":
			polls++
			if polls >= 2 {
				// 完成：渠道把成品 mp4 URL 放在 remixed_from_video_id。
				_ = json.NewEncoder(w).Encode(map[string]any{
					"id":                    "vid_123",
					"status":                "completed",
					"remixed_from_video_id": server.URL + "/file.mp4",
					"seconds":               "8",
					"size":                  "1280x720",
				})
			} else {
				_ = json.NewEncoder(w).Encode(map[string]any{"id": "vid_123", "status": "in_progress", "progress": 30})
			}
		default:
			http.Error(w, "unexpected "+r.Method+" "+r.URL.Path, http.StatusNotFound)
		}
	}))
	defer server.Close()

	storage := &Storage{cfg: Config{EnableLocalImageFallback: true}}
	job := GenerationJob{
		ID:             "job_v1",
		UserID:         "user_1",
		GenerationType: "TEXT_TO_VIDEO",
		Model:          "agnes-video-v2.0",
		Prompt:         "海浪慢镜头",
		Size:           "1280x720",
	}
	provider := ProviderConfig{APIKey: "test-key", BaseURL: server.URL, Model: "agnes-video-v2.0"}

	result, err := generateVideo(context.Background(), storage, job, provider, time.Millisecond)
	if err != nil {
		t.Fatalf("generateVideo returned error: %v", err)
	}
	// 测试 storage 未配 S3，应直接回退为渠道公开 URL（不下载、不转存）。
	if result.URL != server.URL+"/file.mp4" {
		t.Fatalf("expected channel url %s, got %s", server.URL+"/file.mp4", result.URL)
	}
	if polls < 2 {
		t.Fatalf("expected at least 2 polls, got %d", polls)
	}
	if result.DurationSeconds == nil || *result.DurationSeconds != 8 {
		t.Fatalf("expected duration 8, got %v", result.DurationSeconds)
	}
	if result.Width == nil || *result.Width != 1280 || result.Height == nil || *result.Height != 720 {
		t.Fatalf("expected 1280x720 dimensions, got %v x %v", result.Width, result.Height)
	}
}

func TestGenerateVideoFallsBackToVideoGenerationsEndpoint(t *testing.T) {
	var sawFallback bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/videos":
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		case r.Method == http.MethodPost && r.URL.Path == "/videos/generations":
			sawFallback = true
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode fallback request: %v", err)
			}
			if body["model"] != "qwen3.6-plus-video" {
				t.Fatalf("expected qwen model, got %#v", body["model"])
			}
			if body["prompt"] != "海边日落延时摄影" {
				t.Fatalf("expected prompt to be forwarded, got %#v", body["prompt"])
			}
			if body["ratio"] != "16:9" {
				t.Fatalf("expected ratio from aspectRatio, got %#v", body["ratio"])
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"created": 123,
				"data": []map[string]any{{
					"ratio": "16:9",
					"url":   "https://cdn.qwenlm.ai/t2v/fake-video.mp4",
				}},
			})
		default:
			http.Error(w, "unexpected "+r.Method+" "+r.URL.Path, http.StatusNotFound)
		}
	}))
	defer server.Close()

	storage := &Storage{cfg: Config{EnableLocalImageFallback: true}}
	job := GenerationJob{
		ID:              "job_qwen",
		UserID:          "user_1",
		GenerationType:  "TEXT_TO_VIDEO",
		Model:           "qwen3.6-plus-video",
		Prompt:          "海边日落延时摄影",
		Size:            "1280x720",
		DurationSeconds: sql.NullInt32{Int32: 8, Valid: true},
		AspectRatio:     sql.NullString{String: "16:9", Valid: true},
	}
	provider := ProviderConfig{APIKey: "test-key", BaseURL: server.URL, Model: "qwen3.6-plus-video"}

	result, err := generateVideo(context.Background(), storage, job, provider, time.Millisecond)
	if err != nil {
		t.Fatalf("generateVideo returned error: %v", err)
	}
	if !sawFallback {
		t.Fatal("expected /videos/generations fallback to be used")
	}
	if result.URL != "https://cdn.qwenlm.ai/t2v/fake-video.mp4" {
		t.Fatalf("expected qwen cdn url, got %s", result.URL)
	}
	if result.DurationSeconds == nil || *result.DurationSeconds != 8 {
		t.Fatalf("expected duration fallback 8, got %v", result.DurationSeconds)
	}
	if result.Width == nil || *result.Width != 1280 || result.Height == nil || *result.Height != 720 {
		t.Fatalf("expected 1280x720 dimensions, got %v x %v", result.Width, result.Height)
	}
}

func TestGenerateVideoFallbackRespectsVersionedBaseURL(t *testing.T) {
	var sawFallback bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/videos":
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		case r.Method == http.MethodPost && r.URL.Path == "/v1/videos/generations":
			sawFallback = true
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{{"url": "https://cdn.qwenlm.ai/t2v/versioned.mp4"}},
			})
		default:
			http.Error(w, "unexpected "+r.Method+" "+r.URL.Path, http.StatusNotFound)
		}
	}))
	defer server.Close()

	storage := &Storage{cfg: Config{EnableLocalImageFallback: true}}
	job := GenerationJob{
		GenerationType: "TEXT_TO_VIDEO",
		Model:          "qwen3.6-plus-video",
		Prompt:         "城市霓虹",
		Size:           "720x1280",
	}
	provider := ProviderConfig{APIKey: "test-key", BaseURL: server.URL + "/v1", Model: "qwen3.6-plus-video"}

	result, err := generateVideo(context.Background(), storage, job, provider, time.Millisecond)
	if err != nil {
		t.Fatalf("generateVideo returned error: %v", err)
	}
	if !sawFallback {
		t.Fatal("expected /v1/videos/generations fallback to be used")
	}
	if result.URL != "https://cdn.qwenlm.ai/t2v/versioned.mp4" {
		t.Fatalf("expected qwen cdn url, got %s", result.URL)
	}
	if result.Width == nil || *result.Width != 720 || result.Height == nil || *result.Height != 1280 {
		t.Fatalf("expected 720x1280 dimensions, got %v x %v", result.Width, result.Height)
	}
}

func TestGenerateVideoReturnsErrorOnFailedStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/videos":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "vid_err", "status": "queued"})
		case r.Method == http.MethodGet && r.URL.Path == "/videos/vid_err":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "vid_err", "status": "failed"})
		default:
			http.Error(w, "unexpected path", http.StatusNotFound)
		}
	}))
	defer server.Close()

	storage := &Storage{cfg: Config{EnableLocalImageFallback: true}}
	job := GenerationJob{ID: "job_e", GenerationType: "TEXT_TO_VIDEO", Model: "agnes-video-v2.0", Prompt: "x", Size: "1280x720"}
	provider := ProviderConfig{APIKey: "k", BaseURL: server.URL, Model: "agnes-video-v2.0"}

	_, err := generateVideo(context.Background(), storage, job, provider, time.Millisecond)
	if err == nil {
		t.Fatal("expected error on failed status, got nil")
	}
}

// TestImageToVideoCreateFailureReturnsFriendlyError：图生视频在渠道 create 失败时
// （agnes litellm 对 multipart 转发故障会 500），应返回明确的用户可读提示，而非裸渠道错误。
func TestImageToVideoCreateFailureReturnsFriendlyError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/videos" {
			http.Error(w, `{"code":"fail_to_fetch_task","message":"litellm.InternalServerError"}`, http.StatusInternalServerError)
			return
		}
		http.Error(w, "unexpected "+r.Method+" "+r.URL.Path, http.StatusNotFound)
	}))
	defer server.Close()

	storage := &Storage{cfg: Config{EnableLocalImageFallback: true}}
	job := GenerationJob{
		ID:              "job_i2v",
		UserID:          "user_1",
		GenerationType:  "IMAGE_TO_VIDEO",
		Model:           "agnes-video-v2.0",
		Prompt:          "让苹果旋转",
		Size:            "1280x720",
		SourceImageURLs: []string{"https://example.com/apple.png"},
	}
	provider := ProviderConfig{APIKey: "k", BaseURL: server.URL, Model: "agnes-video-v2.0"}

	_, err := generateVideo(context.Background(), storage, job, provider, time.Millisecond)
	if err == nil {
		t.Fatal("expected error on image-to-video channel failure, got nil")
	}
	if !strings.Contains(err.Error(), "图生视频暂不可用") {
		t.Fatalf("expected friendly image-to-video error, got: %v", err)
	}
}

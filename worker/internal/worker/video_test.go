package worker

import (
	"context"
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
	if !strings.HasPrefix(result.URL, "data:video/mp4;base64,") {
		t.Fatalf("unexpected video url: %s", result.URL)
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

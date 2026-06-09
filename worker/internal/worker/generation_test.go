package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGenerateWithImageGenerationOmitsResponseFormat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/images/generations" {
			http.Error(w, "unexpected request", http.StatusNotFound)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if _, ok := body["response_format"]; ok {
			t.Fatalf("expected response_format to be omitted, got %#v", body["response_format"])
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{{"b64_json": "Y2F0"}},
		})
	}))
	defer server.Close()

	payload, err := generateWithImageGeneration(context.Background(), GenerationJob{
		Count:  1,
		Model:  "gpt-image-2",
		Prompt: "生成一只小猫",
		Size:   "auto",
	}, ProviderConfig{APIKey: "test-key", BaseURL: server.URL})
	if err != nil {
		t.Fatalf("generateWithImageGeneration returned error: %v", err)
	}
	if len(payload.Data) != 1 || payload.Data[0]["b64_json"] != "Y2F0" {
		t.Fatalf("unexpected payload: %#v", payload.Data)
	}
}

func TestGenerateWithImageEditOmitsResponseFormat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/images/edits" {
			http.Error(w, "unexpected request", http.StatusNotFound)
			return
		}
		reader, err := r.MultipartReader()
		if err != nil {
			t.Fatalf("read multipart request: %v", err)
		}
		seenResponseFormat := false
		imageContentType := ""
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatalf("read multipart part: %v", err)
			}
			if part.FormName() != "response_format" {
				if part.FormName() == "image" {
					imageContentType = part.Header.Get("Content-Type")
				}
				continue
			}
			seenResponseFormat = true
		}
		if seenResponseFormat {
			t.Fatal("expected multipart response_format to be omitted")
		}
		if imageContentType != "image/png" {
			t.Fatalf("expected image part Content-Type image/png, got %q", imageContentType)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{{"b64_json": "Y2F0"}},
		})
	}))
	defer server.Close()

	payload, err := generateWithImageEdit(
		context.Background(),
		GenerationJob{
			Model:  "gpt-image-2",
			Prompt: "按参考图生成小猫",
			Size:   "auto",
		},
		ProviderConfig{APIKey: "test-key", BaseURL: server.URL},
		[]SourceImage{{
			Data:     []byte("fake-image"),
			FileName: "source.png",
			MimeType: "image/png",
		}},
	)
	if err != nil {
		t.Fatalf("generateWithImageEdit returned error: %v", err)
	}
	if len(payload.Data) != 1 || payload.Data[0]["b64_json"] != "Y2F0" {
		t.Fatalf("unexpected payload: %#v", payload.Data)
	}
}

func TestImageDataURLSniffsOctetStreamImage(t *testing.T) {
	got := imageDataURL(SourceImage{
		Data:     minimalPNG(32, 32),
		FileName: "source.bin",
		MimeType: "application/octet-stream",
	})

	if !strings.HasPrefix(got, "data:image/png;base64,") {
		t.Fatalf("expected image/png data URL, got %s", got[:min(len(got), 64)])
	}
}

func TestNormalizeGeneratedImagePersistsRemoteURL(t *testing.T) {
	imageData := minimalPNG(640, 480)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/generated.png" {
			http.Error(w, "unexpected request", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(imageData)
	}))
	defer server.Close()

	storage := &Storage{cfg: Config{EnableLocalImageFallback: true}}
	record, err := normalizeGeneratedImage(
		context.Background(),
		storage,
		GenerationJob{UserID: "user-1"},
		map[string]any{"url": server.URL + "/generated.png"},
		imagePayload{},
	)
	if err != nil {
		t.Fatalf("normalizeGeneratedImage returned error: %v", err)
	}
	if strings.HasPrefix(record.URL, server.URL) {
		t.Fatalf("expected persisted image URL, got raw URL: %s", record.URL)
	}
	if !strings.HasPrefix(record.URL, "data:image/png;base64,") {
		t.Fatalf("expected local fallback data URL, got %s", record.URL)
	}
	if record.Width == nil || *record.Width != 640 || record.Height == nil || *record.Height != 480 {
		t.Fatalf("unexpected dimensions: width=%v height=%v", record.Width, record.Height)
	}
}

func TestLoadSourceImageSniffsOctetStreamResponse(t *testing.T) {
	imageData := minimalPNG(320, 240)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(imageData)
	}))
	defer server.Close()

	image, err := loadSourceImage(context.Background(), server.URL+"/source.bin", 0)
	if err != nil {
		t.Fatalf("loadSourceImage returned error: %v", err)
	}
	if image.MimeType != "image/png" {
		t.Fatalf("expected sniffed image/png, got %q", image.MimeType)
	}
	if image.FileName != "source.bin" {
		t.Fatalf("expected original filename, got %q", image.FileName)
	}
}

func minimalPNG(width int, height int) []byte {
	data := make([]byte, 13)
	data[0], data[1], data[2], data[3] = byte(width>>24), byte(width>>16), byte(width>>8), byte(width)
	data[4], data[5], data[6], data[7] = byte(height>>24), byte(height>>16), byte(height>>8), byte(height)
	data[8] = 8

	return bytes.Join([][]byte{
		{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a},
		{0x00, 0x00, 0x00, 0x0d},
		[]byte("IHDR"),
		data,
		make([]byte, 4),
	}, nil)
}

package worker

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGenerateWithImageGenerationRequestsB64JSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/images/generations" {
			http.Error(w, "unexpected request", http.StatusNotFound)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if body["response_format"] != "b64_json" {
			t.Fatalf("expected response_format=b64_json, got %#v", body["response_format"])
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

func TestGenerateWithImageEditRequestsB64JSON(t *testing.T) {
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
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatalf("read multipart part: %v", err)
			}
			if part.FormName() != "response_format" {
				continue
			}
			value, err := io.ReadAll(part)
			if err != nil {
				t.Fatalf("read response_format field: %v", err)
			}
			seenResponseFormat = strings.TrimSpace(string(value)) == "b64_json"
		}
		if !seenResponseFormat {
			t.Fatal("expected multipart response_format=b64_json")
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

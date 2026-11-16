package worker

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGatewayQueryKeepsSuccessfulHistoryAndMarksCleanedImages(t *testing.T) {
	job := gatewayJob{ID: "history-job", Status: "SUCCEEDED", Model: "gpt-image-2", CreditsSpent: 5}
	result := formatGatewayQueryResponse(job, []gatewayImage{
		{ID: "cleaned", URL: "https://old.example.test/gone.png", Availability: "cleaned"},
		{ID: "legacy", URL: "https://old.example.test/kept.png"},
	})
	if result["status"] != "succeeded" || result["model"] != job.Model {
		t.Fatal("cleanup rewrote generation facts")
	}
	images := result["images"].([]any)
	cleaned := images[0].(map[string]any)
	legacy := images[1].(map[string]any)
	if cleaned["availability"] != "cleaned" || cleaned["url"] != nil || legacy["availability"] != "available" || legacy["url"] == nil {
		t.Fatalf("wrong image availability projection: %v", images)
	}
}

func TestGatewayReplayDoesNotReadOrRenderCleanedOutput(t *testing.T) {
	worker := New(nil, Config{ImageStorageManagedEnabled: true}, nil)
	result := gatewayJobResult{JobID: "history-job", Status: "SUCCEEDED", Images: []gatewayImage{{ID: "cleaned", URL: "https://old.example.test/gone.png", Availability: "cleaned"}}}
	for _, endpoint := range []string{"images.generations", "chat.completions", "responses"} {
		t.Run(endpoint, func(t *testing.T) {
			envelope := &gatewayEnvelope{Endpoint: endpoint, JobID: result.JobID}
			envelope.Payload.ResponseFormat = "b64_json"
			recorder := httptest.NewRecorder()
			worker.writeGatewayEndpointResponse(recorder, envelope, result)
			if recorder.Code != http.StatusGone || strings.Contains(recorder.Body.String(), result.Images[0].URL) {
				t.Fatalf("cleaned output was still actionable: %d %s", recorder.Code, recorder.Body.String())
			}
			var payload struct {
				Error struct {
					Code    string `json:"code"`
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil || payload.Error.Code != "IMAGE_UNAVAILABLE" || payload.Error.Message != "图片已清理" {
				t.Fatalf("wrong cleaned-output response: %s", recorder.Body.String())
			}
		})
	}
}

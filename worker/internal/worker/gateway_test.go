package worker

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestGatewaySignatureRoundTrip(t *testing.T) {
	secret := "gateway-test-secret-0123456789"
	body := []byte(`{"hello":"world"}`)
	expected := gatewaySignature(secret, body)

	worker := New(nil, Config{AuthSecret: secret}, nil)
	if err := worker.verifyGatewaySignature(body, expected); err != nil {
		t.Fatalf("valid signature rejected: %v", err)
	}
	if err := worker.verifyGatewaySignature(body, ""); err == nil {
		t.Fatal("empty signature must be rejected")
	}
	if err := worker.verifyGatewaySignature(body, expected+"0"); err == nil {
		t.Fatal("tampered signature must be rejected")
	}
	if err := worker.verifyGatewaySignature([]byte(`{"hello":"other"}`), expected); err == nil {
		t.Fatal("signature for different body must be rejected")
	}
	if err := worker.verifyGatewaySignature(body, strings.ToUpper(expected)); err == nil {
		t.Fatal("case-mutated signature must be rejected")
	}
}

func TestValidateGatewayEnvelope(t *testing.T) {
	worker := New(nil, Config{GatewaySignatureSkew: time.Minute}, nil)
	base := validGatewayEnvelope()
	base.IssuedAt = time.Now().UTC().Format(time.RFC3339)

	if err := worker.validateGatewayEnvelope(&base); err != nil {
		t.Fatalf("valid envelope rejected: %v", err)
	}

	tests := []struct {
		name   string
		mutate func(*gatewayEnvelope)
	}{
		{name: "wrong version", mutate: func(env *gatewayEnvelope) { env.SchemaVersion = 2 }},
		{name: "unknown endpoint", mutate: func(env *gatewayEnvelope) { env.Endpoint = "videos.generations" }},
		{name: "empty jobId", mutate: func(env *gatewayEnvelope) { env.JobID = "" }},
		{name: "stale issuedAt", mutate: func(env *gatewayEnvelope) { env.IssuedAt = time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339) }},
		{name: "bad issuedAt", mutate: func(env *gatewayEnvelope) { env.IssuedAt = "not-a-time" }},
		{name: "missing apiKeyId", mutate: func(env *gatewayEnvelope) { env.Auth.APIKeyID = "" }},
		{name: "negative credits", mutate: func(env *gatewayEnvelope) { env.Billing.CreditsSpent = -1 }},
		{name: "missing channel", mutate: func(env *gatewayEnvelope) { env.Provider.ChannelID = "" }},
		{name: "missing providerMode", mutate: func(env *gatewayEnvelope) { env.Provider.ProviderMode = "" }},
		{name: "too many sources", mutate: func(env *gatewayEnvelope) {
			env.SourceImageURLs = make([]string, gatewayMaxSourceImages+1)
			for i := range env.SourceImageURLs {
				env.SourceImageURLs[i] = "https://cdn.example.test/x.png"
			}
		}},
		{name: "file source url", mutate: func(env *gatewayEnvelope) { env.SourceImageURLs = []string{"file:///etc/passwd"} }},
		{name: "zero count", mutate: func(env *gatewayEnvelope) { env.Payload.Count = 0 }},
		{name: "missing model", mutate: func(env *gatewayEnvelope) { env.Payload.Model = "" }},
		{name: "missing prompt", mutate: func(env *gatewayEnvelope) { env.Payload.Prompt = "" }},
		{name: "bad generationType", mutate: func(env *gatewayEnvelope) { env.Payload.GenerationType = "VIDEO" }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			env := base
			test.mutate(&env)
			if err := worker.validateGatewayEnvelope(&env); err == nil {
				t.Fatalf("expected validation error for %s", test.name)
			}
		})
	}
}

func TestGatewayEndpointRejectsMissingSignature(t *testing.T) {
	worker := New(nil, Config{}, nil)
	body := strings.NewReader(`{}`)
	recorder := httptest.NewRecorder()
	worker.gatewayEndpointHandler("images.generations")(
		recorder,
		httptest.NewRequest(http.MethodPost, "/internal/gateway/v1/images/generations", body),
	)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", recorder.Code)
	}
	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if payload.Error.Code != "GATEWAY_SIGNATURE_INVALID" {
		t.Fatalf("unexpected error code: %s", payload.Error.Code)
	}
}

func TestGatewayEndpointRejectsInvalidEnvelope(t *testing.T) {
	worker := New(nil, Config{AuthSecret: "gateway-test-secret-0123456789"}, nil)
	env := validGatewayEnvelope()
	env.SchemaVersion = 99
	env.IssuedAt = time.Now().UTC().Format(time.RFC3339)
	bodyBytes, _ := json.Marshal(env)

	request := httptest.NewRequest(
		http.MethodPost,
		"/internal/gateway/v1/images/generations",
		strings.NewReader(string(bodyBytes)),
	)
	request.Header.Set(gatewaySignatureHeader, gatewaySignature(worker.cfg.AuthSecret, bodyBytes))
	recorder := httptest.NewRecorder()
	worker.gatewayEndpointHandler("images.generations")(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if payload.Error.Code != "GATEWAY_ENVELOPE_INVALID" {
		t.Fatalf("unexpected error code: %s", payload.Error.Code)
	}
}

func TestGatewayEndpointPathMustMatchEnvelope(t *testing.T) {
	worker := New(nil, Config{AuthSecret: "gateway-test-secret-0123456789"}, nil)
	env := validGatewayEnvelope()
	env.Endpoint = "chat.completions"
	env.IssuedAt = time.Now().UTC().Format(time.RFC3339)
	bodyBytes, _ := json.Marshal(env)

	request := httptest.NewRequest(
		http.MethodPost,
		"/internal/gateway/v1/images/generations",
		strings.NewReader(string(bodyBytes)),
	)
	request.Header.Set(gatewaySignatureHeader, gatewaySignature(worker.cfg.AuthSecret, bodyBytes))
	recorder := httptest.NewRecorder()
	worker.gatewayEndpointHandler("images.generations")(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for mismatched endpoint, got %d", recorder.Code)
	}
}

func TestGatewayQueryRequiresSignatureAndApiKey(t *testing.T) {
	worker := New(nil, Config{AuthSecret: "gateway-test-secret-0123456789"}, nil)

	// 无签名 → 401
	recorder := httptest.NewRecorder()
	worker.handleGatewayQuery(recorder, httptest.NewRequest(http.MethodGet, "/internal/gateway/v1/generations/job1", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without signature, got %d", recorder.Code)
	}

	// 有签名无 api key → 401
	request := httptest.NewRequest(http.MethodGet, "/internal/gateway/v1/generations/job1", nil)
	request.Header.Set(gatewaySignatureHeader, gatewaySignature(worker.cfg.AuthSecret, []byte("job1")))
	recorder = httptest.NewRecorder()
	worker.handleGatewayQuery(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without api key, got %d", recorder.Code)
	}
}

func TestImageDataURLToBase64(t *testing.T) {
	if got, ok := imageDataURLToBase64("data:image/png;base64,AAAA"); !ok || got != "AAAA" {
		t.Fatalf("unexpected data url parse: %q %v", got, ok)
	}
	if got, ok := imageDataURLToBase64("data:image/png;base64,QUJD"); !ok || got != "QUJD" {
		t.Fatalf("unexpected base64 parse: %q %v", got, ok)
	}
	if _, ok := imageDataURLToBase64("https://cdn.example.test/a.png"); ok {
		t.Fatal("http url must not be treated as data url")
	}
	if _, ok := imageDataURLToBase64("data:text/plain,hello"); ok {
		t.Fatal("non-base64 data url must not be accepted")
	}
}

func TestFormatGatewayQueryResponse(t *testing.T) {
	created := time.Date(2026, 8, 8, 12, 0, 0, 0, time.UTC)
	job := gatewayJob{
		ID:         "cjob1",
		Status:     "SUCCEEDED",
		Model:      "gpt-image-2",
		CreatedAt:  created,
		ErrorCode:  newNullString(""),
		CreditsSpent: 5,
	}
	image := gatewayImage{
		ID:     "img1",
		URL:    "https://cdn.example.test/a.png",
		Width:  intPtr(1024),
		Height: intPtr(1024),
	}
	payload := formatGatewayQueryResponse(job, []gatewayImage{image})
	if payload["object"] != "image.generation" || payload["status"] != "succeeded" {
		t.Fatalf("unexpected query payload: %v", payload)
	}
	images, ok := payload["images"].([]any)
	if !ok || len(images) != 1 {
		t.Fatalf("unexpected images: %v", payload["images"])
	}
}

func TestWriteGatewayJobErrorMapsContractCodes(t *testing.T) {
	worker := New(nil, Config{}, nil)
	result := gatewayJobResult{
		JobID:     "cjob1",
		Status:    "FAILED",
		ErrorCode: newNullString("HANDOFF_UNKNOWN"),
	}
	recorder := httptest.NewRecorder()
	worker.writeGatewayJobError(recorder, result)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("expected 409 for coordination_required, got %d", recorder.Code)
	}
	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if payload.Error.Code != "HANDOFF_UNKNOWN" {
		t.Fatalf("unexpected error code: %s", payload.Error.Code)
	}
}

func TestGatewayContractFixtures(t *testing.T) {
	root := gatewayContractRoot()
	var envelope struct {
		Contract  string   `json:"contract"`
		Version   int      `json:"version"`
		Endpoints []string `json:"endpoints"`
		Signature struct {
			Algorithm string `json:"algorithm"`
			Encoding  string `json:"encoding"`
			Header    string `json:"header"`
			Key       string `json:"key"`
			Payload   string `json:"payload"`
		} `json:"signature"`
	}
	if err := readJSON(filepath.Join(root, "envelope.json"), &envelope); err != nil {
		t.Fatalf("读取 gateway 契约失败: %v", err)
	}
	if envelope.Contract != "narra.gateway" || envelope.Version != gatewayAPISchemaVersion {
		t.Fatalf("unexpected gateway contract: %+v", envelope)
	}
	expectedEndpoints := []string{
		"images.generations", "images.edits", "responses", "chat.completions", "generations.get",
	}
	if !slices.Equal(envelope.Endpoints, expectedEndpoints) {
		t.Fatalf("unexpected gateway endpoints: %v", envelope.Endpoints)
	}
	if envelope.Signature.Algorithm != "HMAC-SHA256" || envelope.Signature.Key != "AUTH_SECRET" ||
		envelope.Signature.Header != gatewaySignatureHeader || envelope.Signature.Payload != "raw-request-body" {
		t.Fatalf("unexpected signature spec: %+v", envelope.Signature)
	}

	var scenarios struct {
		Version int                       `json:"version"`
		Valid   map[string]json.RawMessage `json:"valid"`
		Invalid map[string]json.RawMessage `json:"invalid"`
	}
	if err := readJSON(filepath.Join(root, "scenarios", "envelope.json"), &scenarios); err != nil {
		t.Fatalf("读取 gateway 场景失败: %v", err)
	}
	if scenarios.Version != gatewayAPISchemaVersion {
		t.Fatalf("unexpected scenario version: %d", scenarios.Version)
	}
	for endpoint := range scenarios.Valid {
		if !slices.Contains(envelope.Endpoints, endpoint) {
			t.Errorf("scenario endpoint %q not in contract", endpoint)
		}
		var sample gatewayEnvelope
		if err := json.Unmarshal(scenarios.Valid[endpoint], &sample); err != nil {
			t.Errorf("scenario %q 无法解析为 gatewayEnvelope: %v", endpoint, err)
		}
		if sample.SchemaVersion != gatewayAPISchemaVersion || sample.Endpoint != endpoint {
			t.Errorf("scenario %q 与契约不符: %+v", endpoint, sample)
		}
		sample.IssuedAt = time.Now().UTC().Format(time.RFC3339)
		if err := validateGatewayEnvelopeFixtures(&sample); err != nil {
			t.Errorf("scenario %q 校验失败: %v", endpoint, err)
		}
	}
	for _, name := range []string{"missingSignature", "wrongVersion", "badSourceUrl", "negativeCredits"} {
		if _, ok := scenarios.Invalid[name]; !ok {
			t.Errorf("缺少非法场景 %q", name)
		}
	}
}

// validateGatewayEnvelopeFixtures 用与 handler 相同的规则校验合法样例。
func validateGatewayEnvelopeFixtures(env *gatewayEnvelope) error {
	worker := New(nil, Config{GatewaySignatureSkew: time.Minute}, nil)
	return worker.validateGatewayEnvelope(env)
}

func gatewayContractRoot() string {
	_, file, _, ok := runtime.Caller(0)
	if ok {
		return filepath.Clean(filepath.Join(filepath.Dir(file), "../../../contracts/gateway/v1"))
	}
	return filepath.Clean(filepath.Join("contracts", "gateway", "v1"))
}

func validGatewayEnvelope() gatewayEnvelope {
	return gatewayEnvelope{
		SchemaVersion: gatewayAPISchemaVersion,
		Endpoint:      "images.generations",
		JobID:         "cjob_123456789012345678901",
		IssuedAt:      time.Now().UTC().Format(time.RFC3339),
		Auth: gatewayAuth{
			APIKeyID: "ck_apikey_1",
			UserID:   "usr_1",
		},
		Billing: gatewayBilling{
			CreditsSpent: 5,
			Charged:      true,
		},
		Provider: gatewayProvider{
			ChannelID:     "chn_1",
			ChannelModels: []string{"gpt-image-2"},
			DefaultModel:  "gpt-image-2",
			ProviderMode:  "BUILT_IN",
		},
		SourceImageURLs: []string{},
		Payload: gatewayPayload{
			Count:          1,
			GenerationType: "TEXT_TO_IMAGE",
			Model:          "gpt-image-2",
			Prompt:         "a red fox in the snow",
			Moderation:     "auto",
			OutputFormat:   "png",
			Quality:        "auto",
			Size:           "1024x1024",
		},
	}
}

func newNullString(value string) sql.NullString {
	return sql.NullString{String: value, Valid: true}
}

func intPtr(value int) *int {
	return &value
}

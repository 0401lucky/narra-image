package worker

import (
	"encoding/json"
	"slices"
	"testing"
)

func TestGenerationContractLoadsSharedFixtures(t *testing.T) {
	contract, err := LoadGenerationContract("")
	if err != nil {
		t.Fatalf("LoadGenerationContract returned error: %v", err)
	}
	if contract.Schema.Version != 1 || contract.Schema.LegacyVersion != 0 {
		t.Fatalf("unexpected contract versions: %+v", contract.Schema)
	}
	for _, scenario := range []string{"channels", "lifecycle", "media", "secret"} {
		if len(contract.Scenarios[scenario]) == 0 {
			t.Errorf("shared scenario %q was not loaded", scenario)
		}
	}
	for _, vector := range contract.Models.Vectors {
		got := "images"
		if contract.SupportsResponses(vector.Model) {
			got = "responses"
		}
		if got != vector.Operation {
			t.Errorf("model %q: got operation %q, want %q", vector.Model, got, vector.Operation)
		}
		fallback := "images"
		if supportsResponsesModelIDFallback(vector.Model) {
			fallback = "responses"
		}
		if fallback != vector.Operation {
			t.Errorf("fallback model %q: got operation %q, want %q", vector.Model, fallback, vector.Operation)
		}
	}
}

func TestGenerationContractConsumesChannelAndLifecycleScenarios(t *testing.T) {
	contract, err := LoadGenerationContract("")
	if err != nil {
		t.Fatal(err)
	}
	var channels struct {
		Scenarios []struct {
			Channel *struct {
				Active       bool     `json:"active"`
				DefaultModel string   `json:"defaultModel"`
				Models       []string `json:"models"`
			} `json:"channel"`
			RequestedModel string `json:"requestedModel"`
			Result         struct {
				ErrorCode *string `json:"errorCode"`
			} `json:"result"`
		} `json:"scenarios"`
	}
	if err := json.Unmarshal(contract.Scenarios["channels"], &channels); err != nil {
		t.Fatal(err)
	}
	for _, scenario := range channels.Scenarios {
		if scenario.Channel == nil || !scenario.Channel.Active {
			continue
		}
		supported := contract.SupportsModel(
			scenario.Channel.DefaultModel,
			scenario.RequestedModel,
			scenario.Channel.Models,
		)
		if supported != (scenario.Result.ErrorCode == nil) {
			t.Errorf("channel scenario model %q produced supported=%v", scenario.RequestedModel, supported)
		}
	}

	var lifecycle struct {
		Scenarios []struct {
			Result map[string]any `json:"result"`
		} `json:"scenarios"`
	}
	if err := json.Unmarshal(contract.Scenarios["lifecycle"], &lifecycle); err != nil {
		t.Fatal(err)
	}
	for _, scenario := range lifecycle.Scenarios {
		code, ok := scenario.Result["errorCode"].(string)
		if ok {
			if _, registered := contract.Errors[code]; !registered {
				t.Errorf("lifecycle scenario references unregistered error code %q", code)
			}
		}
	}
	if contract.States.UnknownTerminal.ErrorCode != errorHandoffUnknown ||
		contract.States.UnknownTerminal.HandoffState != "UNKNOWN" ||
		contract.States.UnknownTerminal.Refund || contract.States.UnknownTerminal.Retry {
		t.Fatalf("unexpected UNKNOWN terminal contract: %+v", contract.States.UnknownTerminal)
	}
}

func TestGenerationContractConsumesMediaScenario(t *testing.T) {
	contract, err := LoadGenerationContract("")
	if err != nil {
		t.Fatal(err)
	}
	var media struct {
		Image struct {
			EditCount int      `json:"editCount"`
			Fields    []string `json:"resultFields"`
			Kinds     []string `json:"storageKinds"`
		} `json:"image"`
		Video struct {
			Fields []string `json:"resultFields"`
		} `json:"video"`
	}
	if err := json.Unmarshal(contract.Scenarios["media"], &media); err != nil {
		t.Fatal(err)
	}
	if media.Image.EditCount != 1 || !slices.Contains(media.Video.Fields, "posterUrl") {
		t.Fatalf("unexpected media contract: %+v", media)
	}
	for _, field := range []string{"mediaStorage", "storageKey"} {
		if !slices.Contains(media.Image.Fields, field) || !slices.Contains(media.Video.Fields, field) {
			t.Errorf("media contract missing result field %q", field)
		}
	}
	for _, kind := range []string{"B64", "S3", "UPSTREAM"} {
		if !slices.Contains(media.Image.Kinds, kind) {
			t.Errorf("media contract missing storage kind %q", kind)
		}
	}
}

func TestDefaultPromptSourcesManifestIsComplete(t *testing.T) {
	sources, err := DefaultPromptSources()
	if err != nil {
		t.Fatalf("DefaultPromptSources returned error: %v", err)
	}
	if len(sources) != 6 {
		t.Fatalf("expected 6 default sources, got %d", len(sources))
	}
	seen := map[string]bool{}
	for _, source := range sources {
		if source.Slug == "" || source.Name == "" || source.Parser == "" || source.RawBaseURL == "" || source.SourceURL == "" {
			t.Errorf("incomplete source: %+v", source)
		}
		if seen[source.Slug] {
			t.Errorf("duplicate source slug %q", source.Slug)
		}
		seen[source.Slug] = true
		switch source.Parser {
		case "gpt-image-2-prompts", "awesome-gpt-image", "awesome-gpt4o-image-prompts",
			"youmind-gpt-image-2", "youmind-nano-banana-pro", "davidwu-gpt-image2-prompts":
		default:
			t.Errorf("unsupported parser %q", source.Parser)
		}
	}
}

func TestGenerationContractLegacyAndV1WriteFields(t *testing.T) {
	contract, err := LoadGenerationContract("")
	if err != nil {
		t.Fatal(err)
	}
	legacy := contract.WriteFields(false)
	if legacy.ContractVersion != 0 || legacy.HandoffState != nil {
		t.Fatalf("unexpected legacy fields: %+v", legacy)
	}
	v1 := contract.WriteFields(true)
	if v1.ContractVersion != 1 || v1.HandoffState == nil || *v1.HandoffState != "NOT_STARTED" {
		t.Fatalf("unexpected v1 fields: %+v", v1)
	}
}

func TestGenerationContractRefundGuard(t *testing.T) {
	contract, err := LoadGenerationContract("")
	if err != nil {
		t.Fatal(err)
	}
	for _, state := range []string{"SUBMITTING", "SUBMITTED", "UNKNOWN"} {
		state := state
		if contract.RefundAllowed(1, &state) {
			t.Errorf("handoff state %s unexpectedly refundable", state)
		}
	}
	if !contract.RefundAllowed(0, nil) {
		t.Fatal("legacy task should remain refundable")
	}
	if contract.RefundAllowed(1, nil) {
		t.Fatal("v1 task with missing handoff state must not be refundable")
	}
}

func TestGenerationContractSecretFixtureIsAvailableToGo(t *testing.T) {
	contract, err := LoadGenerationContract("")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Encoded   string `json:"encoded"`
		Plaintext string `json:"plaintext"`
		Secret    string `json:"secret"`
	}
	if err := json.Unmarshal(contract.Scenarios["secret"], &fixture); err != nil {
		t.Fatal(err)
	}
	plaintext, err := decryptProviderSecret(fixture.Encoded, fixture.Secret)
	if err != nil {
		t.Fatal(err)
	}
	if plaintext != fixture.Plaintext {
		t.Fatalf("unexpected decrypted fixture: %q", plaintext)
	}
}

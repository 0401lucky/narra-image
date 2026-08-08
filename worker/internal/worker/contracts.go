package worker

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
)

// GenerationContract 是 Node 与 Go 共用的 JSON 契约在 Go 侧的强类型投影。
// JSON 文件仍是唯一事实来源；这里不复制错误码或状态转换表。
type GenerationContract struct {
	Schema    ContractSchema
	Errors    map[string]ContractError
	Models    ContractModels
	States    ContractStates
	Scenarios map[string]json.RawMessage
}

type ContractSchema struct {
	Contract      string `json:"contract"`
	Version       int    `json:"version"`
	LegacyVersion int    `json:"legacyVersion"`
	Rollout       struct {
		EnvironmentFlag string `json:"environmentFlag"`
		DefaultEnabled  bool   `json:"defaultEnabled"`
		EnabledWrite    struct {
			ContractVersion int    `json:"contractVersion"`
			HandoffState    string `json:"handoffState"`
		} `json:"enabledWrite"`
		DisabledWrite struct {
			ContractVersion int     `json:"contractVersion"`
			HandoffState    *string `json:"handoffState"`
		} `json:"disabledWrite"`
	} `json:"rollout"`
}

type ContractError struct {
	Category             string `json:"category"`
	JobTerminal          *bool  `json:"jobTerminal,omitempty"`
	Refundable           bool   `json:"refundable"`
	RequiresNotSubmitted bool   `json:"requiresNotSubmitted,omitempty"`
	Retryable            bool   `json:"retryable"`
	UserMessage          string `json:"userMessage"`
}

type ContractModels struct {
	Version          int           `json:"version"`
	ResponsesPattern string        `json:"responsesPattern"`
	Vectors          []ModelVector `json:"vectors"`
}

type ModelVector struct {
	Model     string `json:"model"`
	Operation string `json:"operation"`
}

type ContractStates struct {
	Version                    int                 `json:"version"`
	JobStatuses                []string            `json:"jobStatuses"`
	JobTransitions             map[string][]string `json:"jobTransitions"`
	HandoffStates              []string            `json:"handoffStates"`
	HandoffTransitions         map[string][]string `json:"handoffTransitions"`
	AttemptStatuses            []string            `json:"attemptStatuses"`
	RefundAllowedHandoffStates []*string           `json:"refundAllowedHandoffStates"`
	RefundBlockedHandoffStates []string            `json:"refundBlockedHandoffStates"`
	UnknownTerminal            struct {
		Status       string `json:"status"`
		ErrorCode    string `json:"errorCode"`
		HandoffState string `json:"handoffState"`
		Refund       bool   `json:"refund"`
		Retry        bool   `json:"retry"`
	} `json:"unknownTerminal"`
}

type ContractWriteFields struct {
	ContractVersion int
	HandoffState    *string
}

var (
	sharedGenerationContractOnce sync.Once
	sharedGenerationContract     GenerationContract
	sharedGenerationContractErr  error
)

func sharedContract() (GenerationContract, error) {
	sharedGenerationContractOnce.Do(func() {
		sharedGenerationContract, sharedGenerationContractErr = LoadGenerationContract("")
	})
	return sharedGenerationContract, sharedGenerationContractErr
}

func supportsResponsesModelID(modelID string) bool {
	contract, err := sharedContract()
	if err == nil {
		return contract.SupportsResponses(modelID)
	}
	return supportsResponsesModelIDFallback(modelID)
}

func supportsResponsesModelIDFallback(modelID string) bool {
	// 二进制被复制到不带仓库 fixture 的镜像时保留同一边界规则；
	// 开发/测试环境始终优先读取版本化 JSON。
	id := strings.ToLower(modelID)
	if strings.HasPrefix(id, "gpt-5x") || strings.Contains(id, "/gpt-5x") {
		return false
	}
	for index := 0; index < len(id); {
		next := strings.Index(id[index:], "gpt-5")
		if next < 0 {
			break
		}
		index += next
		if index > 0 && id[index-1] != '/' {
			index += len("gpt-5")
			continue
		}
		end := index + len("gpt-5")
		if end == len(id) || strings.ContainsRune("._-", rune(id[end])) {
			return true
		}
		index = end
	}
	return false
}

func LoadGenerationContract(root string) (GenerationContract, error) {
	if strings.TrimSpace(root) == "" {
		root = generationContractRoot()
	}
	var contract GenerationContract
	if err := readJSON(filepath.Join(root, "schema.json"), &contract.Schema); err != nil {
		return GenerationContract{}, err
	}
	if contract.Schema.Contract != "narra.generation" || contract.Schema.Version != 1 || contract.Schema.LegacyVersion != 0 {
		return GenerationContract{}, fmt.Errorf("生成契约 schema 版本无效: %+v", contract.Schema)
	}
	var errorsFile struct {
		Version int                      `json:"version"`
		Errors  map[string]ContractError `json:"errors"`
	}
	if err := readJSON(filepath.Join(root, "errors.json"), &errorsFile); err != nil {
		return GenerationContract{}, err
	}
	if errorsFile.Version != contract.Schema.Version || len(errorsFile.Errors) == 0 {
		return GenerationContract{}, errors.New("生成契约 errors.json 版本或内容无效")
	}
	var models ContractModels
	if err := readJSON(filepath.Join(root, "models.json"), &models); err != nil {
		return GenerationContract{}, err
	}
	if models.Version != contract.Schema.Version || len(models.Vectors) == 0 {
		return GenerationContract{}, errors.New("生成契约 models.json 版本或内容无效")
	}
	var states ContractStates
	if err := readJSON(filepath.Join(root, "states.json"), &states); err != nil {
		return GenerationContract{}, err
	}
	if states.Version != contract.Schema.Version || len(states.HandoffStates) == 0 {
		return GenerationContract{}, errors.New("生成契约 states.json 版本或内容无效")
	}
	contract.Errors = errorsFile.Errors
	contract.Models = models
	contract.States = states
	contract.Scenarios = make(map[string]json.RawMessage, 4)
	for _, name := range []string{"channels", "lifecycle", "media", "secret"} {
		path := filepath.Join(root, "scenarios", name+".json")
		var scenario json.RawMessage
		if err := readJSON(path, &scenario); err != nil {
			return GenerationContract{}, err
		}
		var header struct {
			Version int `json:"version"`
		}
		if err := json.Unmarshal(scenario, &header); err != nil || header.Version != contract.Schema.Version {
			return GenerationContract{}, fmt.Errorf("生成契约场景版本无效: %s", path)
		}
		contract.Scenarios[name] = scenario
	}
	return contract, nil
}

func generationContractRoot() string {
	_, file, _, ok := runtime.Caller(0)
	if ok {
		return filepath.Clean(filepath.Join(filepath.Dir(file), "../../../contracts/generation/v1"))
	}
	return filepath.Clean(filepath.Join("contracts", "generation", "v1"))
}

func readJSON(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("读取生成契约 %s: %w", path, err)
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("解析生成契约 %s: %w", path, err)
	}
	return nil
}

func (c GenerationContract) SupportsResponses(modelID string) bool {
	pattern := strings.ReplaceAll(c.Models.ResponsesPattern, "(?:", "(")
	matched, err := regexp.MatchString("(?i)"+pattern, modelID)
	return err == nil && matched
}

func (c GenerationContract) SupportsModel(defaultModel, model string, models []string) bool {
	requested := strings.TrimSpace(model)
	if requested == "" {
		return false
	}
	if requested == strings.TrimSpace(defaultModel) {
		return true
	}
	for _, supported := range models {
		if requested == strings.TrimSpace(supported) {
			return true
		}
	}
	return false
}

func (c GenerationContract) RefundAllowed(contractVersion int, handoffState *string) bool {
	if contractVersion < c.Schema.Version {
		return true
	}
	if handoffState == nil || *handoffState == "" {
		return false
	}
	for _, blocked := range c.States.RefundBlockedHandoffStates {
		if *handoffState == blocked {
			return false
		}
	}
	return true
}

func (c GenerationContract) WriteFields(enabled bool) ContractWriteFields {
	if enabled {
		state := c.Schema.Rollout.EnabledWrite.HandoffState
		return ContractWriteFields{
			ContractVersion: c.Schema.Rollout.EnabledWrite.ContractVersion,
			HandoffState:    &state,
		}
	}
	return ContractWriteFields{
		ContractVersion: c.Schema.Rollout.DisabledWrite.ContractVersion,
		HandoffState:    c.Schema.Rollout.DisabledWrite.HandoffState,
	}
}

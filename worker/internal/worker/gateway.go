package worker

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	gatewayAPISchemaVersion = 1
	gatewaySignatureHeader  = "X-Gateway-Signature"
	gatewayMaxBodyBytes     = 1 << 20 // 1 MiB
	gatewayMaxSourceImages  = 10
	gatewayMaxJobIDLength   = 64
	// gatewayMaxB64ResponseImageBytes 与 Next 侧 MAX_B64_RESPONSE_IMAGE_BYTES 对齐。
	gatewayMaxB64ResponseImageBytes = 25 * 1024 * 1024
)

var (
	errGatewaySignatureInvalid = errors.New("网关签名无效")
	errGatewayEnvelopeInvalid  = errors.New("网关 envelope 无效")
)

// gatewayEnvelope 是 Next → Go 内部生成网关的版本化请求契约。
// 结构对应 contracts/gateway/v1/envelope.json；JSON 仍是唯一事实来源。
type gatewayEnvelope struct {
	SchemaVersion   int              `json:"schemaVersion"`
	Endpoint        string           `json:"endpoint"`
	JobID           string           `json:"jobId"`
	IssuedAt        string           `json:"issuedAt"`
	Auth            gatewayAuth      `json:"auth"`
	Billing         gatewayBilling   `json:"billing"`
	Provider        gatewayProvider  `json:"provider"`
	SourceImageURLs []string         `json:"sourceImageUrls"`
	Payload         gatewayPayload   `json:"payload"`
}

type gatewayAuth struct {
	APIKeyID string `json:"apiKeyId"`
	UserID   string `json:"userId"`
}

type gatewayBilling struct {
	CreditsSpent int  `json:"creditsSpent"`
	Charged      bool `json:"charged"`
}

type gatewayProvider struct {
	ChannelID     string   `json:"channelId"`
	ChannelModels []string `json:"channelModels"`
	DefaultModel  string   `json:"defaultModel"`
	ProviderMode  string   `json:"providerMode"`
}

type gatewayPayload struct {
	Count             int     `json:"count"`
	GenerationType    string  `json:"generationType"`
	Model             string  `json:"model"`
	Prompt            string  `json:"prompt"`
	NegativePrompt    *string `json:"negativePrompt"`
	Moderation        string  `json:"moderation"`
	OutputCompression *int    `json:"outputCompression"`
	OutputFormat      string  `json:"outputFormat"`
	Quality           string  `json:"quality"`
	Seed              *int    `json:"seed"`
	Size              string  `json:"size"`
	ResponseFormat    string  `json:"responseFormat,omitempty"`
	Stream            bool    `json:"stream,omitempty"`
}

func gatewaySignature(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func (w *Worker) verifyGatewaySignature(body []byte, provided string) error {
	provided = strings.TrimSpace(provided)
	if provided == "" || w.cfg.AuthSecret == "" {
		return errGatewaySignatureInvalid
	}
	expected := gatewaySignature(w.cfg.AuthSecret, body)
	if len(provided) != len(expected) || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		return errGatewaySignatureInvalid
	}
	return nil
}

// validateGatewayEnvelope 是独立于 Next 的防御性校验：
// 版本、端点、必填字段、URL scheme 与数值边界。
func (w *Worker) validateGatewayEnvelope(env *gatewayEnvelope) error {
	if env.SchemaVersion != gatewayAPISchemaVersion {
		return fmt.Errorf("schemaVersion 必须是 %d", gatewayAPISchemaVersion)
	}
	switch env.Endpoint {
	case "images.generations", "images.edits", "responses", "chat.completions", "generations.get":
	default:
		return fmt.Errorf("endpoint %q 不在契约枚举内", env.Endpoint)
	}
	if strings.TrimSpace(env.JobID) == "" || len(env.JobID) > gatewayMaxJobIDLength {
		return errors.New("jobId 缺失或长度非法")
	}
	issuedAt, err := time.Parse(time.RFC3339, env.IssuedAt)
	if err != nil {
		return errors.New("issuedAt 必须是 RFC3339 时间")
	}
	skew := w.cfg.GatewaySignatureSkew
	if skew <= 0 {
		skew = 5 * time.Minute
	}
	if delta := time.Since(issuedAt); delta < -skew || delta > skew {
		return errors.New("issuedAt 超出签名时间窗口")
	}
	if strings.TrimSpace(env.Auth.APIKeyID) == "" || strings.TrimSpace(env.Auth.UserID) == "" {
		return errors.New("auth.apiKeyId / auth.userId 必填")
	}
	if env.Billing.CreditsSpent < 0 {
		return errors.New("billing.creditsSpent 不能为负")
	}
	if strings.TrimSpace(env.Provider.ChannelID) == "" {
		return errors.New("provider.channelId 必填")
	}
	if strings.TrimSpace(env.Provider.ProviderMode) == "" {
		return errors.New("provider.providerMode 必填")
	}
	if len(env.SourceImageURLs) > gatewayMaxSourceImages {
		return fmt.Errorf("sourceImageUrls 超过上限 %d", gatewayMaxSourceImages)
	}
	for _, source := range env.SourceImageURLs {
		parsed, err := url.Parse(source)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return errors.New("sourceImageUrls 仅允许 http/https")
		}
	}
	if env.Payload.Count < 1 {
		return errors.New("payload.count 必须 >= 1")
	}
	if strings.TrimSpace(env.Payload.Model) == "" {
		return errors.New("payload.model 必填")
	}
	if strings.TrimSpace(env.Payload.Prompt) == "" {
		return errors.New("payload.prompt 必填")
	}
	if env.Payload.GenerationType != "TEXT_TO_IMAGE" && env.Payload.GenerationType != "IMAGE_TO_IMAGE" {
		return errors.New("payload.generationType 非法")
	}
	return nil
}

// gatewayEndpointHandler 绑定单个内部网关端点；envelope.endpoint 必须与路径一致。
func (w *Worker) gatewayEndpointHandler(expected string) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			writeJSON(writer, http.StatusMethodNotAllowed, map[string]any{
				"code":   "METHOD_NOT_ALLOWED",
				"status": "error",
			})
			return
		}
		body, err := io.ReadAll(io.LimitReader(request.Body, gatewayMaxBodyBytes))
		if err != nil {
			w.writeGatewayOpenAiError(writer, http.StatusBadRequest, "INVALID_BODY", "请求体读取失败", "")
			return
		}
		if err := w.verifyGatewaySignature(body, request.Header.Get(gatewaySignatureHeader)); err != nil {
			w.writeGatewayOpenAiError(writer, http.StatusUnauthorized, "GATEWAY_SIGNATURE_INVALID", "网关签名无效", "")
			return
		}
		var env gatewayEnvelope
		if err := json.Unmarshal(body, &env); err != nil {
			w.writeGatewayOpenAiError(writer, http.StatusBadRequest, "GATEWAY_ENVELOPE_INVALID", "envelope 解析失败", "")
			return
		}
		if env.Endpoint != expected {
			w.writeGatewayOpenAiError(writer, http.StatusBadRequest, "GATEWAY_ENVELOPE_INVALID", "envelope.endpoint 与路径不一致", "")
			return
		}
		if err := w.validateGatewayEnvelope(&env); err != nil {
			w.logger.Warn("网关 envelope 校验失败", "event", "gateway_envelope_invalid", "endpoint", env.Endpoint, "error", err)
			w.writeGatewayOpenAiError(writer, http.StatusBadRequest, "GATEWAY_ENVELOPE_INVALID", err.Error(), "")
			return
		}

		ctx, cancel := context.WithTimeout(request.Context(), w.gatewayRequestTimeout())
		defer cancel()

		job, err := w.ensureGatewayJob(ctx, env)
		if err != nil {
			w.logger.Error("网关创建任务失败", "event", "gateway_enqueue_failed", "endpoint", env.Endpoint, "jobId", env.JobID, "error", err)
			w.writeGatewayOpenAiError(writer, http.StatusServiceUnavailable, "GATEWAY_UNAVAILABLE", "生成网关暂不可用", env.JobID)
			return
		}

		result, err := w.waitForGatewayJob(ctx, job.ID, w.cfg.GatewayWaitTimeout, w.cfg.GatewayPollInterval)
		if err != nil {
			if errors.Is(err, errGatewayWaitTimeout) {
				w.writeGatewayOpenAiError(writer, http.StatusGatewayTimeout, "GENERATION_WAIT_TIMEOUT", "等待生成结果超时，请稍后通过 /v1/generations/"+job.ID+" 查询", job.ID)
				return
			}
			w.logger.Error("网关等待任务失败", "event", "gateway_wait_failed", "jobId", job.ID, "error", err)
			w.writeGatewayOpenAiError(writer, http.StatusInternalServerError, "GATEWAY_WAIT_FAILED", "等待生成结果失败", job.ID)
			return
		}

		w.writeGatewayEndpointResponse(writer, &env, result)
	}
}

func (w *Worker) gatewayRequestTimeout() time.Duration {
	wait := w.cfg.GatewayWaitTimeout
	if wait <= 0 {
		wait = 900 * time.Second
	}
	return wait + 30*time.Second
}

// registerGatewayRoutes 挂载内部生成网关端点；只对 loopback/内网可达，
// 且以签名 + 版本化 envelope 作为安全边界。
func (w *Worker) registerGatewayRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/internal/gateway/v1/images/generations", w.gatewayEndpointHandler("images.generations"))
	mux.HandleFunc("/internal/gateway/v1/images/edits", w.gatewayEndpointHandler("images.edits"))
	mux.HandleFunc("/internal/gateway/v1/responses", w.gatewayEndpointHandler("responses"))
	mux.HandleFunc("/internal/gateway/v1/chat/completions", w.gatewayEndpointHandler("chat.completions"))
	mux.HandleFunc("/internal/gateway/v1/generations/", w.handleGatewayQuery)
}

// handleGatewayQuery 承接 generations 查询：按 apiKeyId + clientSource=API 校验归属。
func (w *Worker) handleGatewayQuery(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]any{
			"code":   "METHOD_NOT_ALLOWED",
			"status": "error",
		})
		return
	}
	jobID := strings.TrimPrefix(request.URL.Path, "/internal/gateway/v1/generations/")
	if jobID == "" || strings.Contains(jobID, "/") {
		w.writeGatewayOpenAiError(writer, http.StatusBadRequest, "INVALID_JOB_ID", "任务编号非法", "")
		return
	}
	if err := w.verifyGatewaySignature([]byte(jobID), request.Header.Get(gatewaySignatureHeader)); err != nil {
		w.writeGatewayOpenAiError(writer, http.StatusUnauthorized, "GATEWAY_SIGNATURE_INVALID", "网关签名无效", "")
		return
	}
	apiKeyID := strings.TrimSpace(request.Header.Get("X-Gateway-Api-Key"))
	if apiKeyID == "" {
		w.writeGatewayOpenAiError(writer, http.StatusUnauthorized, "GATEWAY_SIGNATURE_INVALID", "缺少网关认证信息", "")
		return
	}

	ctx, cancel := context.WithTimeout(request.Context(), 10*time.Second)
	defer cancel()

	job, err := w.queryGatewayJob(ctx, jobID, apiKeyID)
	if err != nil {
		if errors.Is(err, errGatewayJobNotFound) {
			w.writeGatewayOpenAiError(writer, http.StatusNotFound, "GENERATION_NOT_FOUND", "生成任务不存在", jobID)
			return
		}
		w.logger.Error("网关查询任务失败", "event", "gateway_query_failed", "jobId", jobID, "error", err)
		w.writeGatewayOpenAiError(writer, http.StatusInternalServerError, "GATEWAY_QUERY_FAILED", "查询生成任务失败", jobID)
		return
	}

	var images []gatewayImage
	if job.Status == "SUCCEEDED" {
		images, err = w.readGatewayImages(ctx, jobID)
		if err != nil {
			w.logger.Error("网关查询图片失败", "event", "gateway_query_images_failed", "jobId", jobID, "error", err)
			w.writeGatewayOpenAiError(writer, http.StatusInternalServerError, "GATEWAY_QUERY_FAILED", "查询生成任务失败", jobID)
			return
		}
	}
	writeJSON(writer, http.StatusOK, formatGatewayQueryResponse(job, images))
}

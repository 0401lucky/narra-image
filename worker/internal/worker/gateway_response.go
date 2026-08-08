package worker

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var errB64ResponseTooLarge = errors.New("生成图片超过 b64_json 响应大小限制")

// writeGatewayOpenAiError 输出 OpenAI 兼容错误响应，Next 薄代理原样透传。
func (w *Worker) writeGatewayOpenAiError(
	writer http.ResponseWriter,
	status int,
	code string,
	message string,
	generationID string,
) {
	body := map[string]any{
		"error": map[string]any{
			"code":    code,
			"message": message,
			"type":    gatewayOpenAiErrorType(status),
		},
	}
	if generationID != "" {
		body["generation_id"] = generationID
	}
	writeJSON(writer, status, body)
}

func gatewayOpenAiErrorType(status int) string {
	switch status {
	case http.StatusUnauthorized:
		return "authentication_error"
	case http.StatusTooManyRequests:
		return "rate_limit_error"
	case http.StatusGatewayTimeout:
		return "server_error"
	default:
		return "invalid_request_error"
	}
}

// writeGatewayEndpointResponse 按端点分发 OpenAI 兼容响应格式化。
func (w *Worker) writeGatewayEndpointResponse(
	writer http.ResponseWriter,
	env *gatewayEnvelope,
	result gatewayJobResult,
) {
	switch env.Endpoint {
	case "images.generations", "images.edits":
		w.writeGatewayImages(writer, env, result)
	case "chat.completions":
		w.writeGatewayChat(writer, env, result)
	case "responses":
		w.writeGatewayResponses(writer, env, result)
	default:
		w.writeGatewayOpenAiError(writer, http.StatusBadRequest, "GATEWAY_ENVELOPE_INVALID", "endpoint 不支持", env.JobID)
	}
}

// writeGatewayJobError 把任务 FAILED 映射为 OpenAI 兼容错误：
// coordination_required 用 409，其余 400；code 使用契约错误码，message 用契约文案。
func (w *Worker) writeGatewayJobError(writer http.ResponseWriter, result gatewayJobResult) {
	code := result.ErrorCode.String
	if code == "" {
		code = "GENERATION_FAILED"
	}
	message := result.ErrorMessage.String
	status := http.StatusBadRequest
	if contract, err := sharedContract(); err == nil {
		if definition, ok := contract.Errors[code]; ok {
			if definition.UserMessage != "" {
				message = definition.UserMessage
			}
			if definition.Category == "coordination_required" {
				status = http.StatusConflict
			}
		}
	}
	w.writeGatewayOpenAiError(writer, status, code, message, result.JobID)
}

// writeGatewayImages 输出 images generations / edits 的 JSON 响应。
func (w *Worker) writeGatewayImages(
	writer http.ResponseWriter,
	env *gatewayEnvelope,
	result gatewayJobResult,
) {
	if result.Status == "FAILED" {
		w.writeGatewayJobError(writer, result)
		return
	}
	format := env.Payload.ResponseFormat
	if format == "" {
		format = "url"
	}
	data := make([]map[string]any, 0, len(result.Images))
	for _, image := range result.Images {
		item := map[string]any{
			"height": image.Height,
			"url":    image.URL,
			"width":  image.Width,
		}
		if format == "b64_json" {
			b64, err := w.imageURLToBase64(image.URL)
			if err != nil {
				w.writeGatewayOpenAiError(writer, http.StatusBadRequest, "GENERATION_IMAGE_B64_FAILED", err.Error(), result.JobID)
				return
			}
			item["b64_json"] = b64
		}
		data = append(data, item)
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"created":       result.CreatedAt.Unix(),
		"data":          data,
		"generation_id": result.JobID,
	})
}

// imageURLToBase64 下载媒体 URL 转 base64，沿用 25MB 上限；兼容开发期 data URL fallback。
func (w *Worker) imageURLToBase64(imageURL string) (string, error) {
	if dataURL, ok := imageDataURLToBase64(imageURL); ok {
		return dataURL, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return "", err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("读取生成图片失败，无法返回 b64_json（HTTP %d）", response.StatusCode)
	}
	if response.ContentLength > gatewayMaxB64ResponseImageBytes {
		return "", errB64ResponseTooLarge
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, gatewayMaxB64ResponseImageBytes+1))
	if err != nil {
		return "", err
	}
	if len(data) > gatewayMaxB64ResponseImageBytes {
		return "", errB64ResponseTooLarge
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

func imageDataURLToBase64(imageURL string) (string, bool) {
	lower := strings.ToLower(imageURL)
	if !strings.HasPrefix(lower, "data:") {
		return "", false
	}
	marker := "base64,"
	index := strings.Index(lower, marker)
	if index < 0 {
		return "", false
	}
	return imageURL[index+len(marker):], true
}

// buildGatewayImageMarkdown 与 Next chat 路由的图片 markdown 拼接保持一致。
func buildGatewayImageMarkdown(images []gatewayImage) string {
	lines := make([]string, 0, len(images))
	for index, image := range images {
		lines = append(lines, fmt.Sprintf("![image-%d](%s)\n%s", index+1, image.URL, image.URL))
	}
	return strings.Join(lines, "\n\n")
}

// writeGatewayChat 输出 chat completions 的 JSON 或 SSE 响应。
// 现状语义：任务失败时即使请求 stream=true 也返回 JSON 错误。
func (w *Worker) writeGatewayChat(
	writer http.ResponseWriter,
	env *gatewayEnvelope,
	result gatewayJobResult,
) {
	if result.Status == "FAILED" {
		w.writeGatewayJobError(writer, result)
		return
	}
	content := "生成完成。\n\n" + buildGatewayImageMarkdown(result.Images)
	created := result.CreatedAt.Unix()
	id := "chatcmpl_" + result.JobID
	model := env.Payload.Model
	if model == "" {
		model = result.Model
	}

	if !env.Payload.Stream {
		writeJSON(writer, http.StatusOK, map[string]any{
			"choices": []any{
				map[string]any{
					"finish_reason": "stop",
					"index":         0,
					"message": map[string]any{
						"content": content,
						"role":    "assistant",
					},
				},
			},
			"created":       created,
			"generation_id": result.JobID,
			"id":            id,
			"model":         model,
			"object":        "chat.completion",
			"usage": map[string]any{
				"completion_tokens": 0,
				"prompt_tokens":     0,
				"total_tokens":      0,
			},
		})
		return
	}

	w.writeChatSSE(writer, content, created, id, model, result.JobID)
}

func (w *Worker) writeChatSSE(
	writer http.ResponseWriter,
	content string,
	created int64,
	id string,
	model string,
	generationID string,
) {
	flusher, ok := writer.(http.Flusher)
	if !ok {
		w.writeGatewayOpenAiError(writer, http.StatusInternalServerError, "SSE_UNSUPPORTED", "当前连接不支持流式响应", generationID)
		return
	}
	writer.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-cache, no-transform")
	writer.Header().Set("Connection", "keep-alive")
	writer.Header().Set("X-Accel-Buffering", "no")
	writer.WriteHeader(http.StatusOK)

	chunk := func(delta map[string]any, finishReason any) {
		payload := map[string]any{
			"choices": []any{
				map[string]any{
					"delta":         delta,
					"finish_reason": finishReason,
					"index":         0,
				},
			},
			"created":       created,
			"generation_id": generationID,
			"id":            id,
			"model":         model,
			"object":        "chat.completion.chunk",
		}
		writeSSEData(writer, payload)
	}

	chunk(map[string]any{"role": "assistant"}, nil)
	chunk(map[string]any{"content": content}, nil)
	chunk(map[string]any{}, "stop")
	_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	flusher.Flush()
}

// writeGatewayResponses 输出 responses 的 JSON 或 SSE 响应。
// 现状语义：stream 时任务失败返回 SSE response.failed；非 stream 返回 JSON 错误。
func (w *Worker) writeGatewayResponses(
	writer http.ResponseWriter,
	env *gatewayEnvelope,
	result gatewayJobResult,
) {
	if result.Status == "FAILED" {
		if !env.Payload.Stream {
			w.writeGatewayJobError(writer, result)
			return
		}
		w.writeResponsesFailedSSE(writer, result)
		return
	}

	payload, err := w.formatResponsesPayload(env, result)
	if err != nil {
		// 媒体读取失败必须显式失败，不能把空 result 当成成功。
		w.writeGatewayOpenAiError(writer, http.StatusBadRequest, "GENERATION_IMAGE_B64_FAILED", err.Error(), result.JobID)
		return
	}
	if !env.Payload.Stream {
		writeJSON(writer, http.StatusOK, payload)
		return
	}
	w.writeResponsesSSE(writer, payload)
}

func (w *Worker) formatResponsesPayload(env *gatewayEnvelope, result gatewayJobResult) (map[string]any, error) {
	output := make([]any, 0, len(result.Images))
	for index, image := range result.Images {
		b64, err := w.imageURLToBase64(image.URL)
		if err != nil {
			return nil, err
		}
		output = append(output, map[string]any{
			"id":     fmt.Sprintf("ig_%s_%d", result.JobID, index+1),
			"result": b64,
			"status": "completed",
			"type":   "image_generation_call",
		})
	}
	toolChoice := env.Payload.ToolChoice
	if toolChoice == nil {
		toolChoice = "auto"
	}
	tools := env.Payload.Tools
	if tools == nil {
		tools = []any{}
	}
	return map[string]any{
		"background":           false,
		"created_at":           result.CreatedAt.Unix(),
		"error":                nil,
		"id":                   "resp_" + result.JobID,
		"incomplete_details":   nil,
		"instructions":         nil,
		"metadata":             map[string]any{},
		"model":                env.Payload.Model,
		"object":               "response",
		"output":               output,
		"output_text":          "",
		"parallel_tool_calls":  true,
		"previous_response_id": nil,
		"status":               "completed",
		"temperature":          nil,
		"tool_choice":          toolChoice,
		"tools":                tools,
		"top_p":                nil,
		"usage": map[string]any{
			"input_tokens":  0,
			"input_tokens_details":  map[string]any{"cached_tokens": 0},
			"output_tokens": 0,
			"output_tokens_details": map[string]any{"reasoning_tokens": 0},
			"total_tokens":  0,
		},
	}, nil
}

func (w *Worker) writeResponsesSSE(writer http.ResponseWriter, payload map[string]any) {
	flusher, ok := writer.(http.Flusher)
	if !ok {
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"error": map[string]any{"code": "SSE_UNSUPPORTED", "message": "当前连接不支持流式响应", "type": "server_error"},
		})
		return
	}
	writer.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-cache, no-transform")
	writer.Header().Set("Connection", "keep-alive")
	writer.Header().Set("X-Accel-Buffering", "no")
	writer.WriteHeader(http.StatusOK)

	writeSSEEvent(writer, "response.created", map[string]any{"type": "response.created"})
	output, _ := payload["output"].([]any)
	for index, item := range output {
		writeSSEEvent(writer, "response.output_item.done", map[string]any{
			"item":            item,
			"output_index":    index,
			"sequence_number": index + 1,
			"type":            "response.output_item.done",
		})
	}
	writeSSEEvent(writer, "response.completed", map[string]any{
		"response": payload,
		"type":     "response.completed",
	})
	_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	flusher.Flush()
}

func (w *Worker) writeResponsesFailedSSE(writer http.ResponseWriter, result gatewayJobResult) {
	flusher, ok := writer.(http.Flusher)
	if !ok {
		w.writeGatewayJobError(writer, result)
		return
	}
	writer.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-cache, no-transform")
	writer.Header().Set("Connection", "keep-alive")
	writer.Header().Set("X-Accel-Buffering", "no")
	writer.WriteHeader(http.StatusOK)

	message := result.ErrorMessage.String
	if message == "" {
		message = "生成失败"
	}
	writeSSEEvent(writer, "response.failed", map[string]any{
		"error": map[string]any{
			"message": message,
			"type":    "invalid_request_error",
		},
		"type": "response.failed",
	})
	_, _ = writer.Write([]byte("data: [DONE]\n\n"))
	flusher.Flush()
}

func writeSSEData(writer io.Writer, payload any) {
	data, _ := json.Marshal(payload)
	_, _ = fmt.Fprintf(writer, "data: %s\n\n", data)
}

func writeSSEEvent(writer io.Writer, event string, payload any) {
	data, _ := json.Marshal(payload)
	_, _ = fmt.Fprintf(writer, "event: %s\ndata: %s\n\n", event, data)
}

// formatGatewayQueryResponse 输出 generations 查询的 OpenAI 兼容结构。
func formatGatewayQueryResponse(job gatewayJob, images []gatewayImage) map[string]any {
	status := "pending"
	switch job.Status {
	case "SUCCEEDED":
		status = "succeeded"
	case "FAILED":
		status = "failed"
	}
	imageList := make([]any, 0, len(images))
	for _, image := range images {
		imageList = append(imageList, map[string]any{
			"height": image.Height,
			"id":     image.ID,
			"url":    image.URL,
			"width":  image.Width,
		})
	}
	errorMessage := job.ErrorMessage.String
	if !job.ErrorMessage.Valid {
		errorMessage = ""
	}
	return map[string]any{
		"created": job.CreatedAt.Unix(),
		"error":   errorMessage,
		"id":      job.ID,
		"images":  imageList,
		"model":   job.Model,
		"object":  "image.generation",
		"status":  status,
	}
}

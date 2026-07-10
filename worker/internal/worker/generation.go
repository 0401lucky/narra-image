package worker

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strconv"
	"strings"
)

type ProviderConfig struct {
	APIKey              string
	BaseURL             string
	Model               string
	AllowPrivateNetwork bool
}

func (provider ProviderConfig) httpClient() *http.Client {
	if provider.AllowPrivateNetwork {
		return http.DefaultClient
	}
	return newReferenceImageHTTPClient()
}

type GeneratedImage struct {
	Height *int
	URL    string
	Width  *int
}

type imagePayload struct {
	Data []map[string]any `json:"data"`
}

const providerResponseMaxBytes = 128 * 1024 * 1024
const providerErrorBodyMaxBytes = 8 * 1024
const generationErrorMessageMaxBytes = 2 * 1024

func generateImages(ctx context.Context, storage *Storage, job GenerationJob, provider ProviderConfig) ([]GeneratedImage, error) {
	if strings.TrimSpace(job.Model) == "" {
		job.Model = provider.Model
	}

	sourceImages := []SourceImage{}
	var err error
	if job.GenerationType == "IMAGE_TO_IMAGE" {
		sourceImages, err = loadSourceImages(ctx, job.SourceImageURLs)
		if err != nil {
			return nil, err
		}
		if len(sourceImages) == 0 {
			return nil, errors.New("请先上传参考图")
		}
	}

	var payload imagePayload
	if supportsResponsesImageGeneration(job.Model) {
		payload, err = generateWithResponsesImageTool(ctx, job, provider, sourceImages)
	} else if job.GenerationType == "IMAGE_TO_IMAGE" {
		payload, err = generateWithImageEdit(ctx, job, provider, sourceImages)
	} else {
		payload, err = generateWithImageGeneration(ctx, job, provider)
	}
	if err != nil {
		return nil, err
	}
	if len(payload.Data) == 0 {
		return nil, errors.New("渠道没有返回图片结果")
	}

	records := make([]GeneratedImage, 0, len(payload.Data))
	for _, item := range payload.Data {
		record, err := normalizeGeneratedImage(ctx, storage, job, item, payload)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, nil
}

func generateWithImageGeneration(ctx context.Context, job GenerationJob, provider ProviderConfig) (imagePayload, error) {
	body := map[string]any{
		"model":  job.Model,
		"n":      job.Count,
		"prompt": job.Prompt,
		"size":   job.Size,
	}
	addOutputOptions(body, job)
	if job.Moderation != "" && job.Moderation != "auto" {
		body["moderation"] = job.Moderation
	}
	if job.NegativePrompt.Valid && strings.TrimSpace(job.NegativePrompt.String) != "" {
		body["negative_prompt"] = job.NegativePrompt.String
	}
	if job.Seed.Valid {
		body["seed"] = job.Seed.Int32
	}

	responseBody, err := postJSON(
		ctx,
		endpoint(provider.BaseURL, "/images/generations"),
		provider,
		body,
		idempotencyHeaders(job.ID, "images-generations"),
	)
	if err != nil {
		return imagePayload{}, err
	}
	return parseImagePayload(responseBody)
}

func generateWithImageEdit(ctx context.Context, job GenerationJob, provider ProviderConfig, sourceImages []SourceImage) (imagePayload, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	fields := map[string]string{
		"model":  job.Model,
		"n":      "1",
		"prompt": job.Prompt,
		"size":   job.Size,
	}
	if job.Quality != "" && job.Quality != "auto" {
		fields["quality"] = job.Quality
	}
	if job.OutputFormat != "" && job.OutputFormat != "png" {
		fields["output_format"] = job.OutputFormat
		if job.OutputCompression.Valid {
			fields["output_compression"] = strconv.Itoa(int(job.OutputCompression.Int32))
		}
	}
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			return imagePayload{}, err
		}
	}

	for index, image := range sourceImages {
		part, err := createImageFormFile(writer, "image", image, index)
		if err != nil {
			return imagePayload{}, err
		}
		if _, err := part.Write(image.Data); err != nil {
			return imagePayload{}, err
		}
	}
	if err := writer.Close(); err != nil {
		return imagePayload{}, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint(provider.BaseURL, "/images/edits"), &body)
	if err != nil {
		return imagePayload{}, err
	}
	request.Header.Set("Authorization", "Bearer "+provider.APIKey)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Idempotency-Key", idempotencyKey(job.ID, "images-edits"))

	responseBody, err := doRequestWithClient(request, provider.httpClient())
	if err != nil {
		return imagePayload{}, err
	}
	return parseImagePayload(responseBody)
}

func generateWithResponsesImageTool(ctx context.Context, job GenerationJob, provider ProviderConfig, sourceImages []SourceImage) (imagePayload, error) {
	count := job.Count
	if job.GenerationType == "IMAGE_TO_IMAGE" {
		count = 1
	}

	results := make([]map[string]any, 0, count)
	for index := range count {
		requestBody := buildResponsesRequest(job, provider.BaseURL, sourceImages, shouldUseAnyrouterResponsesCompat(provider.BaseURL))
		items, err := createResponsesImageGeneration(
			ctx,
			provider,
			requestBody,
			idempotencyKey(job.ID, fmt.Sprintf("responses-image-%d", index)),
		)
		if err != nil {
			return imagePayload{}, err
		}
		for _, item := range items {
			results = append(results, map[string]any{"b64_json": item})
		}
	}

	return imagePayload{Data: results}, nil
}

func buildResponsesRequest(job GenerationJob, providerBaseURL string, sourceImages []SourceImage, useAnyrouterCompat bool) map[string]any {
	tool := map[string]any{
		"type": "image_generation",
	}
	addOutputOptions(tool, job)
	if job.Moderation != "" && job.Moderation != "auto" {
		tool["moderation"] = job.Moderation
	}
	if useAnyrouterCompat {
		tool["output_format"] = outputFormat(job)
	}
	if job.Size != "" && job.Size != "auto" {
		tool["size"] = job.Size
	}

	request := map[string]any{
		"input": buildResponsesInput(job.Prompt, sourceImages, useAnyrouterCompat),
		"model": job.Model,
		"tools": []any{tool},
	}
	if useAnyrouterCompat {
		request["stream"] = true
	}
	return request
}

func buildResponsesInput(prompt string, sourceImages []SourceImage, useAnyrouterCompat bool) any {
	if useAnyrouterCompat {
		if len(sourceImages) == 0 {
			return []any{
				map[string]any{
					"content": "你是一个图片生成助手。用户要求你生成图片时，你必须调用 image_generation 工具来生成图片，不要用文字描述图片内容。直接生成图片，不要多说任何话。",
					"role":    "system",
				},
				map[string]any{
					"content": "请生成以下描述的图片：" + prompt,
					"role":    "user",
				},
			}
		}
		content := make([]any, 0, len(sourceImages)+1)
		for _, image := range sourceImages {
			content = append(content, map[string]any{
				"image_url": imageDataURL(image),
				"type":      "input_image",
			})
		}
		content = append(content, map[string]any{
			"text": "请根据以下要求，对我提供的参考图片进行编辑修改，直接生成修改后的新图片。要求：" + prompt,
			"type": "input_text",
		})
		return []any{map[string]any{"content": content, "role": "user"}}
	}

	if len(sourceImages) == 0 {
		return prompt
	}

	content := make([]any, 0, len(sourceImages)+1)
	content = append(content, map[string]any{
		"text": prompt,
		"type": "input_text",
	})
	for _, image := range sourceImages {
		content = append(content, map[string]any{
			"image_url": imageDataURL(image),
			"type":      "input_image",
		})
	}
	return []any{map[string]any{"content": content, "role": "user"}}
}

func createResponsesImageGeneration(ctx context.Context, provider ProviderConfig, requestBody map[string]any, requestID string) ([]string, error) {
	headers := map[string]string{"Idempotency-Key": requestID}
	if shouldUseAnyrouterResponsesCompat(provider.BaseURL) {
		headers["chatgpt-account-id"] = ""
		headers["originator"] = "codex_cli_rs"
		headers["session_id"] = "narra-image-worker"
		headers["version"] = "0.122.0"
		headers["accept"] = "text/event-stream"
	}

	body, err := postJSON(ctx, endpoint(provider.BaseURL, "/responses"), provider, requestBody, headers)
	if err != nil {
		if !strings.Contains(strings.ToLower(err.Error()), "must be stream request") {
			return nil, err
		}
		requestBody["stream"] = true
		streamHeaders := map[string]string{}
		for key, value := range headers {
			streamHeaders[key] = value
		}
		streamHeaders["Idempotency-Key"] = requestID + ":stream"
		body, err = postJSON(ctx, endpoint(provider.BaseURL, "/responses"), provider, requestBody, streamHeaders)
		if err != nil {
			return nil, err
		}
	}

	if stream, ok := requestBody["stream"].(bool); ok && stream {
		return collectResponsesStreamResults(body), nil
	}

	var payload any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	return collectImageResults(payload), nil
}

func idempotencyHeaders(jobID string, operation string) map[string]string {
	return map[string]string{"Idempotency-Key": idempotencyKey(jobID, operation)}
}

func idempotencyKey(jobID string, operation string) string {
	return "narra-image:" + jobID + ":" + operation
}

func normalizeGeneratedImage(ctx context.Context, storage *Storage, job GenerationJob, item map[string]any, payload imagePayload) (GeneratedImage, error) {
	if b64JSON, ok := pickString(item, "b64_json"); ok {
		data, err := base64.StdEncoding.DecodeString(b64JSON)
		if err != nil {
			return GeneratedImage{}, err
		}
		dimensions := extractDimensionsFromMetadata(item)
		if dimensions == nil {
			dimensions = readImageDimensions(data)
		}
		url, err := storage.PersistImage(ctx, job.UserID, data, outputFormat(job), mimeTypeFromOutputFormat(job))
		if err != nil {
			return GeneratedImage{}, err
		}
		return generatedImageRecord(url, dimensions), nil
	}

	if rawURL, ok := pickString(item, "url"); ok {
		dimensions := extractDimensionsFromMetadata(item)
		persisted, err := storage.PersistImageFromURL(
			ctx,
			job.UserID,
			rawURL,
			providerHTTPClient(job.ProviderMode != "CUSTOM"),
		)
		if err != nil {
			return GeneratedImage{}, err
		}
		if dimensions == nil {
			dimensions = readImageDimensions(persisted.Data)
		}
		return generatedImageRecord(persisted.URL, dimensions), nil
	}

	return GeneratedImage{}, errors.New("返回结果里没有可用图片")
}

func generatedImageRecord(rawURL string, dimensions *ImageDimensions) GeneratedImage {
	if dimensions == nil {
		return GeneratedImage{URL: rawURL}
	}
	return GeneratedImage{
		Height: &dimensions.Height,
		URL:    rawURL,
		Width:  &dimensions.Width,
	}
}

func addOutputOptions(target map[string]any, job GenerationJob) {
	if job.OutputFormat != "" && job.OutputFormat != "png" {
		target["output_format"] = job.OutputFormat
		if job.OutputCompression.Valid {
			target["output_compression"] = job.OutputCompression.Int32
		}
	}
	if job.Quality != "" && job.Quality != "auto" {
		target["quality"] = job.Quality
	}
}

func parseImagePayload(body []byte) (imagePayload, error) {
	var payload imagePayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return imagePayload{}, err
	}
	return payload, nil
}

func postJSON(ctx context.Context, rawURL string, provider ProviderConfig, payload map[string]any, headers map[string]string) ([]byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+provider.APIKey)
	request.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	return doRequestWithClient(request, provider.httpClient())
}

func doRequest(request *http.Request) ([]byte, error) {
	return doRequestWithClient(request, http.DefaultClient)
}

func doRequestWithClient(request *http.Request, client *http.Client) ([]byte, error) {
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, truncated, err := readBodyWithLimit(response.Body, providerErrorBodyMaxBytes)
		if err != nil {
			return nil, err
		}
		summary := strings.TrimSpace(string(body))
		if truncated {
			summary += "…（错误响应已截断）"
		}
		return nil, fmt.Errorf("渠道请求失败：HTTP %d %s", response.StatusCode, summary)
	}

	if response.ContentLength > providerResponseMaxBytes {
		return nil, errors.New("渠道响应过大")
	}
	body, truncated, err := readBodyWithLimit(response.Body, providerResponseMaxBytes)
	if err != nil {
		return nil, err
	}
	if truncated {
		return nil, errors.New("渠道响应过大")
	}
	return body, nil
}

func readBodyWithLimit(body io.Reader, limit int64) ([]byte, bool, error) {
	data, err := io.ReadAll(io.LimitReader(body, limit+1))
	if err != nil {
		return nil, false, err
	}
	if int64(len(data)) > limit {
		return data[:limit], true, nil
	}
	return data, false, nil
}

func truncateGenerationErrorMessage(message string) string {
	validMessage := strings.ToValidUTF8(message, "�")
	if len(validMessage) <= generationErrorMessageMaxBytes {
		return validMessage
	}
	cutoff := generationErrorMessageMaxBytes
	for cutoff > 0 && validMessage[cutoff]&0xc0 == 0x80 {
		cutoff--
	}
	return validMessage[:cutoff] + "…（错误信息已截断）"
}

func collectResponsesStreamResults(body []byte) []string {
	results := []string{}
	seen := map[string]bool{}
	scanner := bufio.NewScanner(bytes.NewReader(body))
	scanner.Buffer(make([]byte, 1024), 64*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var value any
		if err := json.Unmarshal([]byte(payload), &value); err != nil {
			continue
		}
		for _, result := range collectImageResults(value) {
			if !seen[result] {
				seen[result] = true
				results = append(results, result)
			}
		}
	}
	return results
}

func collectImageResults(value any) []string {
	results := []string{}
	var visit func(any)
	visit = func(current any) {
		switch typed := current.(type) {
		case []any:
			for _, item := range typed {
				visit(item)
			}
		case map[string]any:
			if result, ok := typed["result"].(string); ok && looksLikeImageBase64Result(result) {
				results = append(results, result)
			}
			for _, item := range typed {
				visit(item)
			}
		}
	}
	visit(value)
	return results
}

func extractDimensionsFromMetadata(item map[string]any) *ImageDimensions {
	if size, ok := pickString(item, "size"); ok {
		if dimensions := parseSizeString(size); dimensions != nil {
			return dimensions
		}
	}
	width, widthOK := pickNumber(item, "width", "actual_width", "actualWidth")
	height, heightOK := pickNumber(item, "height", "actual_height", "actualHeight")
	if widthOK && heightOK && width > 0 && height > 0 {
		return &ImageDimensions{Height: height, Width: width}
	}
	return nil
}

func parseSizeString(value string) *ImageDimensions {
	parts := strings.FieldsFunc(strings.TrimSpace(value), func(r rune) bool {
		return r == 'x' || r == 'X' || r == '×'
	})
	if len(parts) != 2 {
		return nil
	}
	width, errWidth := strconv.Atoi(strings.TrimSpace(parts[0]))
	height, errHeight := strconv.Atoi(strings.TrimSpace(parts[1]))
	if errWidth != nil || errHeight != nil || width <= 0 || height <= 0 {
		return nil
	}
	return &ImageDimensions{Height: height, Width: width}
}

func pickString(item map[string]any, key string) (string, bool) {
	value, ok := item[key].(string)
	return value, ok && value != ""
}

func pickNumber(item map[string]any, keys ...string) (int, bool) {
	for _, key := range keys {
		switch value := item[key].(type) {
		case float64:
			return int(value), value > 0
		case int:
			return value, value > 0
		}
	}
	return 0, false
}

func endpoint(baseURL string, suffix string) string {
	return strings.TrimRight(baseURL, "/") + suffix
}

func outputFormat(job GenerationJob) string {
	if job.OutputFormat == "" {
		return "png"
	}
	return job.OutputFormat
}

func mimeTypeFromOutputFormat(job GenerationJob) string {
	switch outputFormat(job) {
	case "jpeg", "jpg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	default:
		return "image/png"
	}
}

func imageDataURL(image SourceImage) string {
	mimeType := imageMimeType(image.MimeType, image.Data)
	return fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(image.Data))
}

func createImageFormFile(writer *multipart.Writer, fieldName string, image SourceImage, index int) (io.Writer, error) {
	fileName := strings.TrimSpace(image.FileName)
	if fileName == "" {
		fileName = fmt.Sprintf("source-%d.%s", index+1, extensionFromMime(imageMimeType(image.MimeType, image.Data)))
	}

	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{
		"name":     fieldName,
		"filename": fileName,
	}))
	header.Set("Content-Type", imageMimeType(image.MimeType, image.Data))
	return writer.CreatePart(header)
}

func supportsResponsesImageGeneration(modelID string) bool {
	id := strings.ToLower(modelID)
	return strings.HasPrefix(id, "gpt-5") ||
		strings.Contains(id, "/gpt-5") ||
		strings.Contains(id, "gpt-5.")
}

func shouldUseAnyrouterResponsesCompat(baseURL string) bool {
	lower := strings.ToLower(baseURL)
	return strings.Contains(lower, "anyrouter")
}

func looksLikeImageBase64Result(value string) bool {
	return len(value) > 1000 ||
		strings.HasPrefix(value, "iVBOR") ||
		strings.HasPrefix(value, "/9j/") ||
		strings.HasPrefix(value, "UklGR") ||
		strings.HasPrefix(value, "R0lG")
}

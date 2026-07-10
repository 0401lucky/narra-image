package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const remoteVideoMaxBytes = 128 * 1024 * 1024

// VideoResult 是一次视频生成的产物，写入 GeneratedVideo。
type VideoResult struct {
	URL             string
	PosterURL       string
	Width           *int
	Height          *int
	DurationSeconds *int
}

type videoCreateResponse struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// videoStatusResponse 是轮询 GET /videos/{id} 的响应。
// 注意：agnes-video 把成品 mp4 URL 放在 remixed_from_video_id 字段——
// 字段名有误导，但实测 completed 时该字段即为结果视频地址（公开可下载）。
type videoStatusResponse struct {
	ID       string `json:"id"`
	Status   string `json:"status"`
	Progress *int   `json:"progress,omitempty"`
	VideoURL string `json:"remixed_from_video_id"`
	Seconds  string `json:"seconds"`
	Size     string `json:"size"`
}

type videoGenerationsResponse struct {
	Created  int64                 `json:"created"`
	Data     []videoGenerationItem `json:"data"`
	URL      string                `json:"url"`
	VideoURL string                `json:"video_url"`
}

type videoGenerationItem struct {
	Ratio string `json:"ratio"`
	URL   string `json:"url"`
}

// generateVideo 在单次任务内完成「提交→轮询→取结果」。pollInterval 由调用方传入
// （生产取 cfg.VideoPollInterval，测试取极小值）。整体受 ctx 的 JobTimeout 约束。
func generateVideo(ctx context.Context, storage *Storage, job GenerationJob, provider ProviderConfig, pollInterval time.Duration) (VideoResult, error) {
	model := job.Model
	if strings.TrimSpace(model) == "" {
		model = provider.Model
	}

	videoID, err := createVideo(ctx, job, provider, model)
	if err != nil {
		if job.GenerationType == "TEXT_TO_VIDEO" && isHTTPStatusError(err, http.StatusNotFound, http.StatusMethodNotAllowed) {
			return generateVideoWithGenerationsEndpoint(ctx, storage, job, provider, model)
		}
		return VideoResult{}, err
	}

	final, err := pollVideo(ctx, provider, videoID, pollInterval)
	if err != nil {
		return VideoResult{}, err
	}

	return buildVideoResult(ctx, storage, job, final.VideoURL, final.Seconds, final.Size)
}

func createVideo(ctx context.Context, job GenerationJob, provider ProviderConfig, model string) (string, error) {
	body := map[string]any{
		"model":  model,
		"prompt": job.Prompt,
	}
	if job.DurationSeconds.Valid {
		body["seconds"] = strconv.Itoa(int(job.DurationSeconds.Int32))
	}
	if job.Size != "" && job.Size != "auto" {
		body["size"] = job.Size
	}
	if job.GenerationType == "IMAGE_TO_VIDEO" {
		if len(job.SourceImageURLs) == 0 {
			return "", errors.New("图生视频缺少首帧/参考图")
		}
		// 首帧以公开 URL 形式传入（参考图已转存 S3）。
		body["input_reference"] = job.SourceImageURLs[0]
	}

	// create 仅是提交任务，正常应秒回。加 30s 超时，避免图生视频在渠道网关
	// （agnes litellm 对 multipart 转发有故障）一直挂到 ~60s 才失败。
	createCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	responseBody, err := postJSON(
		createCtx,
		endpoint(provider.BaseURL, "/videos"),
		provider,
		body,
		idempotencyHeaders(job.ID, "videos-create"),
	)
	if err != nil {
		if job.GenerationType == "IMAGE_TO_VIDEO" {
			return "", fmt.Errorf("图生视频暂不可用（渠道网关故障，可稍后再试或改用文生视频）：%w", err)
		}
		return "", err
	}
	var created videoCreateResponse
	if err := json.Unmarshal(responseBody, &created); err != nil {
		return "", err
	}
	if created.ID == "" {
		return "", errors.New("视频渠道未返回任务 id")
	}
	return created.ID, nil
}

// generateVideoWithGenerationsEndpoint 兼容 qwen2api-rs 这类 OpenAI 风格同步视频接口：
// POST /videos/generations 直接返回 data[].url，不再返回任务 id 供轮询。
func generateVideoWithGenerationsEndpoint(ctx context.Context, storage *Storage, job GenerationJob, provider ProviderConfig, model string) (VideoResult, error) {
	body := map[string]any{
		"model":  model,
		"prompt": job.Prompt,
	}
	if ratio := videoRequestRatio(job); ratio != "" {
		body["ratio"] = ratio
	}
	if job.DurationSeconds.Valid {
		body["seconds"] = strconv.Itoa(int(job.DurationSeconds.Int32))
	}
	if job.Size != "" && job.Size != "auto" {
		body["size"] = job.Size
	}

	responseBody, err := postJSON(
		ctx,
		endpoint(provider.BaseURL, "/videos/generations"),
		provider,
		body,
		idempotencyHeaders(job.ID, "videos-generations"),
	)
	if err != nil {
		return VideoResult{}, err
	}
	var generated videoGenerationsResponse
	if err := json.Unmarshal(responseBody, &generated); err != nil {
		return VideoResult{}, err
	}
	videoURL := firstGeneratedVideoURL(generated)
	if strings.TrimSpace(videoURL) == "" {
		return VideoResult{}, errors.New("视频渠道未返回视频地址")
	}
	return buildVideoResult(ctx, storage, job, videoURL, "", "")
}

// pollVideo 轮询直到任务到达终态，返回完成时的状态响应（含视频 URL）。
func pollVideo(ctx context.Context, provider ProviderConfig, videoID string, pollInterval time.Duration) (videoStatusResponse, error) {
	if pollInterval <= 0 {
		pollInterval = 5 * time.Second
	}
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		status, err := fetchVideoStatus(ctx, provider, videoID)
		if err != nil {
			return videoStatusResponse{}, err
		}
		switch strings.ToLower(status.Status) {
		case "completed", "succeeded":
			return status, nil
		case "failed", "error", "cancelled", "canceled":
			return videoStatusResponse{}, fmt.Errorf("视频生成失败：渠道返回状态 %s", status.Status)
		}

		select {
		case <-ctx.Done():
			return videoStatusResponse{}, ctx.Err()
		case <-ticker.C:
		}
	}
}

func fetchVideoStatus(ctx context.Context, provider ProviderConfig, videoID string) (videoStatusResponse, error) {
	body, err := getWithAuth(ctx, endpoint(provider.BaseURL, "/videos/"+videoID), provider)
	if err != nil {
		return videoStatusResponse{}, err
	}
	var parsed videoStatusResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return videoStatusResponse{}, err
	}
	if parsed.Status == "" {
		return videoStatusResponse{}, errors.New("视频渠道未返回状态")
	}
	return parsed, nil
}

func buildVideoResult(ctx context.Context, storage *Storage, job GenerationJob, rawURL string, secondsValue string, sizeValue string) (VideoResult, error) {
	if strings.TrimSpace(rawURL) == "" {
		return VideoResult{}, errors.New("视频生成完成但渠道未返回视频地址")
	}

	// 有对象存储则下载转存到本站 S3（长期可播放）；否则直接用渠道公开 URL
	// （与图片直接用渠道 URL 一致，避免把大体积视频塞进数据库）。
	url := rawURL
	if storage.hasObjectStorage() {
		data, err := downloadVideo(
			ctx,
			rawURL,
			providerHTTPClient(job.ProviderMode != "CUSTOM"),
		)
		if err != nil {
			return VideoResult{}, err
		}
		stored, err := storage.PersistVideo(ctx, job.UserID, data)
		if err != nil {
			return VideoResult{}, err
		}
		url = stored
	}

	result := VideoResult{URL: url}
	// 时长/尺寸优先用渠道实际返回值（渠道可能对请求做归一化），回退到任务请求值。
	if seconds := parseSeconds(secondsValue); seconds > 0 {
		result.DurationSeconds = &seconds
	} else if job.DurationSeconds.Valid {
		seconds := int(job.DurationSeconds.Int32)
		result.DurationSeconds = &seconds
	}
	width, height := parseAspectSize(sizeValue)
	if width <= 0 || height <= 0 {
		width, height = parseAspectSize(job.Size)
	}
	if width > 0 && height > 0 {
		result.Width = &width
		result.Height = &height
	}
	return result, nil
}

// downloadVideo 下载成品视频字节。渠道返回的是公开可访问的对象存储地址，无需鉴权。
func downloadVideo(ctx context.Context, rawURL string, client *http.Client) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("视频下载失败：HTTP %d", response.StatusCode)
	}
	if response.ContentLength > remoteVideoMaxBytes {
		return nil, errors.New("视频文件过大，无法保存")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, remoteVideoMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > remoteVideoMaxBytes {
		return nil, errors.New("视频文件过大，无法保存")
	}
	return data, nil
}

func getWithAuth(ctx context.Context, rawURL string, provider ProviderConfig) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+provider.APIKey)
	return doRequestWithClient(request, provider.httpClient())
}

func firstGeneratedVideoURL(response videoGenerationsResponse) string {
	if strings.TrimSpace(response.VideoURL) != "" {
		return response.VideoURL
	}
	if strings.TrimSpace(response.URL) != "" {
		return response.URL
	}
	for _, item := range response.Data {
		if strings.TrimSpace(item.URL) != "" {
			return item.URL
		}
	}
	return ""
}

func videoRequestRatio(job GenerationJob) string {
	if job.AspectRatio.Valid && strings.TrimSpace(job.AspectRatio.String) != "" {
		return strings.TrimSpace(job.AspectRatio.String)
	}
	width, height := parseAspectSize(job.Size)
	if width <= 0 || height <= 0 {
		return ""
	}
	switch {
	case width == height:
		return "1:1"
	case width > height:
		return "16:9"
	default:
		return "9:16"
	}
}

func isHTTPStatusError(err error, codes ...int) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	for _, code := range codes {
		if strings.Contains(message, fmt.Sprintf("HTTP %d", code)) {
			return true
		}
	}
	return false
}

// parseAspectSize 解析 "1280x720" 形式，复用 storage 侧的维度约定。
func parseAspectSize(size string) (int, int) {
	dimensions := parseSizeString(size)
	if dimensions == nil {
		return 0, 0
	}
	return dimensions.Width, dimensions.Height
}

// parseSeconds 把 "5.0"/"8" 这类时长字符串解析为整数秒。
func parseSeconds(value string) int {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	if f, err := strconv.ParseFloat(value, 64); err == nil && f > 0 {
		return int(f)
	}
	return 0
}

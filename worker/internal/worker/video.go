package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

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

// generateVideo 在单次任务内完成「提交→轮询→取结果」。pollInterval 由调用方传入
// （生产取 cfg.VideoPollInterval，测试取极小值）。整体受 ctx 的 JobTimeout 约束。
func generateVideo(ctx context.Context, storage *Storage, job GenerationJob, provider ProviderConfig, pollInterval time.Duration) (VideoResult, error) {
	model := job.Model
	if strings.TrimSpace(model) == "" {
		model = provider.Model
	}

	videoID, err := createVideo(ctx, job, provider, model)
	if err != nil {
		return VideoResult{}, err
	}

	final, err := pollVideo(ctx, provider, videoID, pollInterval)
	if err != nil {
		return VideoResult{}, err
	}
	if strings.TrimSpace(final.VideoURL) == "" {
		return VideoResult{}, errors.New("视频生成完成但渠道未返回视频地址")
	}

	// 渠道成品视频在对象存储（公开 URL）上，下载后转存到本站 S3 以便长期可播放。
	data, err := downloadVideo(ctx, final.VideoURL)
	if err != nil {
		return VideoResult{}, err
	}

	url, err := storage.PersistVideo(ctx, job.UserID, data)
	if err != nil {
		return VideoResult{}, err
	}

	result := VideoResult{URL: url}
	// 时长/尺寸优先用渠道实际返回值（渠道可能对请求做归一化），回退到任务请求值。
	if seconds := parseSeconds(final.Seconds); seconds > 0 {
		result.DurationSeconds = &seconds
	} else if job.DurationSeconds.Valid {
		seconds := int(job.DurationSeconds.Int32)
		result.DurationSeconds = &seconds
	}
	width, height := parseAspectSize(final.Size)
	if width <= 0 || height <= 0 {
		width, height = parseAspectSize(job.Size)
	}
	if width > 0 && height > 0 {
		result.Width = &width
		result.Height = &height
	}
	return result, nil
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

	responseBody, err := postJSON(ctx, endpoint(provider.BaseURL, "/videos"), provider.APIKey, body, nil)
	if err != nil {
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
	body, err := getWithAuth(ctx, endpoint(provider.BaseURL, "/videos/"+videoID), provider.APIKey)
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

// downloadVideo 下载成品视频字节。渠道返回的是公开可访问的对象存储地址，无需鉴权。
func downloadVideo(ctx context.Context, rawURL string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	return doRequest(request)
}

func getWithAuth(ctx context.Context, rawURL string, apiKey string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	return doRequest(request)
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

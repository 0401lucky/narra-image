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

type videoStatusResponse struct {
	ID       string `json:"id"`
	Status   string `json:"status"`
	Progress *int   `json:"progress,omitempty"`
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

	if err := pollVideo(ctx, provider, videoID, pollInterval); err != nil {
		return VideoResult{}, err
	}

	data, err := fetchVideoContent(ctx, provider, videoID)
	if err != nil {
		return VideoResult{}, err
	}

	url, err := storage.PersistVideo(ctx, job.UserID, data)
	if err != nil {
		return VideoResult{}, err
	}

	result := VideoResult{URL: url}
	if job.DurationSeconds.Valid {
		seconds := int(job.DurationSeconds.Int32)
		result.DurationSeconds = &seconds
	}
	if width, height := parseAspectSize(job.Size); width > 0 && height > 0 {
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
		sourceImages, err := loadSourceImages(ctx, job.SourceImageURLs)
		if err != nil {
			return "", err
		}
		if len(sourceImages) == 0 {
			return "", errors.New("图生视频缺少首帧/参考图")
		}
		body["input_reference"] = imageDataURL(sourceImages[0])
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

func pollVideo(ctx context.Context, provider ProviderConfig, videoID string, pollInterval time.Duration) error {
	if pollInterval <= 0 {
		pollInterval = 5 * time.Second
	}
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		status, err := fetchVideoStatus(ctx, provider, videoID)
		if err != nil {
			return err
		}
		switch strings.ToLower(status) {
		case "completed", "succeeded":
			return nil
		case "failed", "error", "cancelled", "canceled":
			return fmt.Errorf("视频生成失败：渠道返回状态 %s", status)
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func fetchVideoStatus(ctx context.Context, provider ProviderConfig, videoID string) (string, error) {
	body, err := getWithAuth(ctx, endpoint(provider.BaseURL, "/videos/"+videoID), provider.APIKey)
	if err != nil {
		return "", err
	}
	var parsed videoStatusResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}
	if parsed.Status == "" {
		return "", errors.New("视频渠道未返回状态")
	}
	return parsed.Status, nil
}

func fetchVideoContent(ctx context.Context, provider ProviderConfig, videoID string) ([]byte, error) {
	return getWithAuth(ctx, endpoint(provider.BaseURL, "/videos/"+videoID+"/content"), provider.APIKey)
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

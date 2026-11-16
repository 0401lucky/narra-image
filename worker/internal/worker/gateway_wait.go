package worker

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

var errGatewayWaitTimeout = errors.New("网关等待任务超时")

func nullableIntFromInt32(value sql.NullInt32) *int {
	if !value.Valid {
		return nil
	}
	converted := int(value.Int32)
	return &converted
}

// gatewayImage 是网关响应所需的图片视图。
type gatewayImage struct {
	ID           string
	URL          string
	MediaAssetID string
	Width        *int
	Height       *int
	Availability string
}

func projectGatewayImageURL(image gatewayImage, appURL, assetID, publicToken string) (gatewayImage, error) {
	image.MediaAssetID = assetID
	if assetID == "" {
		return image, nil
	}
	if gatewayImageAvailability(image) != "available" {
		image.URL = ""
		return image, nil
	}
	if !imageUUIDPattern.MatchString(assetID) {
		return gatewayImage{}, ImageStorageError{Code: "IMAGE_UNAVAILABLE"}
	}
	projected, err := ImagePublicURL(appURL, publicToken)
	if err != nil {
		return gatewayImage{}, ImageStorageError{Code: "IMAGE_UNAVAILABLE"}
	}
	// Original GenerationImage.url is immutable provenance. External readers
	// must enter the media token route so retiring that source keeps working.
	image.URL = projected
	return image, nil
}

// gatewayJobResult 是等待完成后网关消费的结果视图。
type gatewayJobResult struct {
	JobID        string
	Status       string
	ErrorCode    sql.NullString
	ErrorMessage sql.NullString
	Model        string
	CreatedAt    time.Time
	Images       []gatewayImage
}

// waitForGatewayJob 轮询 GenerationJob 至 SUCCEEDED/FAILED 或超时。
// 超时不取消已 handoff 的任务、不退款；客户端通过 generations 查询获取终态。
func (w *Worker) waitForGatewayJob(
	ctx context.Context,
	jobID string,
	timeout time.Duration,
	interval time.Duration,
) (gatewayJobResult, error) {
	if timeout <= 0 {
		timeout = 900 * time.Second
	}
	if interval <= 0 {
		interval = time.Second
	}
	deadline := time.Now().Add(timeout)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		result, err := w.pollGatewayJob(ctx, jobID)
		if err != nil {
			return gatewayJobResult{}, err
		}
		switch result.Status {
		case "SUCCEEDED":
			images, err := w.readGatewayImages(ctx, jobID)
			if err != nil {
				return gatewayJobResult{}, err
			}
			result.Images = images
			return result, nil
		case "FAILED":
			return result, nil
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			return gatewayJobResult{}, errGatewayWaitTimeout
		}
		select {
		case <-ticker.C:
		case <-ctx.Done():
			return gatewayJobResult{}, errGatewayWaitTimeout
		}
	}
}

func (w *Worker) pollGatewayJob(ctx context.Context, jobID string) (gatewayJobResult, error) {
	var result gatewayJobResult
	err := w.pool.QueryRow(ctx, `
SELECT id, status, "errorCode", "errorMessage", model, "createdAt"
FROM "GenerationJob"
WHERE id = $1
`, jobID).Scan(
		&result.JobID,
		&result.Status,
		&result.ErrorCode,
		&result.ErrorMessage,
		&result.Model,
		&result.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return gatewayJobResult{}, errors.New("生成任务不存在")
		}
		return gatewayJobResult{}, err
	}
	return result, nil
}

func (w *Worker) readGatewayImages(ctx context.Context, jobID string) ([]gatewayImage, error) {
	// The schema is deployed independently of the rollout flag. Turning off
	// managed writes cannot make a known tombstone an available legacy image.
	rows, err := w.pool.Query(ctx, `
SELECT i.id, i.url, i.width, i.height,
  CASE WHEN a.state = 'DELETED' THEN 'cleaned'
       WHEN a.state IS NOT NULL AND a.state <> 'AVAILABLE' THEN 'unavailable'
       ELSE 'available' END,
  a.id, a."publicToken"
FROM "GenerationImage" i LEFT JOIN "ImageAsset" a ON a.id=i."mediaAssetId"
WHERE i."jobId"=$1 ORDER BY i."createdAt" ASC
`, jobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var images []gatewayImage
	for rows.Next() {
		var image gatewayImage
		var width sql.NullInt32
		var height sql.NullInt32
		var assetID sql.NullString
		var publicToken sql.NullString
		if err := rows.Scan(&image.ID, &image.URL, &width, &height, &image.Availability, &assetID, &publicToken); err != nil {
			return nil, err
		}
		image, err = projectGatewayImageURL(image, w.cfg.AppURL, assetID.String, publicToken.String)
		if err != nil {
			return nil, err
		}
		image.Width = nullableIntFromInt32(width)
		image.Height = nullableIntFromInt32(height)
		images = append(images, image)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return images, nil
}

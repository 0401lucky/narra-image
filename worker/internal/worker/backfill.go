package worker

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// BackfillOptions 控制历史媒体回填的扫描范围。
type BackfillOptions struct {
	// DryRun 只统计可回填的行，不写 S3 也不更新数据库。
	DryRun bool
	// Limit 限制本次最多处理的图片/视频行数；0 表示不限制。
	Limit int
	// IncludeHTTP 为 true 时把 http(s) 图片/视频也纳入回填；
	// 否则只处理 data: 前缀的历史行，未知来源保持 NULL。
	IncludeHTTP bool
}

type BackfillResult struct {
	DryRun        bool
	ImagesScanned int
	ImagesUpdated int
	VideosScanned int
	VideosUpdated int
	SkippedNoData int
	SkippedNoS3   int
	FailedFetch   int
	Errors        []string
}

// BackfillMedia 扫描 mediaStorage IS NULL 的历史生成媒体行并转存对象存储。
// 幂等：仅处理 mediaStorage IS NULL 的行，重复执行不会重复转存；
// 每行在事务内更新 url + mediaStorage + storageKey。
func BackfillMedia(ctx context.Context, pool *pgxpool.Pool, storage *Storage, opts BackfillOptions) (BackfillResult, error) {
	if !storage.hasObjectStorage() {
		return BackfillResult{}, errors.New("未配置对象存储（S3/R2），无法执行媒体回填")
	}
	if opts.Limit < 0 {
		opts.Limit = 0
	}
	result := BackfillResult{DryRun: opts.DryRun}
	remaining := opts.Limit

	images, err := scanMediaRows(ctx, pool, "GenerationImage", remaining)
	if err != nil {
		return result, err
	}
	for _, row := range images {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		result.ImagesScanned++
		updated, skip := backfillImageRow(ctx, pool, storage, row, opts)
		switch skip {
		case skipNoData:
			result.SkippedNoData++
			continue
		case skipNoS3:
			result.SkippedNoS3++
			continue
		case skipFetchFailed:
			result.FailedFetch++
			continue
		}
		if updated {
			result.ImagesUpdated++
		} else {
			result.Errors = append(result.Errors, fmt.Sprintf("图片 %s 转存后未更新", row.ID))
		}
		if remaining > 0 {
			remaining--
			if remaining == 0 {
				break
			}
		}
	}

	if remaining == 0 && opts.Limit > 0 {
		return result, nil
	}

	videos, err := scanMediaRows(ctx, pool, "GeneratedVideo", remaining)
	if err != nil {
		return result, err
	}
	for _, row := range videos {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		result.VideosScanned++
		updated, skip := backfillVideoRow(ctx, pool, storage, row, opts)
		switch skip {
		case skipNoData:
			result.SkippedNoData++
			continue
		case skipNoS3:
			result.SkippedNoS3++
			continue
		case skipFetchFailed:
			result.FailedFetch++
			continue
		}
		if updated {
			result.VideosUpdated++
		} else {
			result.Errors = append(result.Errors, fmt.Sprintf("视频 %s 转存后未更新", row.ID))
		}
		if remaining > 0 {
			remaining--
			if remaining == 0 {
				break
			}
		}
	}

	return result, nil
}

type mediaRow struct {
	ID     string
	URL    string
	UserID string
}

type skipKind int

const (
	skipNone        skipKind = iota
	skipNoData      skipKind = iota
	skipNoS3        skipKind = iota
	skipFetchFailed skipKind = iota
)

func scanMediaRows(ctx context.Context, pool *pgxpool.Pool, table string, limit int) ([]mediaRow, error) {
	query := fmt.Sprintf(`
SELECT m.id, m.url, u.id
FROM %q m
JOIN "GenerationJob" j ON j.id = m."jobId"
JOIN "User" u ON u.id = j."userId"
WHERE m."mediaStorage" IS NULL
ORDER BY m."jobId", m.id
`, table)
	if limit > 0 {
		query += fmt.Sprintf(" LIMIT %d", limit)
	}
	rows, err := pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []mediaRow
	for rows.Next() {
		var item mediaRow
		if err := rows.Scan(&item.ID, &item.URL, &item.UserID); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func backfillImageRow(ctx context.Context, pool *pgxpool.Pool, storage *Storage, row mediaRow, opts BackfillOptions) (bool, skipKind) {
	if strings.HasPrefix(row.URL, "data:") {
		image, err := parseDataURL(row.URL, 0)
		if err != nil {
			return false, skipNoData
		}
		return persistAndUpdateImage(ctx, pool, storage, row, image.Data, extensionFromMime(image.MimeType), image.MimeType, opts)
	}
	if opts.IncludeHTTP && isHTTPURL(row.URL) {
		image, err := downloadRemoteImage(ctx, row.URL, newReferenceImageHTTPClient())
		if err != nil {
			return false, skipFetchFailed
		}
		return persistAndUpdateImage(ctx, pool, storage, row, image.Data, extensionFromMime(image.MimeType), image.MimeType, opts)
	}
	return false, skipNoData
}

func persistAndUpdateImage(
	ctx context.Context,
	pool *pgxpool.Pool,
	storage *Storage,
	row mediaRow,
	data []byte,
	extension string,
	mimeType string,
	opts BackfillOptions,
) (bool, skipKind) {
	if opts.DryRun {
		return true, skipNone
	}
	persisted, err := storage.PersistImage(ctx, row.UserID, data, extension, mimeType)
	if err != nil {
		return false, skipNoS3
	}
	tag, err := pool.Exec(ctx, `
UPDATE "GenerationImage"
SET url = $2, "mediaStorage" = $3, "storageKey" = $4
WHERE id = $1 AND "mediaStorage" IS NULL
`, row.ID, persisted.URL, string(persisted.MediaStorage), nullableStringFromString(persisted.StorageKey))
	if err != nil {
		return false, skipNoS3
	}
	return tag.RowsAffected() == 1, skipNone
}

func backfillVideoRow(ctx context.Context, pool *pgxpool.Pool, storage *Storage, row mediaRow, opts BackfillOptions) (bool, skipKind) {
	if strings.HasPrefix(row.URL, "data:") {
		data, err := decodeVideoDataURL(row.URL)
		if err != nil {
			return false, skipNoData
		}
		return persistAndUpdateVideo(ctx, pool, storage, row, data, opts)
	}
	if opts.IncludeHTTP && isHTTPURL(row.URL) {
		data, err := downloadVideo(ctx, row.URL, newReferenceImageHTTPClient())
		if err != nil {
			return false, skipFetchFailed
		}
		return persistAndUpdateVideo(ctx, pool, storage, row, data, opts)
	}
	return false, skipNoData
}

func persistAndUpdateVideo(
	ctx context.Context,
	pool *pgxpool.Pool,
	storage *Storage,
	row mediaRow,
	data []byte,
	opts BackfillOptions,
) (bool, skipKind) {
	if opts.DryRun {
		return true, skipNone
	}
	persisted, err := storage.PersistVideo(ctx, row.UserID, data)
	if err != nil {
		return false, skipNoS3
	}
	tag, err := pool.Exec(ctx, `
UPDATE "GeneratedVideo"
SET url = $2, "mediaStorage" = $3, "storageKey" = $4
WHERE id = $1 AND "mediaStorage" IS NULL
`, row.ID, persisted.URL, string(persisted.MediaStorage), nullableStringFromString(persisted.StorageKey))
	if err != nil {
		return false, skipNoS3
	}
	return tag.RowsAffected() == 1, skipNone
}

func decodeVideoDataURL(rawURL string) ([]byte, error) {
	header, payload, ok := strings.Cut(rawURL, ",")
	if !ok {
		return nil, errors.New("视频 data URL 格式无效")
	}
	if !strings.Contains(strings.ToLower(header), ";base64") {
		return nil, errors.New("视频 data URL 必须使用 base64 编码")
	}
	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return nil, err
	}
	if len(data) > remoteVideoMaxBytes {
		return nil, errors.New("视频文件过大，无法保存")
	}
	return data, nil
}

func isHTTPURL(rawURL string) bool {
	lower := strings.ToLower(strings.TrimSpace(rawURL))
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://")
}

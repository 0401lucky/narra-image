package worker

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxExpiredJobsPerSweep = 20

type Worker struct {
	cfg     Config
	logger  *slog.Logger
	pool    *pgxpool.Pool
	storage *Storage
}

type GenerationJob struct {
	Count                   int
	GenerationType          string
	ID                      string
	Model                   string
	Moderation              string
	NegativePrompt          sql.NullString
	OutputCompression       sql.NullInt32
	OutputFormat            string
	Prompt                  string
	ProviderAPIKeyEncrypted sql.NullString
	ProviderBaseURL         sql.NullString
	ProviderChannelID       sql.NullString
	ProviderLabel           sql.NullString
	ProviderMode            string
	ProviderModels          []string
	ProviderRemember        bool
	Quality                 string
	Seed                    sql.NullInt32
	Size                    string
	SourceImageURLs         []string
	UserID                  string
}

func New(pool *pgxpool.Pool, cfg Config, logger *slog.Logger) *Worker {
	return &Worker{
		cfg:    cfg,
		logger: logger,
		pool:   pool,
	}
}

func (w *Worker) Run(ctx context.Context) error {
	storage, err := NewStorage(ctx, w.cfg)
	if err != nil {
		return err
	}
	w.storage = storage

	if err := w.waitForSchema(ctx); err != nil {
		return err
	}

	w.logger.Info(
		"Go Worker 已启动",
		"workerId", w.cfg.WorkerID,
		"concurrency", w.cfg.Concurrency,
		"pollInterval", w.cfg.PollInterval,
		"jobTimeout", w.cfg.JobTimeout,
	)

	var waitGroup sync.WaitGroup
	for index := 0; index < w.cfg.Concurrency; index++ {
		waitGroup.Add(1)
		go func(slot int) {
			defer waitGroup.Done()
			w.runLoop(ctx, slot)
		}(index + 1)
	}

	<-ctx.Done()
	waitGroup.Wait()
	return nil
}

func (w *Worker) waitForSchema(ctx context.Context) error {
	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()

	for attempt := 1; ; attempt++ {
		var ready bool
		err := w.pool.QueryRow(ctx, `SELECT to_regclass('"GenerationJob"') IS NOT NULL`).Scan(&ready)
		if err == nil && ready {
			return nil
		}
		if err == nil {
			err = errors.New("GenerationJob 表尚未创建")
		}

		if attempt == 1 || attempt%30 == 0 {
			w.logger.Info("等待数据库 schema 就绪", "attempt", attempt, "error", err)
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (w *Worker) runLoop(ctx context.Context, slot int) {
	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()

	for {
		if ctx.Err() != nil {
			return
		}

		if err := w.failExpiredProcessingJobs(ctx); err != nil {
			w.logger.Warn("清理过期任务失败", "slot", slot, "error", err)
		}

		job, ok, err := w.claimJob(ctx)
		if err != nil {
			w.logger.Error("领取任务失败", "slot", slot, "error", err)
			waitForNextTick(ctx, ticker)
			continue
		}
		if !ok {
			waitForNextTick(ctx, ticker)
			continue
		}

		w.processJob(ctx, job)
	}
}

func waitForNextTick(ctx context.Context, ticker *time.Ticker) {
	select {
	case <-ctx.Done():
	case <-ticker.C:
	}
}

func (w *Worker) claimJob(ctx context.Context) (GenerationJob, bool, error) {
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return GenerationJob{}, false, err
	}
	defer rollbackSilently(ctx, tx)

	now := time.Now().UTC()
	staleBefore := now.Add(-w.cfg.JobTimeout)
	row := tx.QueryRow(ctx, `
WITH next_job AS (
  SELECT id
  FROM "GenerationJob"
  WHERE "workerManaged" = true
    AND (
      status = 'PENDING'
      OR (
        status = 'PROCESSING'
        AND "lockedAt" < $1
        AND "attemptCount" < $2
      )
    )
  ORDER BY "createdAt" ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE "GenerationJob" AS job
SET
  status = 'PROCESSING',
  "workerId" = $3,
  "lockedAt" = $4,
  "startedAt" = COALESCE(job."startedAt", $4),
  "attemptCount" = job."attemptCount" + 1,
  "updatedAt" = $4
FROM next_job
WHERE job.id = next_job.id
RETURNING
  job.id,
  job."userId",
  job.count,
  job."generationType",
  job."providerMode",
  job."providerChannelId",
  job."providerBaseUrl",
  job."providerApiKeyEncrypted",
  job."providerRemember",
  job."providerLabel",
  job."providerModels",
  job.model,
  job.prompt,
  job."negativePrompt",
  job.size,
  job.quality,
  job."outputFormat",
  job."outputCompression",
  job.moderation,
  job.seed,
  job."sourceImageUrls"
`, staleBefore, w.cfg.MaxAttempts, w.cfg.WorkerID, now)

	var job GenerationJob
	err = row.Scan(
		&job.ID,
		&job.UserID,
		&job.Count,
		&job.GenerationType,
		&job.ProviderMode,
		&job.ProviderChannelID,
		&job.ProviderBaseURL,
		&job.ProviderAPIKeyEncrypted,
		&job.ProviderRemember,
		&job.ProviderLabel,
		&job.ProviderModels,
		&job.Model,
		&job.Prompt,
		&job.NegativePrompt,
		&job.Size,
		&job.Quality,
		&job.OutputFormat,
		&job.OutputCompression,
		&job.Moderation,
		&job.Seed,
		&job.SourceImageURLs,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return GenerationJob{}, false, tx.Commit(ctx)
	}
	if err != nil {
		return GenerationJob{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return GenerationJob{}, false, err
	}
	return job, true, nil
}

func (w *Worker) processJob(parent context.Context, job GenerationJob) {
	logger := w.logger.With("jobId", job.ID, "userId", job.UserID)
	logger.Info("开始处理生成任务", "model", job.Model, "type", job.GenerationType)

	ctx, cancel := context.WithTimeout(parent, w.cfg.JobTimeout)
	defer cancel()

	stopHeartbeat := make(chan struct{})
	var heartbeatDone sync.WaitGroup
	heartbeatDone.Add(1)
	go func() {
		defer heartbeatDone.Done()
		w.heartbeat(parent, job.ID, stopHeartbeat)
	}()
	defer func() {
		close(stopHeartbeat)
		heartbeatDone.Wait()
	}()

	provider, err := w.resolveProvider(ctx, job)
	if err != nil {
		logger.Error("渠道解析失败", "error", err)
		_ = w.failJobAndRefund(parent, job.ID, err.Error())
		return
	}

	images, err := generateImages(ctx, w.storage, job, provider)
	if err != nil {
		logger.Error("生成失败", "error", err)
		_ = w.failJobAndRefund(parent, job.ID, err.Error())
		return
	}

	if err := w.completeJob(parent, job, images); err != nil {
		logger.Error("写入生成结果失败", "error", err)
		_ = w.failJobAndRefund(parent, job.ID, err.Error())
		return
	}

	logger.Info("生成任务完成", "images", len(images))
}

func (w *Worker) heartbeat(ctx context.Context, jobID string, stop <-chan struct{}) {
	interval := 30 * time.Second
	if w.cfg.JobTimeout/3 < interval {
		interval = w.cfg.JobTimeout / 3
	}
	if interval < 5*time.Second {
		interval = 5 * time.Second
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-stop:
			return
		case <-ticker.C:
			_, err := w.pool.Exec(ctx, `
UPDATE "GenerationJob"
SET "lockedAt" = $1, "updatedAt" = $1
WHERE id = $2
  AND status = 'PROCESSING'
  AND "workerId" = $3
`, time.Now().UTC(), jobID, w.cfg.WorkerID)
			if err != nil {
				w.logger.Warn("任务心跳更新失败", "jobId", jobID, "error", err)
			}
		}
	}
}

func (w *Worker) resolveProvider(ctx context.Context, job GenerationJob) (ProviderConfig, error) {
	if job.ProviderMode == "CUSTOM" {
		if !job.ProviderBaseURL.Valid || strings.TrimSpace(job.ProviderBaseURL.String) == "" ||
			!job.ProviderAPIKeyEncrypted.Valid || strings.TrimSpace(job.ProviderAPIKeyEncrypted.String) == "" {
			return ProviderConfig{}, errors.New("自填渠道配置不完整")
		}
		apiKey, err := decryptProviderSecret(job.ProviderAPIKeyEncrypted.String, w.cfg.AuthSecret)
		if err != nil {
			return ProviderConfig{}, err
		}
		return ProviderConfig{
			APIKey:  apiKey,
			BaseURL: job.ProviderBaseURL.String,
			Model:   job.Model,
		}, nil
	}

	if job.ProviderChannelID.Valid && job.ProviderChannelID.String != "" {
		if job.ProviderChannelID.String == "__env__" {
			return w.envProvider(job.Model)
		}
		if provider, ok, err := w.channelByID(ctx, job.ProviderChannelID.String, job.Model); err != nil || ok {
			return provider, err
		}
	}

	if provider, ok, err := w.channelByModel(ctx, job.Model); err != nil || ok {
		return provider, err
	}
	if provider, ok, err := w.firstActiveChannel(ctx, job.Model); err != nil || ok {
		return provider, err
	}
	return w.envProvider(job.Model)
}

func (w *Worker) channelByID(ctx context.Context, id string, model string) (ProviderConfig, bool, error) {
	row := w.pool.QueryRow(ctx, `
SELECT "baseUrl", "apiKeyEncrypted", "defaultModel"
FROM "ProviderChannel"
WHERE id = $1 AND "isActive" = true
`, id)
	return w.scanChannel(row, model)
}

func (w *Worker) channelByModel(ctx context.Context, model string) (ProviderConfig, bool, error) {
	row := w.pool.QueryRow(ctx, `
SELECT "baseUrl", "apiKeyEncrypted", "defaultModel"
FROM "ProviderChannel"
WHERE "isActive" = true
  AND ("defaultModel" = $1 OR $1 = ANY(models))
ORDER BY "sortOrder" ASC, "createdAt" ASC
LIMIT 1
`, model)
	return w.scanChannel(row, model)
}

func (w *Worker) firstActiveChannel(ctx context.Context, model string) (ProviderConfig, bool, error) {
	row := w.pool.QueryRow(ctx, `
SELECT "baseUrl", "apiKeyEncrypted", "defaultModel"
FROM "ProviderChannel"
WHERE "isActive" = true
ORDER BY "sortOrder" ASC, "createdAt" ASC
LIMIT 1
`)
	return w.scanChannel(row, model)
}

func (w *Worker) scanChannel(row pgx.Row, requestedModel string) (ProviderConfig, bool, error) {
	var baseURL string
	var encrypted string
	var defaultModel string
	if err := row.Scan(&baseURL, &encrypted, &defaultModel); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ProviderConfig{}, false, nil
		}
		return ProviderConfig{}, false, err
	}

	apiKey, err := decryptProviderSecret(encrypted, w.cfg.AuthSecret)
	if err != nil {
		return ProviderConfig{}, false, err
	}
	model := requestedModel
	if model == "" {
		model = defaultModel
	}
	return ProviderConfig{
		APIKey:  apiKey,
		BaseURL: baseURL,
		Model:   model,
	}, true, nil
}

func (w *Worker) envProvider(model string) (ProviderConfig, error) {
	if strings.TrimSpace(w.cfg.BuiltInProviderAPIKey) == "" || strings.TrimSpace(w.cfg.BuiltInProviderBaseURL) == "" {
		return ProviderConfig{}, errors.New("当前渠道未配置完成")
	}
	if model == "" {
		model = w.cfg.BuiltInProviderModel
	}
	return ProviderConfig{
		APIKey:  w.cfg.BuiltInProviderAPIKey,
		BaseURL: w.cfg.BuiltInProviderBaseURL,
		Model:   model,
	}, nil
}

func (w *Worker) completeJob(ctx context.Context, job GenerationJob, images []GeneratedImage) error {
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer rollbackSilently(ctx, tx)

	now := time.Now().UTC()
	tag, err := tx.Exec(ctx, `
UPDATE "GenerationJob"
SET
  status = 'SUCCEEDED',
  "completedAt" = $1,
  "lockedAt" = NULL,
  "workerId" = NULL,
  "updatedAt" = $1
WHERE id = $2
  AND status = 'PROCESSING'
  AND "workerId" = $3
`, now, job.ID, w.cfg.WorkerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("任务状态已变化，跳过写入")
	}

	for _, image := range images {
		_, err := tx.Exec(ctx, `
INSERT INTO "GenerationImage" (
  id,
  "jobId",
  url,
  width,
  height,
  "showcaseStatus",
  "showPromptPublic",
  "createdAt"
) VALUES ($1, $2, $3, $4, $5, 'PRIVATE', false, $6)
`, cuidLikeID(), job.ID, image.URL, nullableInt(image.Width), nullableInt(image.Height), now)
		if err != nil {
			return err
		}
	}

	if job.ProviderMode == "CUSTOM" && job.ProviderRemember {
		if !job.ProviderBaseURL.Valid || !job.ProviderAPIKeyEncrypted.Valid {
			return errors.New("自填渠道配置不完整")
		}
		_, err := tx.Exec(ctx, `
INSERT INTO "SavedProviderConfig" (
  id,
  "userId",
  label,
  "baseUrl",
  "apiKeyEncrypted",
  model,
  models,
  "createdAt",
  "updatedAt"
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
ON CONFLICT ("userId") DO UPDATE SET
  label = EXCLUDED.label,
  "baseUrl" = EXCLUDED."baseUrl",
  "apiKeyEncrypted" = EXCLUDED."apiKeyEncrypted",
  model = EXCLUDED.model,
  models = EXCLUDED.models,
  "updatedAt" = EXCLUDED."updatedAt"
`, cuidLikeID(), job.UserID, nullableString(job.ProviderLabel), job.ProviderBaseURL.String, job.ProviderAPIKeyEncrypted.String, job.Model, job.ProviderModels, now)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (w *Worker) failJobAndRefund(ctx context.Context, jobID string, message string) error {
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer rollbackSilently(ctx, tx)

	var userID string
	var creditsSpent int
	var status string
	err = tx.QueryRow(ctx, `
SELECT "userId", "creditsSpent", status
FROM "GenerationJob"
WHERE id = $1
FOR UPDATE
`, jobID).Scan(&userID, &creditsSpent, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return tx.Commit(ctx)
	}
	if err != nil {
		return err
	}
	if status == "SUCCEEDED" {
		return tx.Commit(ctx)
	}

	now := time.Now().UTC()
	tag, err := tx.Exec(ctx, `
UPDATE "GenerationJob"
SET
  status = 'FAILED',
  "errorMessage" = $1,
  "creditsSpent" = 0,
  "completedAt" = $2,
  "lockedAt" = NULL,
  "workerId" = NULL,
  "updatedAt" = $2
WHERE id = $3
  AND status <> 'SUCCEEDED'
`, message, now, jobID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 && creditsSpent > 0 {
		if _, err := tx.Exec(ctx, `
UPDATE "User"
SET credits = credits + $1, "updatedAt" = $2
WHERE id = $3
`, creditsSpent, now, userID); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (w *Worker) failExpiredProcessingJobs(ctx context.Context) error {
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer rollbackSilently(ctx, tx)

	staleBefore := time.Now().UTC().Add(-w.cfg.JobTimeout)
	rows, err := tx.Query(ctx, `
SELECT id
FROM "GenerationJob"
WHERE "workerManaged" = true
  AND status = 'PROCESSING'
  AND "lockedAt" < $1
  AND "attemptCount" >= $2
ORDER BY "lockedAt" ASC
FOR UPDATE SKIP LOCKED
LIMIT $3
`, staleBefore, w.cfg.MaxAttempts, maxExpiredJobsPerSweep)
	if err != nil {
		return err
	}
	defer rows.Close()

	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	for _, id := range ids {
		if err := w.failJobAndRefund(ctx, id, "生成任务执行超时，已自动退还预扣积分。"); err != nil {
			return err
		}
	}
	return nil
}

func rollbackSilently(ctx context.Context, tx pgx.Tx) {
	_ = tx.Rollback(ctx)
}

func nullableInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableString(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}

func cuidLikeID() string {
	return "c" + strings.ToLower(randomHex(12))
}

func (w *Worker) String() string {
	return fmt.Sprintf("worker(%s)", w.cfg.WorkerID)
}

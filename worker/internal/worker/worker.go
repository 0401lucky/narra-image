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
	AttemptCount            int
	CancelRequestedAt       sql.NullTime
	Count                   int
	ContractVersion         int
	CreditsSpent            int
	GenerationType          string
	HandoffState            sql.NullString
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
	DurationSeconds         sql.NullInt32
	AspectRatio             sql.NullString
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
		"httpAddr", w.cfg.HTTPAddr,
		"pollInterval", w.cfg.PollInterval,
		"jobTimeout", w.cfg.JobTimeout,
	)

	processingCtx, cancelProcessing := context.WithCancel(context.WithoutCancel(ctx))
	defer cancelProcessing()

	var waitGroup sync.WaitGroup
	if strings.TrimSpace(w.cfg.HTTPAddr) != "" {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			if err := w.runHTTPServer(ctx); err != nil {
				w.logger.Error("Worker HTTP 服务退出", "error", err)
			}
		}()
	}

	for index := 0; index < w.cfg.Concurrency; index++ {
		waitGroup.Add(1)
		go func(slot int) {
			defer waitGroup.Done()
			w.runLoop(ctx, processingCtx, slot)
		}(index + 1)
	}

	<-ctx.Done()
	drained := make(chan struct{})
	go func() {
		waitGroup.Wait()
		close(drained)
	}()

	grace := w.cfg.ShutdownGrace
	if grace <= 0 {
		grace = 30 * time.Second
	}
	timer := time.NewTimer(grace)
	defer timer.Stop()
	select {
	case <-drained:
		w.logger.Info("Worker 已完成优雅停止")
	case <-timer.C:
		w.logger.Warn("Worker 停止宽限期已到，取消在途任务", "grace", grace)
		cancelProcessing()
		<-drained
	}
	return nil
}

func (w *Worker) waitForSchema(ctx context.Context) error {
	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()

	for attempt := 1; ; attempt++ {
		report, err := CheckSchemaContract(ctx, w.pool)
		if err == nil && report.Ready() {
			return nil
		}
		if err == nil {
			err = fmt.Errorf("数据库 schema contract v1 不完整: %+v", report.Issues)
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

func (w *Worker) runLoop(claimCtx context.Context, processingCtx context.Context, slot int) {
	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()

	for {
		if claimCtx.Err() != nil {
			return
		}

		if err := w.failExpiredProcessingJobs(claimCtx); err != nil {
			w.logger.Warn("清理过期任务失败", "slot", slot, "error", err)
		}

		job, ok, err := w.claimJob(claimCtx)
		if err != nil {
			w.logger.Error("领取任务失败", "slot", slot, "error", err)
			waitForNextTick(claimCtx, ticker)
			continue
		}
		if !ok {
			waitForNextTick(claimCtx, ticker)
			continue
		}

		w.processJob(processingCtx, job)
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
	var candidateID string
	var candidateUserID string
	err = tx.QueryRow(ctx, `
SELECT job.id, job."userId"
FROM "GenerationJob" AS job
WHERE job."workerManaged" = true
  AND job.status = 'PENDING'
  AND (job."nextAttemptAt" IS NULL OR job."nextAttemptAt" <= $1)
  AND (job."contractVersion" < 1 OR $2)
  AND (job."contractVersion" < 1 OR job."attemptCount" < $3)
  AND (
    SELECT COUNT(*)
    FROM "GenerationJob" AS active
    WHERE active."workerManaged" = true
      AND active."userId" = job."userId"
      AND active.status = 'PROCESSING'
  ) < $4
  AND NOT EXISTS (
    SELECT 1
    FROM "GenerationJob" AS older
    WHERE older."workerManaged" = true
      AND older.status = 'PENDING'
      AND older."userId" = job."userId"
      AND (older."nextAttemptAt" IS NULL OR older."nextAttemptAt" <= $1)
      AND (older."contractVersion" < 1 OR $2)
      AND (older."contractVersion" < 1 OR older."attemptCount" < $3)
      AND (older."createdAt", older.id) < (job."createdAt", job.id)
  )
ORDER BY job."createdAt" ASC, job.id ASC
FOR UPDATE SKIP LOCKED
LIMIT 1
`, now, w.cfg.ContractsV1Enabled, w.cfg.MaxAttempts, w.cfg.MaxActivePerUser).Scan(
		&candidateID,
		&candidateUserID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return GenerationJob{}, false, tx.Commit(ctx)
	}
	if err != nil {
		return GenerationJob{}, false, err
	}

	// 同一用户的并发额度用事务级 advisory lock 串行复核，避免多个
	// Worker 在彼此未提交时同时越过活动任务上限。
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, candidateUserID); err != nil {
		return GenerationJob{}, false, err
	}

	row := tx.QueryRow(ctx, `
UPDATE "GenerationJob" AS job
SET
  status = 'PROCESSING',
  "workerId" = $1,
  "lockedAt" = $2,
  "startedAt" = COALESCE(job."startedAt", $2),
  "attemptCount" = job."attemptCount" + 1,
  "handoffState" = CASE
    WHEN job."contractVersion" >= 1 THEN 'NOT_STARTED'::"GenerationHandoffState"
    ELSE job."handoffState"
  END,
  "errorCode" = NULL,
  "errorMessage" = NULL,
  "nextAttemptAt" = NULL,
  "updatedAt" = $2
WHERE job.id = $3
  AND job.status = 'PENDING'
  AND (job."nextAttemptAt" IS NULL OR job."nextAttemptAt" <= $2)
  AND (
    SELECT COUNT(*)
    FROM "GenerationJob" AS active
    WHERE active."workerManaged" = true
      AND active."userId" = job."userId"
      AND active.status = 'PROCESSING'
  ) < $4
RETURNING
  job.id,
  job."userId",
  job."attemptCount",
  job."contractVersion",
  job."handoffState",
  job."cancelRequestedAt",
  job."creditsSpent",
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
  job."sourceImageUrls",
  job."durationSeconds",
  job."aspectRatio"
`, w.cfg.WorkerID, now, candidateID, w.cfg.MaxActivePerUser)

	var job GenerationJob
	err = row.Scan(
		&job.ID,
		&job.UserID,
		&job.AttemptCount,
		&job.ContractVersion,
		&job.HandoffState,
		&job.CancelRequestedAt,
		&job.CreditsSpent,
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
		&job.DurationSeconds,
		&job.AspectRatio,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return GenerationJob{}, false, tx.Commit(ctx)
	}
	if err != nil {
		return GenerationJob{}, false, err
	}
	if job.ContractVersion >= 1 {
		operation := generationOperation(job)
		_, err = tx.Exec(ctx, `
INSERT INTO "GenerationAttempt" (
  id,
  "jobId",
  ordinal,
  "workerId",
  operation,
  "providerChannelId",
  model,
  "idempotencyKey",
  status,
  "createdAt",
  "updatedAt"
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'CLAIMED', $9, $9)
`,
			cuidLikeID(),
			job.ID,
			job.AttemptCount,
			w.cfg.WorkerID,
			operation,
			nullableString(job.ProviderChannelID),
			job.Model,
			idempotencyKey(job.ID, operation),
			now,
		)
		if err != nil {
			return GenerationJob{}, false, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return GenerationJob{}, false, err
	}
	return job, true, nil
}

func generationOperation(job GenerationJob) string {
	if job.GenerationType == "TEXT_TO_VIDEO" || job.GenerationType == "IMAGE_TO_VIDEO" {
		return "videos"
	}
	if supportsResponsesImageGeneration(job.Model) {
		return "responses"
	}
	if job.GenerationType == "IMAGE_TO_IMAGE" {
		return "images-edits"
	}
	return "images-generations"
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
		w.heartbeat(ctx, job.ID, stopHeartbeat, cancel)
	}()
	defer func() {
		close(stopHeartbeat)
		heartbeatDone.Wait()
	}()

	cancelled, err := w.finalizeRequestedCancellation(ctx, job)
	if err != nil {
		logger.Error("处理提交前取消失败", "error", err)
		return
	}
	if cancelled {
		logger.Info("任务在提交渠道前已取消")
		return
	}

	provider, err := w.resolveProvider(ctx, job)
	if err != nil {
		logger.Error("渠道解析失败", "error", err)
		if finalizeErr := w.handleJobFailure(parent, job, err); finalizeErr != nil {
			logger.Error("终结渠道解析失败任务失败", "error", finalizeErr)
		}
		return
	}
	if err := w.pinResolvedProvider(ctx, job, provider); err != nil {
		logger.Error("固定渠道快照失败", "error", err)
		if finalizeErr := w.handleJobFailure(parent, job, preHandoffRetryableFailure(err)); finalizeErr != nil {
			logger.Error("终结渠道快照失败任务失败", "error", finalizeErr)
		}
		return
	}
	ctx = w.withJobProviderLifecycle(ctx, job)

	if job.GenerationType == "TEXT_TO_VIDEO" || job.GenerationType == "IMAGE_TO_VIDEO" {
		video, err := generateVideo(ctx, w.storage, job, provider, w.cfg.VideoPollInterval)
		if err != nil {
			logger.Error("视频生成失败", "error", err)
			if finalizeErr := w.handleJobFailure(parent, job, err); finalizeErr != nil {
				logger.Error("终结视频失败任务失败", "error", finalizeErr)
			}
			return
		}
		finalizeCtx, finalizeCancel := detachedFinalizationContext(parent, w.cfg.ShutdownGrace)
		err = w.completeVideoJob(finalizeCtx, job, video)
		finalizeCancel()
		if err != nil {
			logger.Error("写入视频结果失败", "error", err)
			if finalizeErr := w.handleJobFailure(parent, job, wrapResultPersist("写入视频结果", err)); finalizeErr != nil {
				logger.Error("记录视频写回失败状态失败", "error", finalizeErr)
			}
			return
		}
		logger.Info("视频生成任务完成", "url", video.URL)
		return
	}

	images, err := generateImages(ctx, w.storage, job, provider)
	if err != nil {
		logger.Error("生成失败", "error", err)
		if finalizeErr := w.handleJobFailure(parent, job, err); finalizeErr != nil {
			logger.Error("终结图片失败任务失败", "error", finalizeErr)
		}
		return
	}

	finalizeCtx, finalizeCancel := detachedFinalizationContext(parent, w.cfg.ShutdownGrace)
	err = w.completeJob(finalizeCtx, job, images)
	finalizeCancel()
	if err != nil {
		logger.Error("写入生成结果失败", "error", err)
		if finalizeErr := w.handleJobFailure(parent, job, wrapResultPersist("写入图片结果", err)); finalizeErr != nil {
			logger.Error("记录图片写回失败状态失败", "error", finalizeErr)
		}
		return
	}

	logger.Info("生成任务完成", "images", len(images))
}

func (w *Worker) heartbeat(ctx context.Context, jobID string, stop <-chan struct{}, cancel context.CancelFunc) {
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
			tag, err := w.pool.Exec(ctx, `
UPDATE "GenerationJob"
SET "lockedAt" = $1, "updatedAt" = $1
WHERE id = $2
  AND status = 'PROCESSING'
  AND "workerId" = $3
`, time.Now().UTC(), jobID, w.cfg.WorkerID)
			if err != nil {
				w.logger.Warn("任务心跳更新失败", "jobId", jobID, "error", err)
				continue
			}
			if tag.RowsAffected() == 0 {
				w.logger.Warn("任务租约已丢失，取消当前请求", "jobId", jobID)
				cancel()
				return
			}
		}
	}
}

func (w *Worker) resolveProvider(ctx context.Context, job GenerationJob) (ProviderConfig, error) {
	if job.ProviderMode == "CUSTOM" {
		if !job.ProviderBaseURL.Valid || strings.TrimSpace(job.ProviderBaseURL.String) == "" ||
			!job.ProviderAPIKeyEncrypted.Valid || strings.TrimSpace(job.ProviderAPIKeyEncrypted.String) == "" {
			return ProviderConfig{}, ContractFailure{
				Code:    errorProviderNotConfigured,
				Message: "自填渠道配置不完整",
			}
		}
		if job.ContractVersion >= 1 && len(job.ProviderModels) > 0 && !modelInSnapshot(job.Model, job.ProviderModels) {
			return ProviderConfig{}, ContractFailure{
				Code:    errorModelNotSupported,
				Message: "自填渠道不支持请求模型",
			}
		}
		apiKey, err := decryptProviderSecret(job.ProviderAPIKeyEncrypted.String, w.cfg.AuthSecret)
		if err != nil {
			return ProviderConfig{}, ContractFailure{
				Code:    errorChannelSecretDecryptFailed,
				Message: "自填渠道密钥无法读取",
			}
		}
		return ProviderConfig{
			APIKey:              apiKey,
			BaseURL:             job.ProviderBaseURL.String,
			Model:               job.Model,
			Models:              append([]string(nil), job.ProviderModels...),
			AllowPrivateNetwork: false,
		}, nil
	}

	if job.ProviderChannelID.Valid && job.ProviderChannelID.String != "" {
		if job.ProviderChannelID.String == "__env__" {
			return w.envProvider(job.Model)
		}
		provider, ok, err := w.channelByID(ctx, job.ProviderChannelID.String, job.Model)
		if err != nil {
			return ProviderConfig{}, err
		}
		if !ok {
			return ProviderConfig{}, ContractFailure{
				Code:    errorChannelNotFound,
				Message: "所选渠道不存在",
			}
		}
		return provider, nil
	}

	if job.ContractVersion >= 1 {
		return ProviderConfig{}, ContractFailure{
			Code:    errorProviderNotConfigured,
			Message: "contract v1 任务缺少固定渠道",
		}
	}
	if provider, ok, err := w.channelByModel(ctx, job.Model); err != nil || ok {
		return provider, err
	}
	return w.envProvider(job.Model)
}

func (w *Worker) channelByID(ctx context.Context, id string, model string) (ProviderConfig, bool, error) {
	row := w.pool.QueryRow(ctx, `
SELECT id, "baseUrl", "apiKeyEncrypted", "defaultModel", models, "isActive"
FROM "ProviderChannel"
WHERE id = $1
`, id)
	return w.scanChannel(row, model)
}

func (w *Worker) channelByModel(ctx context.Context, model string) (ProviderConfig, bool, error) {
	row := w.pool.QueryRow(ctx, `
SELECT id, "baseUrl", "apiKeyEncrypted", "defaultModel", models, "isActive"
FROM "ProviderChannel"
WHERE "isActive" = true
  AND ("defaultModel" = $1 OR $1 = ANY(models))
ORDER BY "sortOrder" ASC, "createdAt" ASC, id ASC
LIMIT 1
`, model)
	return w.scanChannel(row, model)
}

func (w *Worker) scanChannel(row pgx.Row, requestedModel string) (ProviderConfig, bool, error) {
	var id string
	var baseURL string
	var encrypted string
	var defaultModel string
	var models []string
	var active bool
	if err := row.Scan(&id, &baseURL, &encrypted, &defaultModel, &models, &active); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ProviderConfig{}, false, nil
		}
		return ProviderConfig{}, false, preHandoffRetryableFailure(err)
	}
	if !active {
		return ProviderConfig{}, false, ContractFailure{
			Code:    errorChannelInactive,
			Message: "所选渠道已停用",
		}
	}
	if !providerSupportsModel(defaultModel, requestedModel, models) {
		return ProviderConfig{}, false, ContractFailure{
			Code:    errorModelNotSupported,
			Message: "所选渠道不支持请求模型",
		}
	}

	apiKey, err := decryptProviderSecret(encrypted, w.cfg.AuthSecret)
	if err != nil {
		return ProviderConfig{}, false, ContractFailure{
			Code:    errorChannelSecretDecryptFailed,
			Message: "渠道密钥无法读取",
		}
	}
	model := requestedModel
	if model == "" {
		model = defaultModel
	}
	return ProviderConfig{
		APIKey:              apiKey,
		BaseURL:             baseURL,
		ChannelID:           id,
		Model:               model,
		Models:              normalizedProviderModels(defaultModel, models),
		AllowPrivateNetwork: true,
	}, true, nil
}

func (w *Worker) envProvider(model string) (ProviderConfig, error) {
	if strings.TrimSpace(w.cfg.BuiltInProviderAPIKey) == "" || strings.TrimSpace(w.cfg.BuiltInProviderBaseURL) == "" {
		return ProviderConfig{}, ContractFailure{
			Code:    errorProviderNotConfigured,
			Message: "当前渠道未配置完成",
		}
	}
	if model == "" {
		model = w.cfg.BuiltInProviderModel
	}
	if !providerSupportsModel(w.cfg.BuiltInProviderModel, model, nil) {
		return ProviderConfig{}, ContractFailure{
			Code:    errorModelNotSupported,
			Message: "环境渠道不支持请求模型",
		}
	}
	return ProviderConfig{
		APIKey:              w.cfg.BuiltInProviderAPIKey,
		BaseURL:             w.cfg.BuiltInProviderBaseURL,
		ChannelID:           "__env__",
		Model:               model,
		Models:              []string{w.cfg.BuiltInProviderModel},
		AllowPrivateNetwork: true,
	}, nil
}

func providerSupportsModel(defaultModel string, requestedModel string, models []string) bool {
	requestedModel = strings.TrimSpace(requestedModel)
	if requestedModel == "" {
		return false
	}
	return modelInSnapshot(requestedModel, normalizedProviderModels(defaultModel, models))
}

func modelInSnapshot(model string, models []string) bool {
	model = strings.TrimSpace(model)
	for _, candidate := range models {
		if model == strings.TrimSpace(candidate) {
			return true
		}
	}
	return false
}

func normalizedProviderModels(defaultModel string, models []string) []string {
	result := make([]string, 0, len(models)+1)
	seen := map[string]struct{}{}
	for _, candidate := range append([]string{defaultModel}, models...) {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if _, exists := seen[candidate]; exists {
			continue
		}
		seen[candidate] = struct{}{}
		result = append(result, candidate)
	}
	return result
}

func (w *Worker) pinResolvedProvider(
	ctx context.Context,
	job GenerationJob,
	provider ProviderConfig,
) error {
	if job.ProviderMode == "CUSTOM" || job.ProviderChannelID.Valid || strings.TrimSpace(provider.ChannelID) == "" {
		return nil
	}
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer rollbackSilently(ctx, tx)

	now := time.Now().UTC()
	tag, err := tx.Exec(ctx, `
UPDATE "GenerationJob"
SET
  "providerChannelId" = $1,
  "providerModels" = $2,
  "updatedAt" = $3
WHERE id = $4
  AND status = 'PROCESSING'
  AND "workerId" = $5
  AND "attemptCount" = $6
  AND "providerChannelId" IS NULL
`, provider.ChannelID, provider.Models, now, job.ID, w.cfg.WorkerID, job.AttemptCount)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("任务渠道已被其他执行者修改")
	}
	if job.ContractVersion >= 1 {
		tag, err = tx.Exec(ctx, `
UPDATE "GenerationAttempt"
SET
  "providerChannelId" = $1,
  "updatedAt" = $2
WHERE "jobId" = $3
  AND ordinal = $4
  AND "workerId" = $5
  AND status = 'CLAIMED'
`, provider.ChannelID, now, job.ID, job.AttemptCount, w.cfg.WorkerID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return errors.New("attempt 渠道快照已被其他执行者修改")
		}
	}
	return tx.Commit(ctx)
}

func (w *Worker) completeJob(ctx context.Context, job GenerationJob, images []GeneratedImage) error {
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer rollbackSilently(ctx, tx)

	now := time.Now().UTC()
	if err := w.lockCompletionTarget(ctx, tx, job); err != nil {
		return err
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

	if err := w.finishCompletion(ctx, tx, job, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (w *Worker) completeVideoJob(ctx context.Context, job GenerationJob, video VideoResult) error {
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer rollbackSilently(ctx, tx)

	now := time.Now().UTC()
	if err := w.lockCompletionTarget(ctx, tx, job); err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
INSERT INTO "GeneratedVideo" (
  id,
  "jobId",
  url,
  "posterUrl",
  width,
  height,
  "durationSeconds",
  "showcaseStatus",
  "showPromptPublic",
  "createdAt"
) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PRIVATE', false, $8)
`, cuidLikeID(), job.ID, video.URL, nullableVideoString(video.PosterURL), nullableInt(video.Width), nullableInt(video.Height), nullableInt(video.DurationSeconds), now)
	if err != nil {
		return err
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

	if err := w.finishCompletion(ctx, tx, job, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (w *Worker) lockCompletionTarget(ctx context.Context, tx pgx.Tx, job GenerationJob) error {
	query := `
SELECT 1
FROM "GenerationJob"
WHERE id = $1
  AND status = 'PROCESSING'
  AND "workerId" = $2
FOR UPDATE
`
	args := []any{job.ID, w.cfg.WorkerID}
	if job.ContractVersion >= 1 {
		query = `
SELECT 1
FROM "GenerationJob" AS job
WHERE job.id = $1
  AND job.status = 'PROCESSING'
  AND job."workerId" = $2
  AND job."attemptCount" = $3
  AND job."contractVersion" >= 1
  AND job."handoffState" = 'SUBMITTED'
  AND EXISTS (
    SELECT 1
    FROM "GenerationAttempt" AS attempt
    WHERE attempt."jobId" = job.id
      AND attempt.ordinal = job."attemptCount"
      AND attempt."workerId" = job."workerId"
      AND attempt.status = 'SUBMITTED'
  )
FOR UPDATE
`
		args = append(args, job.AttemptCount)
	}

	var marker int
	if err := tx.QueryRow(ctx, query, args...).Scan(&marker); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ResultPersistError{Cause: errors.New("任务租约、attempt ordinal 或 handoff 状态已变化")}
		}
		return err
	}
	return nil
}

func (w *Worker) finishCompletion(ctx context.Context, tx pgx.Tx, job GenerationJob, now time.Time) error {
	if job.ContractVersion >= 1 {
		tag, err := tx.Exec(ctx, `
UPDATE "GenerationAttempt"
SET
  status = 'SUCCEEDED',
  "completedAt" = $1,
  "updatedAt" = $1
WHERE "jobId" = $2
  AND ordinal = $3
  AND "workerId" = $4
  AND status = 'SUBMITTED'
`, now, job.ID, job.AttemptCount, w.cfg.WorkerID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return ResultPersistError{Cause: errors.New("attempt 成功状态已变化")}
		}

		tag, err = tx.Exec(ctx, `
UPDATE "GenerationJob"
SET
  status = 'SUCCEEDED',
  "errorCode" = NULL,
  "errorMessage" = NULL,
  "handoffState" = 'RESOLVED',
  "completedAt" = $1,
  "nextAttemptAt" = NULL,
  "lockedAt" = NULL,
  "workerId" = NULL,
  "updatedAt" = $1
WHERE id = $2
  AND status = 'PROCESSING'
  AND "workerId" = $3
  AND "attemptCount" = $4
  AND "contractVersion" >= 1
  AND "handoffState" = 'SUBMITTED'
`, now, job.ID, w.cfg.WorkerID, job.AttemptCount)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return ResultPersistError{Cause: errors.New("任务成功状态已变化")}
		}
		return nil
	}

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
	if tag.RowsAffected() != 1 {
		return errors.New("任务状态已变化，跳过写入")
	}
	return nil
}

func nullableVideoString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func (w *Worker) failExpiredProcessingJobs(ctx context.Context) error {
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer rollbackSilently(ctx, tx)

	staleBefore := time.Now().UTC().Add(-w.cfg.JobTimeout)
	rows, err := tx.Query(ctx, `
SELECT id, "contractVersion"
FROM "GenerationJob"
WHERE "workerManaged" = true
  AND status = 'PROCESSING'
  AND "lockedAt" < $1
ORDER BY "lockedAt" ASC
FOR UPDATE SKIP LOCKED
LIMIT $2
`, staleBefore, maxExpiredJobsPerSweep)
	if err != nil {
		return err
	}
	defer rows.Close()

	type expiredJob struct {
		contractVersion int
		id              string
	}
	jobs := []expiredJob{}
	for rows.Next() {
		var job expiredJob
		if err := rows.Scan(&job.id, &job.contractVersion); err != nil {
			return err
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	for _, job := range jobs {
		if job.contractVersion >= 1 {
			if err := w.finalizeExpiredV1Job(ctx, job.id, staleBefore); err != nil {
				return err
			}
			continue
		}
		if err := w.failExpiredJobAndRefund(ctx, job.id, staleBefore, "生成任务执行超时，已自动退还预扣积分。"); err != nil {
			return err
		}
	}
	return nil
}

func (w *Worker) failExpiredJobAndRefund(ctx context.Context, jobID string, staleBefore time.Time, message string) error {
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer rollbackSilently(ctx, tx)

	var userID string
	var creditsSpent int
	err = tx.QueryRow(ctx, `
SELECT "userId", "creditsSpent"
FROM "GenerationJob"
WHERE id = $1
  AND "workerManaged" = true
  AND status = 'PROCESSING'
  AND "lockedAt" < $2
FOR UPDATE
`, jobID, staleBefore).Scan(&userID, &creditsSpent)
	if errors.Is(err, pgx.ErrNoRows) {
		return tx.Commit(ctx)
	}
	if err != nil {
		return err
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
  AND status = 'PROCESSING'
  AND "lockedAt" < $4
`, message, now, jobID, staleBefore)
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

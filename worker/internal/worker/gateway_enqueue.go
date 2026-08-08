package worker

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

var (
	errGatewayJobConflict = errors.New("网关任务归属冲突")
	errGatewayJobNotFound = errors.New("生成任务不存在")
)

// gatewayJob 是网关路径读回的轻量任务视图（不携带 Worker 执行所需的全部字段）。
type gatewayJob struct {
	ID              string
	APIKeyID        string
	UserID          string
	Status          string
	ContractVersion int
	HandoffState    sql.NullString
	ErrorCode       sql.NullString
	ErrorMessage    sql.NullString
	CreditsSpent    int
	Count           int
	Model           string
	CreatedAt       time.Time
}

// ensureGatewayJob 以 envelope.jobId 为幂等键创建或复用 GenerationJob。
// Next 已预扣积分并完成渠道/媒体校验，这里只落库并开放 Worker 领取，
// 不重复扣分、不重复上传参考图。
func (w *Worker) ensureGatewayJob(ctx context.Context, env gatewayEnvelope) (gatewayJob, error) {
	writeFields := sharedContractWriteFields(w.cfg.ContractsV1Enabled)
	now := time.Now().UTC()
	handoff := sql.NullString{}
	if writeFields.HandoffState != nil {
		handoff = sql.NullString{String: *writeFields.HandoffState, Valid: true}
	}
	negativePrompt := sql.NullString{}
	if env.Payload.NegativePrompt != nil {
		negativePrompt = sql.NullString{String: *env.Payload.NegativePrompt, Valid: true}
	}
	outputCompression := nullableInt(env.Payload.OutputCompression)
	seed := nullableInt(env.Payload.Seed)

	_, err := w.pool.Exec(ctx, `
INSERT INTO "GenerationJob" (
  id, "userId", "apiKeyId", "workerManaged", "clientSource",
  "generationType", "providerMode", "providerChannelId", "providerModels",
  model, prompt, "negativePrompt", size, quality, "outputFormat",
  "outputCompression", moderation, seed, "sourceImageUrls", count, status,
  "contractVersion", "handoffState", "creditsSpent", "createdAt", "updatedAt"
) VALUES (
  $1, $2, $3, true, 'API',
  $4, $5, $6, $7,
  $8, $9, $10, $11, $12, $13,
  $14, $15, $16, $17, $18, 'PENDING',
  $19, $20, $21, $22, $22
)
ON CONFLICT (id) DO NOTHING
`,
		env.JobID,
		env.Auth.UserID,
		env.Auth.APIKeyID,
		env.Payload.GenerationType,
		env.Provider.ProviderMode,
		env.Provider.ChannelID,
		env.Provider.ChannelModels,
		env.Payload.Model,
		env.Payload.Prompt,
		negativePrompt,
		env.Payload.Size,
		env.Payload.Quality,
		env.Payload.OutputFormat,
		outputCompression,
		env.Payload.Moderation,
		seed,
		env.SourceImageURLs,
		env.Payload.Count,
		writeFields.ContractVersion,
		handoff,
		env.Billing.CreditsSpent,
		now,
	)
	if err != nil {
		return gatewayJob{}, err
	}

	return w.readGatewayJob(ctx, env.JobID, env.Auth.APIKeyID)
}

// readGatewayJob 读回 job 并校验 apiKeyId 归属，防止跨 API Key 复用 jobId。
func (w *Worker) readGatewayJob(ctx context.Context, jobID string, apiKeyID string) (gatewayJob, error) {
	var job gatewayJob
	err := w.pool.QueryRow(ctx, `
SELECT
  id, "userId", "apiKeyId", status, "contractVersion", "handoffState",
  "errorCode", "errorMessage", "creditsSpent", count, model, "createdAt"
FROM "GenerationJob"
WHERE id = $1
`, jobID).Scan(
		&job.ID,
		&job.UserID,
		&job.APIKeyID,
		&job.Status,
		&job.ContractVersion,
		&job.HandoffState,
		&job.ErrorCode,
		&job.ErrorMessage,
		&job.CreditsSpent,
		&job.Count,
		&job.Model,
		&job.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return gatewayJob{}, fmt.Errorf("生成任务不存在: %s", jobID)
		}
		return gatewayJob{}, err
	}
	if job.APIKeyID != apiKeyID {
		return gatewayJob{}, errGatewayJobConflict
	}
	return job, nil
}

// queryGatewayJob 供 generations 查询端点使用：按 apiKeyId + clientSource=API 校验归属。
func (w *Worker) queryGatewayJob(ctx context.Context, jobID string, apiKeyID string) (gatewayJob, error) {
	var job gatewayJob
	err := w.pool.QueryRow(ctx, `
SELECT
  job.id, job."userId", job."apiKeyId", job.status, job."contractVersion",
  job."handoffState", job."errorCode", job."errorMessage", job."creditsSpent",
  job.count, job.model, job."createdAt"
FROM "GenerationJob" AS job
WHERE job.id = $1
  AND job."clientSource" = 'API'
`, jobID).Scan(
		&job.ID,
		&job.UserID,
		&job.APIKeyID,
		&job.Status,
		&job.ContractVersion,
		&job.HandoffState,
		&job.ErrorCode,
		&job.ErrorMessage,
		&job.CreditsSpent,
		&job.Count,
		&job.Model,
		&job.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return gatewayJob{}, errGatewayJobNotFound
		}
		return gatewayJob{}, err
	}
	if job.APIKeyID != apiKeyID {
		return gatewayJob{}, errGatewayJobNotFound
	}
	return job, nil
}

func sharedContractWriteFields(enabled bool) ContractWriteFields {
	contract, err := sharedContract()
	if err != nil {
		// 契约不可用时回退 legacy 写入字段，与 Worker 主路径行为一致。
		if enabled {
			return ContractWriteFields{ContractVersion: 1}
		}
		return ContractWriteFields{ContractVersion: 0}
	}
	return contract.WriteFields(enabled)
}

package worker

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
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
	// A completed/replayed job keeps its frozen inputs. Do not revalidate the
	// new envelope's source URLs or register aliases for an existing job.
	if existing, err := w.readGatewayJob(ctx, env.JobID, env.Auth.APIKeyID); err == nil {
		return existing, nil
	} else if !errors.Is(err, errGatewayJobNotFound) {
		return gatewayJob{}, err
	}
	repository := NewImageRepository(w.pool)
	var reservation ImageReservation
	committed := false
	if w.cfg.ImageStorageManagedEnabled {
		var err error
		budget, budgetErr := ImageOutputBudget(env.Payload.Count)
		if budgetErr != nil {
			return gatewayJob{}, budgetErr
		}
		reservation, err = reserveImageWithCleanup(ctx, repository, env.Auth.UserID, "output:"+env.JobID, budget,
			func(reserveCtx context.Context) (ImageReservation, error) {
				return repository.ReserveOutputs(reserveCtx, ImageReserveOutputsInput{OwnerID: env.Auth.UserID, IntentKey: "output:" + env.JobID, Count: env.Payload.Count})
			})
		if err != nil {
			if existing, readErr := w.readGatewayJob(ctx, env.JobID, env.Auth.APIKeyID); readErr == nil {
				return existing, nil
			}
			return gatewayJob{}, err
		}
		defer func() {
			if !committed {
				finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
				defer cancel()
				_, _ = repository.CloseReservation(finishCtx, ImageCloseReservationInput{ReservationID: reservation.ID, Token: reservation.Token})
			}
		}()
	}
	// Reference protection is independent of the new-output write flag. The
	// epoch precedes both alias locks and business rows, including empty-input
	// jobs, whose database trigger also acquires the same reference epoch.
	transaction, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return gatewayJob{}, err
	}
	defer rollbackSilently(ctx, transaction)
	if err := lockImageReferenceEpoch(ctx, transaction); err != nil {
		return gatewayJob{}, err
	}
	// Another request may have committed this job while the first lookup was
	// waiting for the epoch. Replay that row before validating new inputs.
	if existing, err := readGatewayJobFrom(ctx, transaction, env.JobID, env.Auth.APIKeyID); err == nil {
		return existing, nil
	} else if !errors.Is(err, errGatewayJobNotFound) {
		return gatewayJob{}, err
	}
	if err := registerGatewayManagedInputAliases(ctx, NewImageRepository(transaction), w.cfg.AppURL, env.SourceImageURLs); err != nil {
		return gatewayJob{}, err
	}
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

	_, err = transaction.Exec(ctx, `
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
	var apiKeyID string
	if err := transaction.QueryRow(ctx, `SELECT "apiKeyId" FROM "GenerationJob" WHERE id=$1`, env.JobID).Scan(&apiKeyID); err != nil {
		return gatewayJob{}, err
	}
	if apiKeyID != env.Auth.APIKeyID {
		return gatewayJob{}, errGatewayJobConflict
	}
	if w.cfg.ImageStorageManagedEnabled {
		if _, err := NewImageRepository(transaction).BindReservation(ctx, ImageBindReservationInput{
			ReservationID: reservation.ID, Token: reservation.Token, OwnerID: env.Auth.UserID, JobID: env.JobID,
		}); err != nil {
			return gatewayJob{}, err
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		return gatewayJob{}, err
	}
	committed = true

	return w.readGatewayJob(ctx, env.JobID, env.Auth.APIKeyID)
}

// readGatewayJob 读回 job 并校验 apiKeyId 归属，防止跨 API Key 复用 jobId。
func (w *Worker) readGatewayJob(ctx context.Context, jobID string, apiKeyID string) (gatewayJob, error) {
	return readGatewayJobFrom(ctx, w.pool, jobID, apiKeyID)
}

func readGatewayJobFrom(ctx context.Context, queryer ImageQueryer, jobID string, apiKeyID string) (gatewayJob, error) {
	var job gatewayJob
	err := queryer.QueryRow(ctx, `
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
			return gatewayJob{}, errGatewayJobNotFound
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

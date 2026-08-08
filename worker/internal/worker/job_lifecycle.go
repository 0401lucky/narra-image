package worker

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type lockedJobLifecycle struct {
	attemptCount      int
	cancelRequestedAt sql.NullTime
	contractVersion   int
	creditsSpent      int
	handoffState      sql.NullString
	refundAppliedAt   sql.NullTime
	userID            string
}

func (w *Worker) withJobProviderLifecycle(ctx context.Context, job GenerationJob) context.Context {
	if job.ContractVersion < 1 {
		return ctx
	}
	return withProviderLifecycle(
		ctx,
		func(markCtx context.Context) error {
			return w.markJobSubmitting(markCtx, job)
		},
		func(markCtx context.Context, requestID string) error {
			return w.markJobSubmitted(markCtx, job, requestID)
		},
		func(markCtx context.Context, requestID string) error {
			return w.recordJobProviderRequestID(markCtx, job, requestID)
		},
	)
}

func (w *Worker) markJobSubmitting(ctx context.Context, job GenerationJob) error {
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return preHandoffRetryableFailure(err)
	}
	defer rollbackSilently(ctx, tx)

	now := time.Now().UTC()
	tag, err := tx.Exec(ctx, `
UPDATE "GenerationJob"
SET
  "handoffState" = 'SUBMITTING',
  "updatedAt" = $1
WHERE id = $2
  AND status = 'PROCESSING'
  AND "workerId" = $3
  AND "attemptCount" = $4
  AND "contractVersion" >= 1
  AND "handoffState" = 'NOT_STARTED'
  AND "cancelRequestedAt" IS NULL
`, now, job.ID, w.cfg.WorkerID, job.AttemptCount)
	if err != nil {
		return preHandoffRetryableFailure(err)
	}
	if tag.RowsAffected() == 0 {
		var cancelRequested bool
		var handoffState sql.NullString
		err := tx.QueryRow(ctx, `
SELECT "cancelRequestedAt" IS NOT NULL, "handoffState"
FROM "GenerationJob"
WHERE id = $1
  AND status = 'PROCESSING'
  AND "workerId" = $2
  AND "attemptCount" = $3
FOR UPDATE
`, job.ID, w.cfg.WorkerID, job.AttemptCount).Scan(&cancelRequested, &handoffState)
		if err == nil && cancelRequested && handoffState.Valid && handoffState.String == "NOT_STARTED" {
			return ContractFailure{
				Code:    errorGenerationCancelled,
				Message: "生成任务已取消",
			}
		}
		return ContractFailure{
			Code:      errorLeaseLostBeforeHandoff,
			Message:   "任务租约已转移，未向渠道提交",
			Retryable: true,
		}
	}

	tag, err = tx.Exec(ctx, `
UPDATE "GenerationAttempt"
SET
  status = 'SUBMITTING',
  "updatedAt" = $1
WHERE "jobId" = $2
  AND ordinal = $3
  AND "workerId" = $4
  AND status = 'CLAIMED'
`, now, job.ID, job.AttemptCount, w.cfg.WorkerID)
	if err != nil {
		return preHandoffRetryableFailure(err)
	}
	if tag.RowsAffected() != 1 {
		return preHandoffRetryableFailure(errors.New("attempt 状态已变化，拒绝向渠道提交"))
	}
	if err := tx.Commit(ctx); err != nil {
		return preHandoffRetryableFailure(err)
	}
	w.logger.Info(
		"任务即将提交渠道",
		"event", "provider_submitting",
		"job_id", job.ID,
		"attempt_ordinal", job.AttemptCount,
	)
	return nil
}

func (w *Worker) markJobSubmitted(
	ctx context.Context,
	job GenerationJob,
	requestID string,
) error {
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ResultPersistError{Cause: err}
	}
	defer rollbackSilently(ctx, tx)

	now := time.Now().UTC()
	tag, err := tx.Exec(ctx, `
UPDATE "GenerationJob"
SET
  "handoffState" = 'SUBMITTED',
  "updatedAt" = $1
WHERE id = $2
  AND status = 'PROCESSING'
  AND "workerId" = $3
  AND "attemptCount" = $4
  AND "contractVersion" >= 1
  AND "handoffState" = 'SUBMITTING'
`, now, job.ID, w.cfg.WorkerID, job.AttemptCount)
	if err != nil {
		return ResultPersistError{Cause: err}
	}
	if tag.RowsAffected() != 1 {
		return ResultPersistError{Cause: errors.New("任务租约或 handoff 状态已变化")}
	}

	tag, err = tx.Exec(ctx, `
UPDATE "GenerationAttempt"
SET
  status = 'SUBMITTED',
  "providerRequestId" = COALESCE(NULLIF($1, ''), "providerRequestId"),
  "upstreamSubmittedAt" = COALESCE("upstreamSubmittedAt", $2),
  "updatedAt" = $2
WHERE "jobId" = $3
  AND ordinal = $4
  AND "workerId" = $5
  AND status = 'SUBMITTING'
`, strings.TrimSpace(requestID), now, job.ID, job.AttemptCount, w.cfg.WorkerID)
	if err != nil {
		return ResultPersistError{Cause: err}
	}
	if tag.RowsAffected() != 1 {
		return ResultPersistError{Cause: errors.New("attempt 提交状态已变化")}
	}
	if err := tx.Commit(ctx); err != nil {
		return ResultPersistError{Cause: err}
	}
	w.logger.Info(
		"任务已提交渠道",
		"event", "provider_submitted",
		"job_id", job.ID,
		"attempt_ordinal", job.AttemptCount,
		"provider_request_id", strings.TrimSpace(requestID),
	)
	return nil
}

func (w *Worker) recordJobProviderRequestID(
	ctx context.Context,
	job GenerationJob,
	requestID string,
) error {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" || job.ContractVersion < 1 {
		return nil
	}
	tag, err := w.pool.Exec(ctx, `
UPDATE "GenerationAttempt"
SET
  "providerRequestId" = $1,
  "updatedAt" = $2
WHERE "jobId" = $3
  AND ordinal = $4
  AND "workerId" = $5
  AND status IN ('SUBMITTED', 'SUBMITTING')
`, requestID, time.Now().UTC(), job.ID, job.AttemptCount, w.cfg.WorkerID)
	if err != nil {
		return ResultPersistError{Cause: err}
	}
	if tag.RowsAffected() != 1 {
		return ResultPersistError{Cause: errors.New("无法保存渠道 request ID")}
	}
	w.logger.Info(
		"已记录渠道请求标识",
		"event", "provider_request_id_recorded",
		"job_id", job.ID,
		"attempt_ordinal", job.AttemptCount,
		"provider_request_id", requestID,
	)
	return nil
}

func (w *Worker) finalizeRequestedCancellation(
	ctx context.Context,
	job GenerationJob,
) (bool, error) {
	if job.ContractVersion < 1 {
		return false, nil
	}
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, err
	}
	defer rollbackSilently(ctx, tx)

	locked, err := w.lockCurrentJob(ctx, tx, job)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, tx.Commit(ctx)
	}
	if err != nil {
		return false, err
	}
	if !locked.cancelRequestedAt.Valid || !locked.handoffState.Valid || locked.handoffState.String != "NOT_STARTED" {
		return false, tx.Commit(ctx)
	}
	failure := ContractFailure{
		Code:    errorGenerationCancelled,
		Message: "生成任务已取消",
	}
	if err := w.finalizeKnownFailureLocked(ctx, tx, job, locked, failure); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}

func (w *Worker) handleJobFailure(parent context.Context, job GenerationJob, cause error) error {
	finalizeCtx, cancel := detachedFinalizationContext(parent, w.cfg.ShutdownGrace)
	defer cancel()

	failure := w.classifyJobFailure(finalizeCtx, job, cause)
	if job.ContractVersion < 1 {
		return w.finalizeKnownFailure(finalizeCtx, job, failure)
	}
	if failure.Code == errorGenerationCancelled {
		return w.finalizeKnownFailure(finalizeCtx, job, failure)
	}
	if failure.Retryable {
		if job.AttemptCount < w.cfg.MaxAttempts {
			return w.scheduleRetry(finalizeCtx, job, failure)
		}
		failure = ContractFailure{
			Code:    errorMaxAttemptsExhausted,
			Message: "渠道多次尝试后仍不可用",
		}
	}
	if failure.HandoffUnknown {
		return w.finalizeUnknown(finalizeCtx, job, failure)
	}
	return w.finalizeKnownFailure(finalizeCtx, job, failure)
}

func (w *Worker) classifyJobFailure(
	ctx context.Context,
	job GenerationJob,
	cause error,
) ContractFailure {
	failure := classifyProviderFailure(cause)
	if job.ContractVersion < 1 || !failure.HandoffUnknown {
		return failure
	}

	if !errors.Is(cause, context.Canceled) && !errors.Is(cause, context.DeadlineExceeded) {
		return failure
	}
	var handoffState sql.NullString
	var cancelRequested bool
	err := w.pool.QueryRow(ctx, `
SELECT "handoffState", "cancelRequestedAt" IS NOT NULL
FROM "GenerationJob"
WHERE id = $1
  AND status = 'PROCESSING'
  AND "workerId" = $2
  AND "attemptCount" = $3
`, job.ID, w.cfg.WorkerID, job.AttemptCount).Scan(&handoffState, &cancelRequested)
	if err != nil || !handoffState.Valid || handoffState.String != "NOT_STARTED" {
		return failure
	}
	if cancelRequested {
		return ContractFailure{Code: errorGenerationCancelled, Message: "生成任务已取消"}
	}
	return ContractFailure{
		Code:      errorLeaseLostBeforeHandoff,
		Message:   "任务在提交渠道前停止，系统将安全重试",
		Retryable: true,
	}
}

func (w *Worker) scheduleRetry(
	ctx context.Context,
	job GenerationJob,
	failure ContractFailure,
) error {
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer rollbackSilently(ctx, tx)

	locked, err := w.lockCurrentJob(ctx, tx, job)
	if errors.Is(err, pgx.ErrNoRows) {
		return tx.Commit(ctx)
	}
	if err != nil {
		return err
	}
	if locked.contractVersion < 1 || locked.attemptCount >= w.cfg.MaxAttempts {
		if err := w.finalizeKnownFailureLocked(ctx, tx, job, locked, ContractFailure{
			Code:    errorMaxAttemptsExhausted,
			Message: "渠道多次尝试后仍不可用",
		}); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if !locked.handoffState.Valid || (locked.handoffState.String != "NOT_STARTED" && locked.handoffState.String != "SUBMITTING") {
		if err := w.finalizeUnknownLocked(ctx, tx, job, locked, ContractFailure{
			Code:           errorHandoffUnknown,
			Message:        failure.Message,
			HandoffUnknown: true,
		}); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}

	now := time.Now().UTC()
	nextAttemptAt := now.Add(retryDelay(w.cfg.RetryBaseDelay, job.AttemptCount))
	message := truncateGenerationErrorMessage(failure.Error())
	tag, err := tx.Exec(ctx, `
UPDATE "GenerationAttempt"
SET
  status = 'FAILED_RETRYABLE',
  "errorCode" = $1,
  "errorMessage" = $2,
  "nextRetryAt" = $3,
  "completedAt" = $4,
  "updatedAt" = $4
WHERE "jobId" = $5
  AND ordinal = $6
  AND "workerId" = $7
  AND status IN ('CLAIMED', 'SUBMITTING')
`, failure.Code, message, nextAttemptAt, now, job.ID, job.AttemptCount, w.cfg.WorkerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("attempt 状态已变化，拒绝安排重试")
	}

	tag, err = tx.Exec(ctx, `
UPDATE "GenerationJob"
SET
  status = 'PENDING',
  "errorCode" = $1,
  "errorMessage" = $2,
  "nextAttemptAt" = $3,
  "handoffState" = 'RESOLVED',
  "lockedAt" = NULL,
  "workerId" = NULL,
  "completedAt" = NULL,
  "updatedAt" = $4
WHERE id = $5
  AND status = 'PROCESSING'
  AND "workerId" = $6
  AND "attemptCount" = $7
`, failure.Code, message, nextAttemptAt, now, job.ID, w.cfg.WorkerID, job.AttemptCount)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("任务租约已变化，拒绝安排重试")
	}
	return tx.Commit(ctx)
}

func (w *Worker) finalizeKnownFailure(
	ctx context.Context,
	job GenerationJob,
	failure ContractFailure,
) error {
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer rollbackSilently(ctx, tx)

	locked, err := w.lockCurrentJob(ctx, tx, job)
	if errors.Is(err, pgx.ErrNoRows) {
		return tx.Commit(ctx)
	}
	if err != nil {
		return err
	}
	if err := w.finalizeKnownFailureLocked(ctx, tx, job, locked, failure); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (w *Worker) finalizeKnownFailureLocked(
	ctx context.Context,
	tx pgx.Tx,
	job GenerationJob,
	locked lockedJobLifecycle,
	failure ContractFailure,
) error {
	if locked.contractVersion >= 1 {
		if !locked.handoffState.Valid ||
			locked.handoffState.String == "UNKNOWN" ||
			(locked.handoffState.String == "SUBMITTED" && !failure.ResolvedAfterSubmit) {
			return w.finalizeUnknownLocked(ctx, tx, job, locked, ContractFailure{
				Code:           errorHandoffUnknown,
				Message:        failure.Message,
				HandoffUnknown: true,
			})
		}
	}

	now := time.Now().UTC()
	message := truncateGenerationErrorMessage(failure.Error())
	refund := locked.creditsSpent > 0 && !locked.refundAppliedAt.Valid
	if locked.contractVersion >= 1 {
		tag, err := tx.Exec(ctx, `
UPDATE "GenerationAttempt"
SET
  status = 'FAILED_FINAL',
  "errorCode" = $1,
  "errorMessage" = $2,
  "completedAt" = $3,
  "updatedAt" = $3
WHERE "jobId" = $4
  AND ordinal = $5
  AND "workerId" = $6
  AND status IN ('CLAIMED', 'SUBMITTING', 'SUBMITTED')
`, failure.Code, message, now, job.ID, job.AttemptCount, w.cfg.WorkerID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return errors.New("attempt 状态已变化，拒绝终结任务")
		}
	}

	newHandoffState := nullableString(locked.handoffState)
	if locked.contractVersion >= 1 {
		newHandoffState = "RESOLVED"
	}
	tag, err := tx.Exec(ctx, `
UPDATE "GenerationJob"
SET
  status = 'FAILED',
  "errorCode" = $1,
  "errorMessage" = $2,
  "creditsSpent" = CASE WHEN $3 THEN 0 ELSE "creditsSpent" END,
  "refundAppliedAt" = CASE WHEN $3 THEN $4 ELSE "refundAppliedAt" END,
  "handoffState" = $5,
  "completedAt" = $4,
  "nextAttemptAt" = NULL,
  "lockedAt" = NULL,
  "workerId" = NULL,
  "updatedAt" = $4
WHERE id = $6
  AND status = 'PROCESSING'
  AND "workerId" = $7
  AND "attemptCount" = $8
`, failure.Code, message, refund, now, newHandoffState, job.ID, w.cfg.WorkerID, job.AttemptCount)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("任务租约已变化，拒绝终结任务")
	}
	if refund {
		if _, err := tx.Exec(ctx, `
UPDATE "User"
SET credits = credits + $1, "updatedAt" = $2
WHERE id = $3
`, locked.creditsSpent, now, locked.userID); err != nil {
			return err
		}
	}
	return nil
}

func (w *Worker) finalizeUnknown(
	ctx context.Context,
	job GenerationJob,
	failure ContractFailure,
) error {
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer rollbackSilently(ctx, tx)

	locked, err := w.lockCurrentJob(ctx, tx, job)
	if errors.Is(err, pgx.ErrNoRows) {
		return tx.Commit(ctx)
	}
	if err != nil {
		return err
	}
	if err := w.finalizeUnknownLocked(ctx, tx, job, locked, failure); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (w *Worker) finalizeUnknownLocked(
	ctx context.Context,
	tx pgx.Tx,
	job GenerationJob,
	locked lockedJobLifecycle,
	failure ContractFailure,
) error {
	if locked.contractVersion < 1 {
		return w.finalizeKnownFailureLocked(ctx, tx, job, locked, failure)
	}
	now := time.Now().UTC()
	code := failure.Code
	if code == "" {
		code = errorHandoffUnknown
	}
	message := truncateGenerationErrorMessage(failure.Error())
	tag, err := tx.Exec(ctx, `
UPDATE "GenerationAttempt"
SET
  status = 'UNKNOWN',
  "errorCode" = $1,
  "errorMessage" = $2,
  "completedAt" = $3,
  "updatedAt" = $3
WHERE "jobId" = $4
  AND ordinal = $5
  AND "workerId" = $6
  AND status IN ('CLAIMED', 'SUBMITTING', 'SUBMITTED', 'UNKNOWN')
`, code, message, now, job.ID, job.AttemptCount, w.cfg.WorkerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("attempt 状态已变化，拒绝写入 UNKNOWN")
	}

	tag, err = tx.Exec(ctx, `
UPDATE "GenerationJob"
SET
  status = 'FAILED',
  "errorCode" = $1,
  "errorMessage" = $2,
  "handoffState" = 'UNKNOWN',
  "completedAt" = $3,
  "nextAttemptAt" = NULL,
  "lockedAt" = NULL,
  "workerId" = NULL,
  "updatedAt" = $3
WHERE id = $4
  AND status = 'PROCESSING'
  AND "workerId" = $5
  AND "attemptCount" = $6
`, code, message, now, job.ID, w.cfg.WorkerID, job.AttemptCount)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("任务租约已变化，拒绝写入 UNKNOWN")
	}
	return nil
}

func (w *Worker) finalizeExpiredV1Job(
	ctx context.Context,
	jobID string,
	staleBefore time.Time,
) error {
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer rollbackSilently(ctx, tx)

	var locked lockedJobLifecycle
	var workerID sql.NullString
	err = tx.QueryRow(ctx, `
SELECT
  "userId",
  "creditsSpent",
  "contractVersion",
  "attemptCount",
  "handoffState",
  "cancelRequestedAt",
  "refundAppliedAt",
  "workerId"
FROM "GenerationJob"
WHERE id = $1
  AND "workerManaged" = true
  AND status = 'PROCESSING'
  AND "contractVersion" >= 1
  AND "lockedAt" < $2
FOR UPDATE
`, jobID, staleBefore).Scan(
		&locked.userID,
		&locked.creditsSpent,
		&locked.contractVersion,
		&locked.attemptCount,
		&locked.handoffState,
		&locked.cancelRequestedAt,
		&locked.refundAppliedAt,
		&workerID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return tx.Commit(ctx)
	}
	if err != nil {
		return err
	}
	if !workerID.Valid || strings.TrimSpace(workerID.String) == "" {
		return errors.New("过期 contract v1 任务缺少 workerId")
	}

	now := time.Now().UTC()
	if locked.handoffState.Valid && locked.handoffState.String == "NOT_STARTED" {
		if !locked.cancelRequestedAt.Valid && locked.attemptCount < w.cfg.MaxAttempts {
			nextAttemptAt := now.Add(retryDelay(w.cfg.RetryBaseDelay, locked.attemptCount))
			message := "任务租约在提交渠道前过期，系统将安全重试"
			tag, err := tx.Exec(ctx, `
UPDATE "GenerationAttempt"
SET
  status = 'FAILED_RETRYABLE',
  "errorCode" = $1,
  "errorMessage" = $2,
  "nextRetryAt" = $3,
  "completedAt" = $4,
  "updatedAt" = $4
WHERE "jobId" = $5
  AND ordinal = $6
  AND "workerId" = $7
  AND status = 'CLAIMED'
`, errorLeaseLostBeforeHandoff, message, nextAttemptAt, now, jobID, locked.attemptCount, workerID.String)
			if err != nil {
				return err
			}
			if tag.RowsAffected() != 1 {
				return errors.New("过期 attempt 状态已变化，拒绝安排重试")
			}

			tag, err = tx.Exec(ctx, `
UPDATE "GenerationJob"
SET
  status = 'PENDING',
  "errorCode" = $1,
  "errorMessage" = $2,
  "nextAttemptAt" = $3,
  "handoffState" = 'RESOLVED',
  "lockedAt" = NULL,
  "workerId" = NULL,
  "completedAt" = NULL,
  "updatedAt" = $4
WHERE id = $5
  AND status = 'PROCESSING'
  AND "workerId" = $6
  AND "attemptCount" = $7
  AND "handoffState" = 'NOT_STARTED'
  AND "lockedAt" < $8
`, errorLeaseLostBeforeHandoff, message, nextAttemptAt, now, jobID, workerID.String, locked.attemptCount, staleBefore)
			if err != nil {
				return err
			}
			if tag.RowsAffected() != 1 {
				return errors.New("过期任务租约已变化，拒绝安排重试")
			}
			return tx.Commit(ctx)
		}

		code := errorMaxAttemptsExhausted
		message := "渠道多次尝试后仍不可用"
		if locked.cancelRequestedAt.Valid {
			code = errorGenerationCancelled
			message = "生成任务已取消"
		}
		refund := locked.creditsSpent > 0 && !locked.refundAppliedAt.Valid
		tag, err := tx.Exec(ctx, `
UPDATE "GenerationAttempt"
SET
  status = 'FAILED_FINAL',
  "errorCode" = $1,
  "errorMessage" = $2,
  "completedAt" = $3,
  "updatedAt" = $3
WHERE "jobId" = $4
  AND ordinal = $5
  AND "workerId" = $6
  AND status = 'CLAIMED'
`, code, message, now, jobID, locked.attemptCount, workerID.String)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return errors.New("过期 attempt 状态已变化，拒绝终结任务")
		}

		tag, err = tx.Exec(ctx, `
UPDATE "GenerationJob"
SET
  status = 'FAILED',
  "errorCode" = $1,
  "errorMessage" = $2,
  "creditsSpent" = CASE WHEN $3 THEN 0 ELSE "creditsSpent" END,
  "refundAppliedAt" = CASE WHEN $3 THEN $4 ELSE "refundAppliedAt" END,
  "handoffState" = 'RESOLVED',
  "completedAt" = $4,
  "nextAttemptAt" = NULL,
  "lockedAt" = NULL,
  "workerId" = NULL,
  "updatedAt" = $4
WHERE id = $5
  AND status = 'PROCESSING'
  AND "workerId" = $6
  AND "attemptCount" = $7
  AND "handoffState" = 'NOT_STARTED'
  AND "lockedAt" < $8
`, code, message, refund, now, jobID, workerID.String, locked.attemptCount, staleBefore)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return errors.New("过期任务租约已变化，拒绝终结任务")
		}
		if refund {
			if _, err := tx.Exec(ctx, `
UPDATE "User"
SET credits = credits + $1, "updatedAt" = $2
WHERE id = $3
`, locked.creditsSpent, now, locked.userID); err != nil {
				return err
			}
		}
		return tx.Commit(ctx)
	}

	message := "任务租约在渠道提交边界过期，提交结果暂不确定"
	tag, err := tx.Exec(ctx, `
UPDATE "GenerationAttempt"
SET
  status = 'UNKNOWN',
  "errorCode" = $1,
  "errorMessage" = $2,
  "completedAt" = $3,
  "updatedAt" = $3
WHERE "jobId" = $4
  AND ordinal = $5
  AND "workerId" = $6
  AND status IN ('SUBMITTING', 'SUBMITTED', 'UNKNOWN')
`, errorHandoffUnknown, message, now, jobID, locked.attemptCount, workerID.String)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("过期 attempt 状态已变化，拒绝写入 UNKNOWN")
	}

	tag, err = tx.Exec(ctx, `
UPDATE "GenerationJob"
SET
  status = 'FAILED',
  "errorCode" = $1,
  "errorMessage" = $2,
  "handoffState" = 'UNKNOWN',
  "completedAt" = $3,
  "nextAttemptAt" = NULL,
  "lockedAt" = NULL,
  "workerId" = NULL,
  "updatedAt" = $3
WHERE id = $4
  AND status = 'PROCESSING'
  AND "workerId" = $5
  AND "attemptCount" = $6
  AND "lockedAt" < $7
`, errorHandoffUnknown, message, now, jobID, workerID.String, locked.attemptCount, staleBefore)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("过期任务租约已变化，拒绝写入 UNKNOWN")
	}
	return tx.Commit(ctx)
}

func (w *Worker) lockCurrentJob(
	ctx context.Context,
	tx pgx.Tx,
	job GenerationJob,
) (lockedJobLifecycle, error) {
	var locked lockedJobLifecycle
	err := tx.QueryRow(ctx, `
SELECT
  "userId",
  "creditsSpent",
  "contractVersion",
  "attemptCount",
  "handoffState",
  "cancelRequestedAt",
  "refundAppliedAt"
FROM "GenerationJob"
WHERE id = $1
  AND status = 'PROCESSING'
  AND "workerId" = $2
  AND "attemptCount" = $3
FOR UPDATE
`, job.ID, w.cfg.WorkerID, job.AttemptCount).Scan(
		&locked.userID,
		&locked.creditsSpent,
		&locked.contractVersion,
		&locked.attemptCount,
		&locked.handoffState,
		&locked.cancelRequestedAt,
		&locked.refundAppliedAt,
	)
	return locked, err
}

func lifecycleError(code string, message string) error {
	return ContractFailure{Code: code, Message: message}
}

func wrapResultPersist(operation string, err error) error {
	if err == nil {
		return nil
	}
	return ResultPersistError{Cause: fmt.Errorf("%s: %w", operation, err)}
}

func preHandoffRetryableFailure(err error) error {
	message := "提交渠道前的任务状态更新失败"
	if err != nil && strings.TrimSpace(err.Error()) != "" {
		message += "：" + err.Error()
	}
	return ContractFailure{
		Code:      errorLeaseLostBeforeHandoff,
		Message:   message,
		Retryable: true,
	}
}

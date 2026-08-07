//go:build workercontractsdb

package worker

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestWorkerContractsDB(t *testing.T) {
	if os.Getenv("WORKER_CONTRACTS_REQUIRE_DB") != "1" {
		t.Fatal("缺少 WORKER_CONTRACTS_REQUIRE_DB=1，拒绝运行数据库契约测试")
	}
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("缺少 TEST_DATABASE_URL，拒绝回退到开发数据库")
	}
	databaseURL = normalizeDatabaseURL(databaseURL)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("创建数据库连接池失败: %v", err)
	}
	defer pool.Close()

	report, err := CheckSchemaContract(ctx, pool)
	if err != nil {
		t.Fatalf("schema probe 失败: %v", err)
	}
	if !report.Ready() {
		t.Fatalf("schema probe 未就绪: %+v", report.Issues)
	}

	w := New(pool, Config{
		ContractsV1Enabled: true,
		MaxActivePerUser:   1,
		MaxAttempts:        2,
		RetryBaseDelay:     time.Millisecond,
		WorkerID:           "db-worker-a",
	}, nil)
	reset := func() {
		t.Helper()
		if _, err := pool.Exec(ctx, `DELETE FROM "User"`); err != nil {
			t.Fatalf("清理数据库 fixture 失败: %v", err)
		}
	}
	insertUser := func(id string) {
		t.Helper()
		_, err := pool.Exec(ctx, `
INSERT INTO "User" (id, email, credits, "updatedAt")
VALUES ($1, $2, 100, CURRENT_TIMESTAMP)
`, id, id+"@example.test")
		if err != nil {
			t.Fatalf("插入用户 fixture 失败: %v", err)
		}
	}
	insertJob := func(id, userID string, credits int) {
		t.Helper()
		_, err := pool.Exec(ctx, `
INSERT INTO "GenerationJob" (
  id, "userId", "workerManaged", "contractVersion", "handoffState",
  "providerMode", model, prompt, size, count, "creditsSpent", "updatedAt"
) VALUES ($1, $2, true, 1, 'NOT_STARTED', 'BUILT_IN', 'gpt-image-2', 'db prompt', '1024x1024', 1, $3, CURRENT_TIMESTAMP)
`, id, userID, credits)
		if err != nil {
			t.Fatalf("插入任务 fixture 失败: %v", err)
		}
	}

	t.Run("claim and successful image writeback uses ordinal and lease", func(t *testing.T) {
		reset()
		insertUser("db_success_user")
		insertJob("db_success_job", "db_success_user", 5)

		job, claimed, err := w.claimJob(ctx)
		if err != nil || !claimed {
			t.Fatalf("claimJob failed: claimed=%v err=%v", claimed, err)
		}
		if job.AttemptCount != 1 {
			t.Fatalf("expected first attempt ordinal 1, got %d", job.AttemptCount)
		}
		var operation, key, status string
		if err := pool.QueryRow(ctx, `
SELECT operation, "idempotencyKey", status::text
FROM "GenerationAttempt" WHERE "jobId" = $1 AND ordinal = 1
`, job.ID).Scan(&operation, &key, &status); err != nil {
			t.Fatalf("读取 attempt 失败: %v", err)
		}
		if operation != "images-generations" || key != "narra-image:db_success_job:images-generations" || status != "CLAIMED" {
			t.Fatalf("unexpected attempt ledger: operation=%q key=%q status=%q", operation, key, status)
		}
		if err := w.markJobSubmitting(ctx, job); err != nil {
			t.Fatalf("markJobSubmitting failed: %v", err)
		}
		if err := w.markJobSubmitted(ctx, job, "provider-request-1"); err != nil {
			t.Fatalf("markJobSubmitted failed: %v", err)
		}
		if err := w.completeJob(ctx, job, []GeneratedImage{{URL: "https://cdn.example.test/image.png"}}); err != nil {
			t.Fatalf("completeJob failed: %v", err)
		}

		var jobStatus, handoff, attemptStatus string
		var workerID *string
		if err := pool.QueryRow(ctx, `
SELECT status::text, "handoffState"::text, "workerId"
FROM "GenerationJob" WHERE id = $1
`, job.ID).Scan(&jobStatus, &handoff, &workerID); err != nil {
			t.Fatalf("读取成功任务失败: %v", err)
		}
		if jobStatus != "SUCCEEDED" || handoff != "RESOLVED" || workerID != nil {
			t.Fatalf("unexpected successful job: status=%q handoff=%q worker=%v", jobStatus, handoff, workerID)
		}
		if err := pool.QueryRow(ctx, `
SELECT status::text FROM "GenerationAttempt" WHERE "jobId" = $1 AND ordinal = 1
`, job.ID).Scan(&attemptStatus); err != nil {
			t.Fatalf("读取成功 attempt 失败: %v", err)
		}
		if attemptStatus != "SUCCEEDED" {
			t.Fatalf("expected attempt SUCCEEDED, got %q", attemptStatus)
		}
	})

	t.Run("stale ordinal cannot write media", func(t *testing.T) {
		reset()
		insertUser("db_ordinal_user")
		insertJob("db_ordinal_job", "db_ordinal_user", 5)
		job, claimed, err := w.claimJob(ctx)
		if err != nil || !claimed {
			t.Fatalf("claimJob failed: claimed=%v err=%v", claimed, err)
		}
		if err := w.markJobSubmitting(ctx, job); err != nil {
			t.Fatal(err)
		}
		if err := w.markJobSubmitted(ctx, job, "provider-request-ordinal"); err != nil {
			t.Fatal(err)
		}
		staleJob := job
		staleJob.AttemptCount++
		if err := w.completeJob(ctx, staleJob, []GeneratedImage{{URL: "https://cdn.example.test/stale.png"}}); err == nil {
			t.Fatal("stale attempt ordinal unexpectedly wrote result")
		}
		var imageCount int
		if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM "GenerationImage" WHERE "jobId" = $1`, job.ID).Scan(&imageCount); err != nil {
			t.Fatal(err)
		}
		if imageCount != 0 {
			t.Fatalf("stale write inserted %d images", imageCount)
		}
	})

	t.Run("pre-handoff lease expiry schedules bounded retry", func(t *testing.T) {
		reset()
		insertUser("db_retry_user")
		insertJob("db_retry_job", "db_retry_user", 5)
		job, claimed, err := w.claimJob(ctx)
		if err != nil || !claimed {
			t.Fatalf("claimJob failed: claimed=%v err=%v", claimed, err)
		}
		staleBefore := time.Now().UTC().Add(time.Second)
		if _, err := pool.Exec(ctx, `UPDATE "GenerationJob" SET "lockedAt" = $1 WHERE id = $2`, time.Now().UTC().Add(-time.Hour), job.ID); err != nil {
			t.Fatal(err)
		}
		if err := w.finalizeExpiredV1Job(ctx, job.ID, staleBefore); err != nil {
			t.Fatalf("finalizeExpiredV1Job retry failed: %v", err)
		}
		var status string
		var nextAttemptAt *time.Time
		var credits int
		if err := pool.QueryRow(ctx, `SELECT status::text, "nextAttemptAt", "creditsSpent" FROM "GenerationJob" WHERE id = $1`, job.ID).Scan(&status, &nextAttemptAt, &credits); err != nil {
			t.Fatal(err)
		}
		if status != "PENDING" || nextAttemptAt == nil || credits != 5 {
			t.Fatalf("unexpected retry state: status=%q next=%v credits=%d", status, nextAttemptAt, credits)
		}
	})

	t.Run("post-handoff lease expiry enters unknown without refund", func(t *testing.T) {
		reset()
		insertUser("db_unknown_user")
		insertJob("db_unknown_job", "db_unknown_user", 7)
		job, claimed, err := w.claimJob(ctx)
		if err != nil || !claimed {
			t.Fatalf("claimJob failed: claimed=%v err=%v", claimed, err)
		}
		if err := w.markJobSubmitting(ctx, job); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `UPDATE "GenerationJob" SET "lockedAt" = $1 WHERE id = $2`, time.Now().UTC().Add(-time.Hour), job.ID); err != nil {
			t.Fatal(err)
		}
		if err := w.finalizeExpiredV1Job(ctx, job.ID, time.Now().UTC()); err != nil {
			t.Fatalf("finalizeExpiredV1Job unknown failed: %v", err)
		}
		var status, handoff, errorCode string
		var credits int
		var refundAppliedAt *time.Time
		if err := pool.QueryRow(ctx, `
SELECT status::text, "handoffState"::text, "errorCode", "creditsSpent", "refundAppliedAt"
FROM "GenerationJob" WHERE id = $1
`, job.ID).Scan(&status, &handoff, &errorCode, &credits, &refundAppliedAt); err != nil {
			t.Fatal(err)
		}
		if status != "FAILED" || handoff != "UNKNOWN" || errorCode != errorHandoffUnknown || credits != 7 || refundAppliedAt != nil {
			t.Fatalf("unexpected unknown state: status=%q handoff=%q code=%q credits=%d refund=%v", status, handoff, errorCode, credits, refundAppliedAt)
		}
	})

	t.Run("retry exhaustion refunds exactly once", func(t *testing.T) {
		reset()
		insertUser("db_refund_user")
		insertJob("db_refund_job", "db_refund_user", 9)
		job, claimed, err := w.claimJob(ctx)
		if err != nil || !claimed {
			t.Fatalf("claimJob failed: claimed=%v err=%v", claimed, err)
		}
		oldMaxAttempts := w.cfg.MaxAttempts
		w.cfg.MaxAttempts = 1
		defer func() { w.cfg.MaxAttempts = oldMaxAttempts }()
		if _, err := pool.Exec(ctx, `UPDATE "GenerationJob" SET "lockedAt" = $1 WHERE id = $2`, time.Now().UTC().Add(-time.Hour), job.ID); err != nil {
			t.Fatal(err)
		}
		if err := w.finalizeExpiredV1Job(ctx, job.ID, time.Now().UTC()); err != nil {
			t.Fatalf("finalizeExpiredV1Job refund failed: %v", err)
		}
		var credits, spent int
		if err := pool.QueryRow(ctx, `SELECT credits FROM "User" WHERE id = $1`, "db_refund_user").Scan(&credits); err != nil {
			t.Fatal(err)
		}
		if err := pool.QueryRow(ctx, `SELECT "creditsSpent" FROM "GenerationJob" WHERE id = $1`, job.ID).Scan(&spent); err != nil {
			t.Fatal(err)
		}
		if credits != 109 || spent != 0 {
			t.Fatalf("expected one refund, got user credits=%d spent=%d", credits, spent)
		}
		if err := w.finalizeExpiredV1Job(ctx, job.ID, time.Now().UTC()); err != nil {
			t.Fatalf("repeated finalizer failed: %v", err)
		}
		if err := pool.QueryRow(ctx, `SELECT credits FROM "User" WHERE id = $1`, "db_refund_user").Scan(&credits); err != nil {
			t.Fatal(err)
		}
		if credits != 109 {
			t.Fatalf("repeated finalizer changed credits to %d", credits)
		}
	})
}

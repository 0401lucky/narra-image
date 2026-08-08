//go:build workercontractsdb

package worker

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"strings"
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
	t.Run("topology locks allow dedicated replicas and reject embedded", func(t *testing.T) {
		dedicatedA := New(pool, Config{
			DatabaseURL:  databaseURL,
			PollInterval: time.Millisecond,
			RuntimeMode:  RuntimeModeDedicated,
			WorkerID:     "topology-dedicated-a",
		}, nil)
		lockA, err := dedicatedA.acquireTopologyLock(ctx)
		if err != nil {
			t.Fatalf("first dedicated lock failed: %v", err)
		}
		defer func() {
			if lockA != nil {
				_ = lockA.release(context.Background())
			}
		}()

		dedicatedB := New(pool, Config{
			DatabaseURL:  databaseURL,
			PollInterval: time.Millisecond,
			RuntimeMode:  RuntimeModeDedicated,
			WorkerID:     "topology-dedicated-b",
		}, nil)
		lockB, err := dedicatedB.acquireTopologyLock(ctx)
		if err != nil {
			t.Fatalf("second dedicated lock failed: %v", err)
		}
		defer func() {
			if lockB != nil {
				_ = lockB.release(context.Background())
			}
		}()

		embedded := New(pool, Config{
			DatabaseURL:  databaseURL,
			PollInterval: time.Millisecond,
			RuntimeMode:  RuntimeModeEmbedded,
			WorkerID:     "topology-embedded",
		}, nil)
		if _, err := embedded.acquireTopologyLock(ctx); !errors.Is(err, ErrTopologyConflict) {
			t.Fatalf("expected embedded conflict while dedicated locks are held, got %v", err)
		}

		if err := lockB.release(context.Background()); err != nil {
			t.Fatalf("release second dedicated lock: %v", err)
		}
		lockB = nil
		if err := lockA.release(context.Background()); err != nil {
			t.Fatalf("release first dedicated lock: %v", err)
		}
		lockA = nil

		embeddedLock, err := embedded.acquireTopologyLock(ctx)
		if err != nil {
			t.Fatalf("embedded lock after dedicated release failed: %v", err)
		}
		defer func() { _ = embeddedLock.release(context.Background()) }()

		secondEmbedded := New(pool, Config{
			DatabaseURL:  databaseURL,
			PollInterval: time.Millisecond,
			RuntimeMode:  RuntimeModeEmbedded,
			WorkerID:     "topology-embedded-b",
		}, nil)
		if _, err := secondEmbedded.acquireTopologyLock(ctx); !errors.Is(err, ErrTopologyConflict) {
			t.Fatalf("expected second embedded conflict, got %v", err)
		}

		dedicatedDuringEmbedded := New(pool, Config{
			DatabaseURL:  databaseURL,
			PollInterval: time.Millisecond,
			RuntimeMode:  RuntimeModeDedicated,
			WorkerID:     "topology-dedicated-c",
		}, nil)
		if _, err := dedicatedDuringEmbedded.acquireTopologyLock(ctx); !errors.Is(err, ErrTopologyConflict) {
			t.Fatalf("expected dedicated conflict while embedded lock is held, got %v", err)
		}
	})
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

	t.Run("media storage metadata columns and kinds", func(t *testing.T) {
		reset()
		insertUser("db_media_user")
		insertJob("db_media_job", "db_media_user", 5)

		for _, tc := range []struct {
			kind string
			key  string
		}{
			{kind: "S3", key: "user/abc.png"},
			{kind: "B64", key: ""},
			{kind: "UPSTREAM", key: ""},
		} {
			_, err := pool.Exec(ctx, `
INSERT INTO "GenerationImage" (id, "jobId", url, "mediaStorage", "storageKey", "showcaseStatus", "showPromptPublic", "createdAt")
VALUES ($1, $2, $3, $4, $5, 'PRIVATE', false, CURRENT_TIMESTAMP)
`, "img_media_"+tc.kind, "db_media_job", "https://cdn.example/"+tc.kind, tc.kind, nullableStringFromString(tc.key))
			if err != nil {
				t.Fatalf("insert media image %s failed: %v", tc.kind, err)
			}
		}
		// legacy 行：旧写入者不传新字段，mediaStorage/storageKey 保持 NULL。
		if _, err := pool.Exec(ctx, `
INSERT INTO "GenerationImage" (id, "jobId", url, "showcaseStatus", "showPromptPublic", "createdAt")
VALUES ('img_media_legacy', 'db_media_job', 'https://cdn.example/legacy', 'PRIVATE', false, CURRENT_TIMESTAMP)
`); err != nil {
			t.Fatalf("insert legacy media row failed: %v", err)
		}

		var withStorage int
		if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM "GenerationImage" WHERE "jobId" = $1 AND "mediaStorage" IS NOT NULL`, "db_media_job").Scan(&withStorage); err != nil {
			t.Fatal(err)
		}
		if withStorage != 3 {
			t.Fatalf("expected 3 rows with mediaStorage, got %d", withStorage)
		}
		var legacyStorage *string
		if err := pool.QueryRow(ctx, `SELECT "mediaStorage" FROM "GenerationImage" WHERE id = 'img_media_legacy'`).Scan(&legacyStorage); err != nil {
			t.Fatal(err)
		}
		if legacyStorage != nil {
			t.Fatalf("legacy row must keep NULL mediaStorage, got %v", legacyStorage)
		}
	})

	t.Run("backfill media is idempotent", func(t *testing.T) {
		reset()
		insertUser("db_backfill_user")
		insertJob("db_backfill_job", "db_backfill_user", 5)

		pngData := minimalPNG(8, 8)
		dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(pngData)
		if _, err := pool.Exec(ctx, `
INSERT INTO "GenerationImage" (id, "jobId", url, "showcaseStatus", "showPromptPublic", "createdAt")
VALUES ('img_backfill_1', 'db_backfill_job', $1, 'PRIVATE', false, CURRENT_TIMESTAMP)
`, dataURL); err != nil {
			t.Fatalf("insert backfill image failed: %v", err)
		}

		storage := &Storage{client: &fakeObjectStorage{}, cfg: Config{
			S3Bucket:        "backfill-bucket",
			S3PublicBaseURL: "https://cdn.example.test",
		}}
		result, err := BackfillMedia(ctx, pool, storage, BackfillOptions{})
		if err != nil {
			t.Fatalf("BackfillMedia returned error: %v", err)
		}
		if result.ImagesScanned != 1 || result.ImagesUpdated != 1 {
			t.Fatalf("unexpected first backfill result: %+v", result)
		}

		var url, mediaStorage, storageKey string
		if err := pool.QueryRow(ctx, `SELECT url, "mediaStorage", COALESCE("storageKey", '') FROM "GenerationImage" WHERE id = 'img_backfill_1'`).Scan(&url, &mediaStorage, &storageKey); err != nil {
			t.Fatal(err)
		}
		if mediaStorage != "S3" || !strings.HasPrefix(url, "https://cdn.example.test/") || storageKey == "" {
			t.Fatalf("unexpected backfilled row: url=%s storage=%s key=%s", url, mediaStorage, storageKey)
		}

		// 重复执行：已处理行 mediaStorage != NULL，不会重复转存。
		result2, err := BackfillMedia(ctx, pool, storage, BackfillOptions{})
		if err != nil {
			t.Fatalf("second BackfillMedia returned error: %v", err)
		}
		if result2.ImagesScanned != 0 || result2.ImagesUpdated != 0 {
			t.Fatalf("expected no reprocess on second run, got %+v", result2)
		}
	})

	insertPromptSource := func(id, slug, parser string, enabled bool) {
		t.Helper()
		_, err := pool.Exec(ctx, `
INSERT INTO "PromptSource" (id, slug, name, description, "sourceUrl", "rawBaseUrl", parser, "isEnabled", "sortOrder", status, "itemCount", "updatedAt")
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 10, 'IDLE', 0, CURRENT_TIMESTAMP)
`, id, slug, slug, "fixture description", "https://github.com/"+slug, "https://raw.githubusercontent.com/"+slug+"/main", parser, enabled)
		if err != nil {
			t.Fatalf("insert prompt source failed: %v", err)
		}
	}

	t.Run("prompt sync advisory lock and idempotency", func(t *testing.T) {
		reset()
		insertPromptSource("src_sync_a", "sync-a", "awesome-gpt-image", true)

		syncer := NewPromptSyncer(pool, nil)
		syncer.fetch = func(ctx context.Context, source PromptSource, filePath string) (string, error) {
			return markdownFixture, nil
		}
		result, err := syncer.SyncSource(ctx, "sync-a")
		if err != nil {
			t.Fatalf("SyncSource returned error: %v", err)
		}
		if result.Status != "SUCCESS" || result.Count != 1 {
			t.Fatalf("unexpected sync result: %+v", result)
		}

		var status, lastSyncError *string
		var itemCount int
		if err := pool.QueryRow(ctx, `SELECT status::text, "lastSyncError", "itemCount" FROM "PromptSource" WHERE id = 'src_sync_a'`).Scan(&status, &lastSyncError, &itemCount); err != nil {
			t.Fatal(err)
		}
		if *status != "SUCCESS" || lastSyncError != nil || itemCount != 1 {
			t.Fatalf("unexpected source state: status=%v err=%v count=%d", *status, lastSyncError, itemCount)
		}

		// 重复同步：全量替换语义，结果一致、无孤儿/重复。
		result2, err := syncer.SyncSource(ctx, "sync-a")
		if err != nil || result2.Status != "SUCCESS" || result2.Count != 1 {
			t.Fatalf("repeated SyncSource failed: %+v err=%v", result2, err)
		}
		if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM "PromptLibraryItem" WHERE "sourceId" = 'src_sync_a'`).Scan(&itemCount); err != nil {
			t.Fatal(err)
		}
		if itemCount != 1 {
			t.Fatalf("expected exactly 1 prompt item, got %d", itemCount)
		}

		// 并发互斥：另一事务持有 advisory 锁时返回 SKIPPED_LOCKED。
		lockTx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var locked bool
		if err := lockTx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock(hashtext($1))`, "src_sync_a").Scan(&locked); err != nil {
			t.Fatal(err)
		}
		if !locked {
			t.Fatal("expected to acquire advisory lock")
		}
		result3, err := syncer.SyncSource(ctx, "sync-a")
		if err == nil || result3.Status != "SKIPPED_LOCKED" {
			t.Fatalf("expected SKIPPED_LOCKED, got %+v err=%v", result3, err)
		}
		if err := lockTx.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("prompt sync all aggregates partial failure", func(t *testing.T) {
		reset()
		insertPromptSource("src_ok", "sync-ok", "awesome-gpt-image", true)
		insertPromptSource("src_bad", "sync-bad", "awesome-gpt-image", true)

		syncer := NewPromptSyncer(pool, nil)
		syncer.fetch = func(ctx context.Context, source PromptSource, filePath string) (string, error) {
			if source.Slug == "sync-bad" {
				return "", errors.New("fixture fetch failure")
			}
			if source.Parser == "davidwu-gpt-image2-prompts" {
				return `[{"id":1,"image":"a.jpg","prompt":"p","title_cn":"T","category_cn":"海报"}]`, nil
			}
			return markdownFixture, nil
		}

		results, err := syncer.SyncAll(ctx)
		if err == nil {
			t.Fatal("expected aggregated error for partial failure")
		}
		statusBySlug := map[string]string{}
		for _, result := range results {
			statusBySlug[result.Slug] = result.Status
		}
		if statusBySlug["sync-ok"] != "SUCCESS" || statusBySlug["sync-bad"] != "FAILED" {
			t.Fatalf("unexpected per-source statuses: %v", statusBySlug)
		}

		var okStatus, badStatus string
		var badErr *string
		if err := pool.QueryRow(ctx, `SELECT status::text FROM "PromptSource" WHERE id = 'src_ok'`).Scan(&okStatus); err != nil {
			t.Fatal(err)
		}
		if err := pool.QueryRow(ctx, `SELECT status::text, "lastSyncError" FROM "PromptSource" WHERE id = 'src_bad'`).Scan(&badStatus, &badErr); err != nil {
			t.Fatal(err)
		}
		if okStatus != "SUCCESS" || badStatus != "FAILED" || badErr == nil {
			t.Fatalf("unexpected db state: ok=%s bad=%s err=%v", okStatus, badStatus, badErr)
		}
	})
}

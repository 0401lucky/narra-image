//go:build workercontractsdb

package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestGatewayDB(t *testing.T) {
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

	worker := New(pool, Config{
		AuthSecret:           "gateway-test-secret-0123456789",
		ContractsV1Enabled:   true,
		GatewayPollInterval:  time.Millisecond,
		GatewaySignatureSkew: time.Minute,
		GatewayWaitTimeout:   5 * time.Second,
		MaxActivePerUser:     1,
		MaxAttempts:          2,
		WorkerID:             "gateway-db-worker",
	}, nil)

	reset := func() {
		t.Helper()
		if _, err := pool.Exec(ctx, `DELETE FROM "GenerationJob"`); err != nil {
			t.Fatalf("清理任务失败: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM "ApiKey"`); err != nil {
			t.Fatalf("清理 API Key 失败: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM "User"`); err != nil {
			t.Fatalf("清理用户失败: %v", err)
		}
	}
	insertUser := func(id string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
INSERT INTO "User" (id, email, credits, "updatedAt")
VALUES ($1, $2, 100, CURRENT_TIMESTAMP)
`, id, id+"@example.test"); err != nil {
			t.Fatalf("插入用户失败: %v", err)
		}
	}
	insertAPIKey := func(id, userID string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
INSERT INTO "ApiKey" (id, "userId", name, "keyHash", "keyPrefix", "updatedAt")
VALUES ($1, $2, 'test', $3, 'ck_', CURRENT_TIMESTAMP)
`, id, userID, "hash-"+id); err != nil {
			t.Fatalf("插入 API Key 失败: %v", err)
		}
	}

	validEnv := func(jobID, apiKeyID, userID string) gatewayEnvelope {
		env := validGatewayEnvelope()
		env.JobID = jobID
		env.Auth.APIKeyID = apiKeyID
		env.Auth.UserID = userID
		env.IssuedAt = time.Now().UTC().Format(time.RFC3339)
		return env
	}

	t.Run("create job from envelope", func(t *testing.T) {
		reset()
		insertUser("gw_user_a")
		insertAPIKey("gw_key_a", "gw_user_a")

		job, err := worker.ensureGatewayJob(ctx, validEnv("gw_job_a", "gw_key_a", "gw_user_a"))
		if err != nil {
			t.Fatalf("ensureGatewayJob failed: %v", err)
		}
		if job.ID != "gw_job_a" || job.APIKeyID != "gw_key_a" || job.Status != "PENDING" {
			t.Fatalf("unexpected created job: %+v", job)
		}
		if job.CreditsSpent != 5 {
			t.Fatalf("expected creditsSpent 5, got %d", job.CreditsSpent)
		}
		var workerManaged bool
		var clientSource, model string
		if err := pool.QueryRow(ctx, `
SELECT "workerManaged", "clientSource", model FROM "GenerationJob" WHERE id = $1
`, job.ID).Scan(&workerManaged, &clientSource, &model); err != nil {
			t.Fatalf("read created job: %v", err)
		}
		if !workerManaged || clientSource != "API" || model != "gpt-image-2" {
			t.Fatalf("unexpected job row: managed=%v source=%q model=%q", workerManaged, clientSource, model)
		}
	})

	t.Run("same jobId reuses existing job", func(t *testing.T) {
		reset()
		insertUser("gw_user_b")
		insertAPIKey("gw_key_b", "gw_user_b")

		first, err := worker.ensureGatewayJob(ctx, validEnv("gw_job_b", "gw_key_b", "gw_user_b"))
		if err != nil {
			t.Fatalf("first ensure failed: %v", err)
		}
		second, err := worker.ensureGatewayJob(ctx, validEnv("gw_job_b", "gw_key_b", "gw_user_b"))
		if err != nil {
			t.Fatalf("second ensure failed: %v", err)
		}
		if first.ID != second.ID {
			t.Fatalf("idempotent reuse must return same job")
		}
		var count int
		if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM "GenerationJob" WHERE id = $1`, first.ID).Scan(&count); err != nil {
			t.Fatalf("count jobs: %v", err)
		}
		if count != 1 {
			t.Fatalf("expected 1 job, got %d", count)
		}
	})

	t.Run("cross api key jobId reuse is rejected", func(t *testing.T) {
		reset()
		insertUser("gw_user_c")
		insertAPIKey("gw_key_c", "gw_user_c")
		insertAPIKey("gw_key_d", "gw_user_c")

		if _, err := worker.ensureGatewayJob(ctx, validEnv("gw_job_c", "gw_key_c", "gw_user_c")); err != nil {
			t.Fatalf("first ensure failed: %v", err)
		}
		if _, err := worker.ensureGatewayJob(ctx, validEnv("gw_job_c", "gw_key_d", "gw_user_c")); !errors.Is(err, errGatewayJobConflict) {
			t.Fatalf("expected conflict, got %v", err)
		}
	})

	t.Run("wait returns succeeded result with images", func(t *testing.T) {
		reset()
		insertUser("gw_user_d")
		insertAPIKey("gw_key_e", "gw_user_d")
		job, err := worker.ensureGatewayJob(ctx, validEnv("gw_job_d", "gw_key_e", "gw_user_d"))
		if err != nil {
			t.Fatalf("ensure failed: %v", err)
		}
		if _, err := pool.Exec(ctx, `
UPDATE "GenerationJob" SET status = 'SUCCEEDED', "completedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1
`, job.ID); err != nil {
			t.Fatalf("mark succeeded: %v", err)
		}
		if _, err := pool.Exec(ctx, `
INSERT INTO "GenerationImage" (id, "jobId", url, width, height, "createdAt")
VALUES ('gw_img_1', $1, 'https://cdn.example.test/a.png', 1024, 1024, CURRENT_TIMESTAMP)
`, job.ID); err != nil {
			t.Fatalf("insert image: %v", err)
		}

		result, err := worker.waitForGatewayJob(ctx, job.ID, 2*time.Second, time.Millisecond)
		if err != nil {
			t.Fatalf("wait failed: %v", err)
		}
		if result.Status != "SUCCEEDED" || len(result.Images) != 1 || result.Images[0].URL != "https://cdn.example.test/a.png" {
			t.Fatalf("unexpected result: %+v", result)
		}
	})

	t.Run("wait returns failed result with error code", func(t *testing.T) {
		reset()
		insertUser("gw_user_e")
		insertAPIKey("gw_key_f", "gw_user_e")
		job, err := worker.ensureGatewayJob(ctx, validEnv("gw_job_e", "gw_key_f", "gw_user_e"))
		if err != nil {
			t.Fatalf("ensure failed: %v", err)
		}
		if _, err := pool.Exec(ctx, `
UPDATE "GenerationJob" SET status = 'FAILED', "errorCode" = 'PROVIDER_REQUEST_INVALID', "errorMessage" = 'bad params', "completedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1
`, job.ID); err != nil {
			t.Fatalf("mark failed: %v", err)
		}

		result, err := worker.waitForGatewayJob(ctx, job.ID, 2*time.Second, time.Millisecond)
		if err != nil {
			t.Fatalf("wait failed: %v", err)
		}
		if result.Status != "FAILED" || result.ErrorCode.String != "PROVIDER_REQUEST_INVALID" {
			t.Fatalf("unexpected failed result: %+v", result)
		}
	})

	t.Run("wait times out and does not cancel", func(t *testing.T) {
		reset()
		insertUser("gw_user_f")
		insertAPIKey("gw_key_g", "gw_user_f")
		job, err := worker.ensureGatewayJob(ctx, validEnv("gw_job_f", "gw_key_g", "gw_user_f"))
		if err != nil {
			t.Fatalf("ensure failed: %v", err)
		}
		if _, err := worker.waitForGatewayJob(ctx, job.ID, 30*time.Millisecond, time.Millisecond); !errors.Is(err, errGatewayWaitTimeout) {
			t.Fatalf("expected timeout, got %v", err)
		}
		var status string
		if err := pool.QueryRow(ctx, `SELECT status FROM "GenerationJob" WHERE id = $1`, job.ID).Scan(&status); err != nil {
			t.Fatalf("read status: %v", err)
		}
		if status != "PENDING" {
			t.Fatalf("timeout must not mutate job, got %s", status)
		}
	})

	t.Run("query enforces api key ownership", func(t *testing.T) {
		reset()
		insertUser("gw_user_g")
		insertAPIKey("gw_key_h", "gw_user_g")
		insertAPIKey("gw_key_i", "gw_user_g")
		if _, err := worker.ensureGatewayJob(ctx, validEnv("gw_job_g", "gw_key_h", "gw_user_g")); err != nil {
			t.Fatalf("ensure failed: %v", err)
		}

		if _, err := worker.queryGatewayJob(ctx, "gw_job_g", "gw_key_i"); !errors.Is(err, errGatewayJobNotFound) {
			t.Fatalf("expected not found for other api key, got %v", err)
		}
		job, err := worker.queryGatewayJob(ctx, "gw_job_g", "gw_key_h")
		if err != nil {
			t.Fatalf("query failed: %v", err)
		}
		if job.ID != "gw_job_g" {
			t.Fatalf("unexpected job: %+v", job)
		}
	})

	t.Run("full query handler round trip", func(t *testing.T) {
		reset()
		insertUser("gw_user_h")
		insertAPIKey("gw_key_j", "gw_user_h")
		env := validEnv("gw_job_h", "gw_key_j", "gw_user_h")
		if _, err := worker.ensureGatewayJob(ctx, env); err != nil {
			t.Fatalf("ensure failed: %v", err)
		}
		if _, err := pool.Exec(ctx, `
UPDATE "GenerationJob" SET status = 'SUCCEEDED', "completedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1
`, "gw_job_h"); err != nil {
			t.Fatalf("mark succeeded: %v", err)
		}
		if _, err := pool.Exec(ctx, `
INSERT INTO "GenerationImage" (id, "jobId", url, width, height, "createdAt")
VALUES ('gw_img_2', 'gw_job_h', 'https://cdn.example.test/b.png', 512, 512, CURRENT_TIMESTAMP)
`); err != nil {
			t.Fatalf("insert image: %v", err)
		}

		request := httptest.NewRequest(http.MethodGet, "/internal/gateway/v1/generations/gw_job_h", nil)
		request.Header.Set(gatewaySignatureHeader, gatewaySignature(worker.cfg.AuthSecret, []byte("gw_job_h")))
		request.Header.Set("X-Gateway-Api-Key", "gw_key_j")
		recorder := httptest.NewRecorder()
		worker.handleGatewayQuery(recorder, request)
		if recorder.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
		}
		var payload struct {
			ID     string `json:"id"`
			Status string `json:"status"`
			Images []struct {
				ID string `json:"id"`
			} `json:"images"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if payload.ID != "gw_job_h" || payload.Status != "succeeded" || len(payload.Images) != 1 {
			t.Fatalf("unexpected query payload: %+v", payload)
		}
	})

	t.Run("full POST handler creates job and formats result", func(t *testing.T) {
		reset()
		insertUser("gw_user_full")
		insertAPIKey("gw_key_full", "gw_user_full")

		env := validGatewayEnvelope()
		env.JobID = "gw_job_full"
		env.Auth.APIKeyID = "gw_key_full"
		env.Auth.UserID = "gw_user_full"
		env.IssuedAt = time.Now().UTC().Format(time.RFC3339)
		env.Payload.ResponseFormat = "url"
		body, err := json.Marshal(env)
		if err != nil {
			t.Fatalf("marshal envelope: %v", err)
		}

		// handler 创建 job 后轮询等待；后台把 job 置为成功并写入图片。
		completion := make(chan struct{})
		go func() {
			defer close(completion)
			deadline := time.Now().Add(3 * time.Second)
			for time.Now().Before(deadline) {
				var count int
				if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM "GenerationJob" WHERE id = $1`, env.JobID).Scan(&count); err == nil && count > 0 {
					_, _ = pool.Exec(ctx, `UPDATE "GenerationJob" SET status = 'SUCCEEDED', "completedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`, env.JobID)
					_, _ = pool.Exec(ctx, `INSERT INTO "GenerationImage" (id, "jobId", url, width, height, "createdAt") VALUES ('gw_img_full', $1, 'https://cdn.example.test/full.png', 1024, 1024, CURRENT_TIMESTAMP)`, env.JobID)
					return
				}
				time.Sleep(5 * time.Millisecond)
			}
		}()

		request := httptest.NewRequest(http.MethodPost, "/internal/gateway/v1/images/generations", bytes.NewReader(body))
		request.Header.Set(gatewaySignatureHeader, gatewaySignature(worker.cfg.AuthSecret, body))
		recorder := httptest.NewRecorder()
		worker.gatewayEndpointHandler("images.generations")(recorder, request)
		<-completion

		if recorder.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
		}
		var payload struct {
			Data []struct {
				URL string `json:"url"`
			} `json:"data"`
			GenerationID string `json:"generation_id"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if len(payload.Data) != 1 || payload.Data[0].URL != "https://cdn.example.test/full.png" {
			t.Fatalf("unexpected data: %+v", payload.Data)
		}
		if payload.GenerationID != env.JobID {
			t.Fatalf("unexpected generation_id: %q", payload.GenerationID)
		}
	})
}

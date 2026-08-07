// @vitest-environment node

import { Client } from "pg";

function requiredDisposableDatabaseUrl() {
  if (process.env.WORKER_CONTRACTS_REQUIRE_DB !== "1") {
    throw new Error("缺少 WORKER_CONTRACTS_REQUIRE_DB=1，拒绝运行数据库契约测试");
  }
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    throw new Error("缺少 TEST_DATABASE_URL，拒绝回退到开发数据库");
  }
  const parsed = new URL(raw);
  if (
    parsed.protocol !== "postgresql:" ||
    parsed.hostname !== "127.0.0.1" ||
    /prod(?:uction)?/i.test(parsed.pathname)
  ) {
    throw new Error("TEST_DATABASE_URL 不是 runner 创建的本地一次性数据库");
  }
  return raw;
}

const client = new Client({ connectionString: requiredDisposableDatabaseUrl() });

async function resetFixtures() {
  await client.query('DELETE FROM "User"');
}

async function insertUser(id: string) {
  await client.query(
    'INSERT INTO "User" (id, email, credits, "updatedAt") VALUES ($1, $2, 100, CURRENT_TIMESTAMP)',
    [id, `${id}@example.test`],
  );
}

async function insertJob(input: {
  contractVersion?: number;
  creditsSpent?: number;
  handoffState?: "NOT_STARTED" | "SUBMITTING" | "SUBMITTED" | "UNKNOWN" | "RESOLVED" | null;
  id: string;
  userId: string;
}) {
  await client.query(
    `
INSERT INTO "GenerationJob" (
  id, "userId", "workerManaged", "contractVersion", "handoffState",
  "providerMode", model, prompt, size, count, "creditsSpent", "updatedAt"
) VALUES ($1, $2, true, $3, $4, 'BUILT_IN', 'gpt-image-2', 'fixture prompt', '1024x1024', 1, $5, CURRENT_TIMESTAMP)
`,
    [
      input.id,
      input.userId,
      input.contractVersion ?? 0,
      input.handoffState ?? null,
      input.creditsSpent ?? 0,
    ],
  );
}

describe("worker contract v1 disposable PostgreSQL", () => {
  beforeAll(async () => {
    await client.connect();
  });

  beforeEach(async () => {
    await resetFixtures();
  });

  afterAll(async () => {
    await resetFixtures();
    await client.end();
  });

  it("旧 writer 省略新增字段时保持 legacy", async () => {
    await insertUser("db_legacy_user");
    await client.query(
      `
INSERT INTO "GenerationJob" (
  id, "userId", "workerManaged", "providerMode", model, prompt, size, count, "updatedAt"
) VALUES ('db_legacy_job', 'db_legacy_user', true, 'BUILT_IN', 'gpt-image-2', 'legacy prompt', '1024x1024', 1, CURRENT_TIMESTAMP)
`,
    );

    const result = await client.query<{
      contractVersion: number;
      handoffState: string | null;
    }>(
      'SELECT "contractVersion", "handoffState" FROM "GenerationJob" WHERE id = $1',
      ["db_legacy_job"],
    );
    expect(result.rows[0]).toEqual({ contractVersion: 0, handoffState: null });
  });

  it("v1 job 缺失 handoffState 时由数据库拒绝", async () => {
    await insertUser("db_check_user");
    await expect(insertJob({
      contractVersion: 1,
      handoffState: null,
      id: "db_invalid_v1_job",
      userId: "db_check_user",
    })).rejects.toMatchObject({ code: "23514" });
  });

  it("未决正积分 handoff 不能被旧 finalizer 清零", async () => {
    await insertUser("db_guard_user");
    await insertJob({
      contractVersion: 1,
      creditsSpent: 7,
      handoffState: "SUBMITTED",
      id: "db_guard_job",
      userId: "db_guard_user",
    });

    await expect(client.query(
      'UPDATE "GenerationJob" SET "creditsSpent" = 0 WHERE id = $1',
      ["db_guard_job"],
    )).rejects.toMatchObject({ code: "23514" });

    const guarded = await client.query<{ creditsSpent: number }>(
      'SELECT "creditsSpent" FROM "GenerationJob" WHERE id = $1',
      ["db_guard_job"],
    );
    expect(guarded.rows[0]?.creditsSpent).toBe(7);

    await expect(client.query(
      `UPDATE "GenerationJob"
       SET "creditsSpent" = 0, "handoffState" = 'RESOLVED'
       WHERE id = $1`,
      ["db_guard_job"],
    )).resolves.toMatchObject({ rowCount: 1 });
  });

  it("零积分自填任务可以正常进入未决 handoff", async () => {
    await insertUser("db_zero_user");
    await insertJob({
      contractVersion: 1,
      creditsSpent: 0,
      handoffState: "NOT_STARTED",
      id: "db_zero_job",
      userId: "db_zero_user",
    });

    await expect(client.query(
      `UPDATE "GenerationJob"
       SET "handoffState" = 'SUBMITTING'
       WHERE id = $1`,
      ["db_zero_job"],
    )).resolves.toMatchObject({ rowCount: 1 });
  });

  it("attempt ordinal 在单个 job 内唯一", async () => {
    await insertUser("db_attempt_user");
    await insertJob({
      contractVersion: 1,
      handoffState: "NOT_STARTED",
      id: "db_attempt_job",
      userId: "db_attempt_user",
    });
    const insertAttempt = (id: string) => client.query(
      `
INSERT INTO "GenerationAttempt" (
  id, "jobId", ordinal, "workerId", operation, model, "idempotencyKey", "updatedAt"
) VALUES ($1, 'db_attempt_job', 1, 'worker-a', 'images-generations', 'gpt-image-2', 'narra-image:db_attempt_job:images-generations', CURRENT_TIMESTAMP)
`,
      [id],
    );
    await expect(insertAttempt("db_attempt_1")).resolves.toMatchObject({ rowCount: 1 });
    await expect(insertAttempt("db_attempt_2")).rejects.toMatchObject({ code: "23505" });
  });
});

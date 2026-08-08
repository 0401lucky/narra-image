import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EXIT = {
  success: 0,
  preflight: 2,
  prisma: 3,
  typescript: 4,
  go: 5,
  cleanup: 6,
} as const;

// DB/migration runner 独立边界（R4 允许其用更长截止，不嵌套进 60s 父截止）。
// Windows 本地 vitest 冷启动较慢，55s 不足以覆盖 prisma migrate + TS/Go 断言。
const GLOBAL_DEADLINE_MS = 150_000;
const CLEANUP_RESERVE_MS = 10_000;
const DOCKER_PROBE_TIMEOUT_MS = 3_000;
const POSTGRES_READY_TIMEOUT_MS = 12_000;
// 默认保持验证矩阵的固定版本；本地缺少该镜像时可显式指定已存在的测试镜像。
const POSTGRES_IMAGE =
  process.env.WORKER_CONTRACTS_POSTGRES_IMAGE?.trim() || "postgres:17-alpine";
const SCRATCH_PARENT = path.resolve(
  process.env.WORKER_CONTRACTS_TMPDIR?.trim() || tmpdir(),
);
const SCRATCH_PREFIX = "narra-worker-contracts-prisma-";
const OWNER_LABEL_KEY = "com.narra.worker-contracts.owner";
const BASELINE_MARKER = "WORKER_CONTRACTS_BASELINE_MIGRATION";
const ADDITIVE_MIGRATION = "20260807130000_generation_worker_contract_v1";

const PROJECT_ROOT = path.resolve(__dirname, "../../../..");
const MIGRATIONS_ROOT = path.join(PROJECT_ROOT, "prisma/migrations");
const PRISMA_SCHEMA = path.join(PROJECT_ROOT, "prisma/schema.prisma");
const PRISMA_CLI = path.join(PROJECT_ROOT, "node_modules/prisma/build/index.js");
const LEGACY_SNAPSHOT = path.join(__dirname, "legacy-schema.sql");
const TS_DB_TEST_RELATIVE =
  "src/tests/integration/worker-contracts/worker-contracts-db.test.ts";
const TS_DB_TEST = path.join(PROJECT_ROOT, TS_DB_TEST_RELATIVE);
const RUNNER_VITEST_CONFIG_RELATIVE =
  "src/tests/integration/worker-contracts/runner-vitest.config.ts";
const RUNNER_VITEST_CONFIG = path.join(
  PROJECT_ROOT,
  RUNNER_VITEST_CONFIG_RELATIVE,
);
const GO_DB_TEST = path.join(
  PROJECT_ROOT,
  "worker/internal/worker/worker_contracts_integration_test.go",
);
const ADDITIVE_MIGRATION_SQL = path.join(
  MIGRATIONS_ROOT,
  ADDITIVE_MIGRATION,
  "migration.sql",
);

type ExitCode = (typeof EXIT)[keyof typeof EXIT];
type RunnerFailure = Error & { exitCode: ExitCode };

type CommandSpec = {
  label: string;
  executable: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  capture?: boolean;
  timeoutMs?: number;
};

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type BaselineMigration = {
  name: string;
  checksum: string;
};

type DisposablePostgres = {
  containerName: string;
  ownerToken: string;
  databaseName: string;
  databaseUser: string;
  databasePassword: string;
  hostPort?: number;
  creationAttempted: boolean;
};

function failure(exitCode: ExitCode, message: string): RunnerFailure {
  return Object.assign(new Error(message), { exitCode });
}

function formatCommand(spec: CommandSpec): string {
  return [spec.executable, ...spec.args].join(" ");
}

function terminateProcessTree(child: ReturnType<typeof spawn>): void {
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }

  const forceKillTimer = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, 750);
  forceKillTimer.unref();
}

function resolveExecutable(spec: CommandSpec): {
  executable: string;
  args: string[];
} {
  if (process.platform !== "win32" || spec.executable !== "pnpm") {
    return { executable: spec.executable, args: spec.args };
  }

  return {
    executable: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", formatCommand(spec)],
  };
}

function runCommand(spec: CommandSpec, deadlineAt: number): Promise<CommandResult> {
  const remainingMs = deadlineAt - Date.now();
  const timeoutMs = Math.min(spec.timeoutMs ?? remainingMs, remainingMs);
  if (timeoutMs <= 0) {
    return Promise.resolve({
      code: 124,
      stdout: "",
      stderr: `${spec.label}: 已超过全局截止时间`,
      timedOut: true,
    });
  }

  return new Promise((resolve) => {
    const resolved = resolveExecutable(spec);
    const capture = spec.capture === true;
    const child = spawn(resolved.executable, resolved.args, {
      cwd: spec.cwd ?? PROJECT_ROOT,
      detached: process.platform !== "win32",
      env: spec.env ?? process.env,
      shell: false,
      stdio: [spec.input === undefined ? "ignore" : "pipe", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.error(
        `[worker-contracts:db] ${spec.label} 超时，终止子进程树 PID=${child.pid ?? "unknown"}`,
      );
      terminateProcessTree(child);
    }, timeoutMs);

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdin?.on("error", () => {
      // psql 提前失败时可能关闭 stdin；退出码会承载真实失败。
    });
    if (spec.input !== undefined) child.stdin?.end(spec.input);

    child.once("error", (error) => {
      stderr += `${error.message}\n`;
      finish(1);
    });
    child.once("exit", (code) => {
      finish(timedOut ? 124 : (code ?? 1));
    });
  });
}

function printCapturedFailure(result: CommandResult): void {
  if (result.stdout.trim()) console.error(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
}

async function runChecked(
  spec: CommandSpec,
  deadlineAt: number,
  exitCode: ExitCode,
): Promise<CommandResult> {
  console.log(`[worker-contracts:db] ${spec.label}`);
  const result = await runCommand(spec, deadlineAt);
  if (result.code === 0) return result;

  printCapturedFailure(result);
  throw failure(
    exitCode,
    `[worker-contracts:db] ${spec.label} 失败（子进程退出码 ${result.code}）`,
  );
}

function listMigrationNames(): string[] {
  if (!existsSync(MIGRATIONS_ROOT)) return [];
  return readdirSync(MIGRATIONS_ROOT, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(path.join(MIGRATIONS_ROOT, entry.name, "migration.sql")),
    )
    .map((entry) => entry.name)
    .sort();
}

function migrationChecksum(migrationName: string): string {
  const migrationSql = readFileSync(
    path.join(MIGRATIONS_ROOT, migrationName, "migration.sql"),
  );
  return createHash("sha256").update(migrationSql).digest("hex");
}

function parseBaselineMarkers(snapshot: string): string[] {
  const pattern = new RegExp(
    `^-- ${BASELINE_MARKER}: ([A-Za-z0-9_-]+)\\s*$`,
    "gm",
  );
  return [...snapshot.matchAll(pattern)].map((match) => match[1]).sort();
}

function assertRequiredTargetsAndBaseline(): BaselineMigration[] {
  const requiredTargets = [
    ["Prisma schema", PRISMA_SCHEMA],
    ["Prisma CLI", PRISMA_CLI],
    ["legacy schema snapshot", LEGACY_SNAPSHOT],
    ["additive migration", ADDITIVE_MIGRATION_SQL],
    ["TypeScript DB integration test", TS_DB_TEST],
    ["isolated Vitest config", RUNNER_VITEST_CONFIG],
    ["Go DB integration test", GO_DB_TEST],
  ] as const;
  const missing = requiredTargets.filter(([, target]) => !existsSync(target));
  if (missing.length > 0) {
    const details = missing
      .map(
        ([label, target]) =>
          `  - ${label}: ${path.relative(PROJECT_ROOT, target)}`,
      )
      .join("\n");
    throw failure(
      EXIT.preflight,
      `[worker-contracts:db] 缺少固定验证目标，拒绝假绿：\n${details}`,
    );
  }

  const migrationNames = listMigrationNames();
  if (
    !migrationNames.includes(ADDITIVE_MIGRATION) ||
    migrationNames.at(-1) !== ADDITIVE_MIGRATION
  ) {
    throw failure(
      EXIT.preflight,
      `[worker-contracts:db] ${ADDITIVE_MIGRATION} 必须是唯一最新 migration`,
    );
  }

  const snapshot = readFileSync(LEGACY_SNAPSHOT, "utf8");
  if (!snapshot.includes('CREATE TABLE "_prisma_migrations"')) {
    throw failure(
      EXIT.preflight,
      "[worker-contracts:db] legacy snapshot 缺少 _prisma_migrations baseline 表",
    );
  }

  const expectedBaselineNames = migrationNames.filter(
    (name) => name !== ADDITIVE_MIGRATION,
  );
  const markerNames = parseBaselineMarkers(snapshot);
  if (JSON.stringify(markerNames) !== JSON.stringify(expectedBaselineNames)) {
    throw failure(
      EXIT.preflight,
      "[worker-contracts:db] legacy snapshot baseline 与 migration 目录不一致",
    );
  }

  return expectedBaselineNames.map((name) => ({
    name,
    checksum: migrationChecksum(name),
  }));
}

async function assertDockerPrerequisites(deadlineAt: number): Promise<void> {
  const probes: CommandSpec[] = [
    {
      label: "检查 Docker CLI",
      executable: "docker",
      args: ["--version"],
      capture: true,
      timeoutMs: DOCKER_PROBE_TIMEOUT_MS,
    },
    {
      label: "检查 Docker daemon",
      executable: "docker",
      args: ["info", "--format", "{{.ServerVersion}}"],
      capture: true,
      timeoutMs: DOCKER_PROBE_TIMEOUT_MS,
    },
    {
      label: `检查本地镜像 ${POSTGRES_IMAGE}`,
      executable: "docker",
      args: ["image", "inspect", "--format", "{{.Id}}", POSTGRES_IMAGE],
      capture: true,
      timeoutMs: DOCKER_PROBE_TIMEOUT_MS,
    },
  ];

  for (const probe of probes) {
    const result = await runCommand(probe, deadlineAt);
    if (result.code !== 0 || !result.stdout.trim()) {
      printCapturedFailure(result);
      throw failure(
        EXIT.preflight,
        `[worker-contracts:db] ${probe.label}失败；不会自动 pull 镜像`,
      );
    }
  }
}

function createResourceIdentity(): DisposablePostgres {
  const suffix = randomBytes(8).toString("hex");
  return {
    containerName: `narra-worker-contracts-${suffix}`,
    ownerToken: randomUUID(),
    databaseName: `worker_contracts_${suffix}`,
    databaseUser: "worker_contracts",
    databasePassword: randomBytes(24).toString("base64url"),
    creationAttempted: false,
  };
}

async function findContainer(
  resource: DisposablePostgres,
  deadlineAt: number,
): Promise<CommandResult> {
  return runCommand(
    {
      label: "查找一次性容器",
      executable: "docker",
      args: [
        "container",
        "ls",
        "--all",
        "--quiet",
        "--filter",
        `name=^/${resource.containerName}$`,
      ],
      capture: true,
      timeoutMs: DOCKER_PROBE_TIMEOUT_MS,
    },
    deadlineAt,
  );
}

async function assertContainerNameAvailable(
  resource: DisposablePostgres,
  deadlineAt: number,
): Promise<void> {
  const result = await findContainer(resource, deadlineAt);
  if (result.code !== 0) {
    printCapturedFailure(result);
    throw failure(
      EXIT.preflight,
      "[worker-contracts:db] 无法确认随机容器名是否可用",
    );
  }
  if (result.stdout.trim()) {
    throw failure(
      EXIT.preflight,
      `[worker-contracts:db] 随机容器名已存在：${resource.containerName}`,
    );
  }
}

async function readOwnerLabel(
  resource: DisposablePostgres,
  deadlineAt: number,
): Promise<CommandResult> {
  return runCommand(
    {
      label: "校验容器 owner label",
      executable: "docker",
      args: [
        "container",
        "inspect",
        "--format",
        `{{ index .Config.Labels "${OWNER_LABEL_KEY}" }}`,
        resource.containerName,
      ],
      capture: true,
      timeoutMs: DOCKER_PROBE_TIMEOUT_MS,
    },
    deadlineAt,
  );
}

async function startDisposablePostgres(
  resource: DisposablePostgres,
  deadlineAt: number,
): Promise<void> {
  const dockerEnv = {
    ...process.env,
    POSTGRES_USER: resource.databaseUser,
    POSTGRES_PASSWORD: resource.databasePassword,
    POSTGRES_DB: resource.databaseName,
  };
  resource.creationAttempted = true;
  const result = await runCommand(
    {
      label: "启动一次性 PostgreSQL",
      executable: "docker",
      args: [
        "run",
        "--detach",
        "--pull=never",
        "--name",
        resource.containerName,
        "--label",
        `${OWNER_LABEL_KEY}=${resource.ownerToken}`,
        "--tmpfs",
        "/var/lib/postgresql/data:rw,noexec,nosuid",
        "--publish",
        "127.0.0.1::5432",
        "--env",
        "POSTGRES_USER",
        "--env",
        "POSTGRES_PASSWORD",
        "--env",
        "POSTGRES_DB",
        POSTGRES_IMAGE,
      ],
      capture: true,
      env: dockerEnv,
    },
    deadlineAt,
  );
  if (result.code !== 0) {
    printCapturedFailure(result);
    throw failure(
      EXIT.preflight,
      "[worker-contracts:db] 无法启动一次性 PostgreSQL",
    );
  }
  const labelResult = await readOwnerLabel(resource, deadlineAt);
  if (
    labelResult.code !== 0 ||
    labelResult.stdout.trim() !== resource.ownerToken
  ) {
    printCapturedFailure(labelResult);
    throw failure(
      EXIT.cleanup,
      "[worker-contracts:db] 新容器 owner label 校验失败",
    );
  }

  const mountsResult = await runCommand(
    {
      label: "校验 PostgreSQL 数据目录为 tmpfs",
      executable: "docker",
      args: [
        "container",
        "inspect",
        "--format",
        "{{json .Mounts}}",
        resource.containerName,
      ],
      capture: true,
      timeoutMs: DOCKER_PROBE_TIMEOUT_MS,
    },
    deadlineAt,
  );
  let mounts: Array<{ Type?: string; Destination?: string }> = [];
  try {
    mounts = JSON.parse(mountsResult.stdout.trim());
  } catch {
    // 下方统一按不安全挂载处理。
  }
  const tmpfsResult = await runCommand(
    {
      label: "校验 PostgreSQL tmpfs 配置",
      executable: "docker",
      args: [
        "container",
        "inspect",
        "--format",
        "{{json .HostConfig.Tmpfs}}",
        resource.containerName,
      ],
      capture: true,
      timeoutMs: DOCKER_PROBE_TIMEOUT_MS,
    },
    deadlineAt,
  );
  let tmpfs: Record<string, string> = {};
  try {
    tmpfs = JSON.parse(tmpfsResult.stdout.trim());
  } catch {
    // 下方统一按不安全挂载处理。
  }
  if (
    mountsResult.code !== 0 ||
    tmpfsResult.code !== 0 ||
    typeof tmpfs["/var/lib/postgresql/data"] !== "string" ||
    mounts.some((mount) => mount.Type === "volume")
  ) {
    printCapturedFailure(mountsResult);
    printCapturedFailure(tmpfsResult);
    throw failure(
      EXIT.cleanup,
      "[worker-contracts:db] PostgreSQL 数据目录不是无持久卷的 tmpfs",
    );
  }

  const portResult = await runCommand(
    {
      label: "读取 PostgreSQL 动态端口",
      executable: "docker",
      args: [
        "container",
        "inspect",
        "--format",
        '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
        resource.containerName,
      ],
      capture: true,
      timeoutMs: DOCKER_PROBE_TIMEOUT_MS,
    },
    deadlineAt,
  );
  const port = Number(portResult.stdout.trim());
  if (
    portResult.code !== 0 ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    printCapturedFailure(portResult);
    throw failure(
      EXIT.preflight,
      "[worker-contracts:db] 无法取得安全的动态本地端口",
    );
  }
  resource.hostPort = port;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPostgres(
  resource: DisposablePostgres,
  deadlineAt: number,
): Promise<void> {
  const readyDeadline = Math.min(
    deadlineAt,
    Date.now() + POSTGRES_READY_TIMEOUT_MS,
  );
  while (Date.now() < readyDeadline) {
    const result = await runCommand(
      {
        label: "等待 PostgreSQL ready",
        executable: "docker",
        args: [
          "exec",
          resource.containerName,
          "pg_isready",
          "--quiet",
          "--username",
          resource.databaseUser,
          "--dbname",
          resource.databaseName,
        ],
        capture: true,
        timeoutMs: 1_000,
      },
      readyDeadline,
    );
    if (result.code === 0) return;
    await delay(250);
  }

  throw failure(
    EXIT.preflight,
    "[worker-contracts:db] 一次性 PostgreSQL 未在期限内 ready",
  );
}

function buildDatabaseUrl(resource: DisposablePostgres): string {
  if (!resource.hostPort) {
    throw failure(EXIT.preflight, "[worker-contracts:db] 动态端口尚未就绪");
  }
  const databaseUrl =
    `postgresql://${resource.databaseUser}:` +
    `${resource.databasePassword}@127.0.0.1:${resource.hostPort}/` +
    `${resource.databaseName}?schema=public&connect_timeout=3`;
  const parsed = new URL(databaseUrl);
  if (
    parsed.protocol !== "postgresql:" ||
    parsed.hostname !== "127.0.0.1" ||
    Number(parsed.port) !== resource.hostPort ||
    parsed.pathname !== `/${resource.databaseName}` ||
    /prod(?:uction)?/i.test(parsed.pathname)
  ) {
    throw failure(
      EXIT.preflight,
      "[worker-contracts:db] 拒绝非一次性本地数据库连接",
    );
  }
  return databaseUrl;
}

function buildDatabaseEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.DOTENV_CONFIG_PATH;
  delete env.DOTENV_CONFIG_OVERRIDE;
  delete env.DOTENV_KEY;
  env.DATABASE_URL = databaseUrl;
  env.TEST_DATABASE_URL = databaseUrl;
  env.WORKER_CONTRACTS_REQUIRE_DB = "1";
  env.NODE_ENV = "test";
  env.PRISMA_HIDE_UPDATE_MESSAGE = "1";
  return env;
}

async function loadLegacySnapshot(
  resource: DisposablePostgres,
  snapshot: string,
  deadlineAt: number,
): Promise<void> {
  await runChecked(
    {
      label: "加载 legacy schema snapshot 与 baseline",
      executable: "docker",
      args: [
        "exec",
        "--interactive",
        resource.containerName,
        "psql",
        "--set",
        "ON_ERROR_STOP=1",
        "--username",
        resource.databaseUser,
        "--dbname",
        resource.databaseName,
      ],
      input: snapshot,
      capture: true,
    },
    deadlineAt,
    EXIT.prisma,
  );
}

async function queryAppliedMigrations(
  resource: DisposablePostgres,
  deadlineAt: number,
): Promise<BaselineMigration[]> {
  const result = await runChecked(
    {
      label: "读取 migration baseline",
      executable: "docker",
      args: [
        "exec",
        resource.containerName,
        "psql",
        "--tuples-only",
        "--no-align",
        "--field-separator",
        "\t",
        "--username",
        resource.databaseUser,
        "--dbname",
        resource.databaseName,
        "--command",
        'SELECT "migration_name", "checksum" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL ORDER BY "migration_name"',
      ],
      capture: true,
    },
    deadlineAt,
    EXIT.prisma,
  );

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, checksum, ...rest] = line.split("\t");
      if (!name || !checksum || rest.length > 0) {
        throw failure(
          EXIT.prisma,
          "[worker-contracts:db] migration baseline 查询结果格式无效",
        );
      }
      return { name, checksum };
    });
}

function assertMigrationSet(
  actual: BaselineMigration[],
  expected: BaselineMigration[],
  phase: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw failure(
      EXIT.prisma,
      `[worker-contracts:db] ${phase} migration 集合或 checksum 不匹配`,
    );
  }
}

async function runPrismaStages(
  databaseEnv: NodeJS.ProcessEnv,
  deadlineAt: number,
): Promise<void> {
  const baseSpec = {
    executable: process.execPath,
    cwd: PROJECT_ROOT,
    env: databaseEnv,
  };
  await runChecked(
    {
      ...baseSpec,
      label: "Prisma generate（隔离 cwd，不加载项目 .env）",
      args: [PRISMA_CLI, "generate", "--schema", PRISMA_SCHEMA],
    },
    deadlineAt,
    EXIT.prisma,
  );
  await runChecked(
    {
      ...baseSpec,
      label: "Prisma validate（隔离 cwd，不加载项目 .env）",
      args: [PRISMA_CLI, "validate", "--schema", PRISMA_SCHEMA],
    },
    deadlineAt,
    EXIT.prisma,
  );
}

async function deployAdditiveMigration(
  databaseEnv: NodeJS.ProcessEnv,
  deadlineAt: number,
): Promise<void> {
  await runChecked(
    {
      label: "部署唯一待执行的 additive migration",
      executable: process.execPath,
      args: [PRISMA_CLI, "migrate", "deploy", "--schema", PRISMA_SCHEMA],
      cwd: PROJECT_ROOT,
      env: databaseEnv,
    },
    deadlineAt,
    EXIT.prisma,
  );
}

async function runDatabaseAssertions(
  databaseEnv: NodeJS.ProcessEnv,
  deadlineAt: number,
): Promise<void> {
  await runChecked(
    {
      label: "运行 TypeScript disposable DB 断言",
      executable: "pnpm",
      args: [
        "exec",
        "vitest",
        "run",
        TS_DB_TEST_RELATIVE,
        "--config",
        RUNNER_VITEST_CONFIG_RELATIVE,
        "--reporter=dot",
        "--testTimeout=15000",
      ],
      env: databaseEnv,
    },
    deadlineAt,
    EXIT.typescript,
  );

  await runChecked(
    {
      label: "运行 Go disposable DB 断言",
      executable: "go",
      args: [
        "-C",
        "worker",
        "test",
        "-tags",
        "workercontractsdb",
        "-count=1",
        "-timeout=50s",
        "./internal/worker",
        "-run",
        "^TestWorkerContractsDB",
      ],
      env: databaseEnv,
    },
    deadlineAt,
    EXIT.go,
  );
}

async function cleanupContainer(
  resource: DisposablePostgres,
  deadlineAt: number,
): Promise<boolean> {
  if (!resource.creationAttempted) return true;

  const existing = await findContainer(resource, deadlineAt);
  if (existing.code !== 0) {
    printCapturedFailure(existing);
    return false;
  }
  if (!existing.stdout.trim()) return true;

  const labelResult = await readOwnerLabel(resource, deadlineAt);
  if (
    labelResult.code !== 0 ||
    labelResult.stdout.trim() !== resource.ownerToken
  ) {
    printCapturedFailure(labelResult);
    console.error(
      `[worker-contracts:db] 拒绝清理归属不匹配的容器：${resource.containerName}`,
    );
    return false;
  }

  const removeResult = await runCommand(
    {
      label: "清理一次性 PostgreSQL",
      executable: "docker",
      args: [
        "container",
        "rm",
        "--force",
        "--volumes",
        resource.containerName,
      ],
      capture: true,
      timeoutMs: Math.max(1, deadlineAt - Date.now()),
    },
    deadlineAt,
  );
  if (removeResult.code !== 0) {
    printCapturedFailure(removeResult);
    return false;
  }

  const verifyRemoved = await findContainer(resource, deadlineAt);
  if (verifyRemoved.code !== 0) {
    printCapturedFailure(verifyRemoved);
    return false;
  }
  return !verifyRemoved.stdout.trim();
}

function cleanupScratchDirectory(scratchDirectory?: string): boolean {
  if (!scratchDirectory) return true;
  const resolved = path.resolve(scratchDirectory);
  const safeParent = SCRATCH_PARENT;
  if (
    path.dirname(resolved).toLowerCase() !== safeParent.toLowerCase() ||
    !path.basename(resolved).startsWith(SCRATCH_PREFIX)
  ) {
    console.error(
      `[worker-contracts:db] 拒绝删除非 runner 临时目录：${resolved}`,
    );
    return false;
  }

  try {
    rmSync(resolved, { recursive: true, force: true });
    return !existsSync(resolved);
  } catch (error) {
    console.error(
      `[worker-contracts:db] 临时目录清理失败：${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

async function main(): Promise<ExitCode> {
  const runnerDeadlineAt = Date.now() + GLOBAL_DEADLINE_MS;
  const workDeadlineAt = runnerDeadlineAt - CLEANUP_RESERVE_MS;
  const resource = createResourceIdentity();
  let scratchDirectory: string | undefined;
  let exitCode: ExitCode = EXIT.success;

  try {
    const baselineMigrations = assertRequiredTargetsAndBaseline();
    await assertDockerPrerequisites(workDeadlineAt);
    await assertContainerNameAvailable(resource, workDeadlineAt);
    await startDisposablePostgres(resource, workDeadlineAt);
    await waitForPostgres(resource, workDeadlineAt);

    const databaseUrl = buildDatabaseUrl(resource);
    const databaseEnv = buildDatabaseEnvironment(databaseUrl);
    if (!existsSync(SCRATCH_PARENT)) {
      throw failure(
        EXIT.preflight,
        `[worker-contracts:db] 临时目录父级不存在：${SCRATCH_PARENT}`,
      );
    }
    scratchDirectory = mkdtempSync(
      path.join(SCRATCH_PARENT, SCRATCH_PREFIX),
    );

    await runPrismaStages(databaseEnv, workDeadlineAt);
    await loadLegacySnapshot(
      resource,
      readFileSync(LEGACY_SNAPSHOT, "utf8"),
      workDeadlineAt,
    );

    const beforeDeploy = await queryAppliedMigrations(
      resource,
      workDeadlineAt,
    );
    assertMigrationSet(beforeDeploy, baselineMigrations, "部署前");

    await deployAdditiveMigration(databaseEnv, workDeadlineAt);
    const afterDeploy = await queryAppliedMigrations(resource, workDeadlineAt);
    assertMigrationSet(
      afterDeploy,
      [
        ...baselineMigrations,
        {
          name: ADDITIVE_MIGRATION,
          checksum: migrationChecksum(ADDITIVE_MIGRATION),
        },
      ].sort((left, right) => left.name.localeCompare(right.name)),
      "部署后",
    );

    await runDatabaseAssertions(databaseEnv, workDeadlineAt);
    console.log("[worker-contracts:db] disposable PostgreSQL 验证全部通过");
  } catch (error) {
    const runnerFailure = error as Partial<RunnerFailure>;
    exitCode = runnerFailure.exitCode ?? EXIT.preflight;
    console.error(
      error instanceof Error
        ? error.message
        : "[worker-contracts:db] 未知验证错误",
    );
  } finally {
    const containerCleaned = await cleanupContainer(resource, runnerDeadlineAt);
    const scratchCleaned = cleanupScratchDirectory(scratchDirectory);
    if (!containerCleaned || !scratchCleaned) exitCode = EXIT.cleanup;
  }

  return exitCode;
}

void main().then((exitCode) => {
  process.exitCode = exitCode;
});

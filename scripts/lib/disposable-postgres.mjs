import { randomBytes, randomUUID } from "node:crypto";

import { runStage } from "./command-runner.mjs";
import { LocalDockerSession } from "./local-docker-safety.mjs";

const DOCKER_PROBE_TIMEOUT_MS = 5_000;
const POSTGRES_READY_TIMEOUT_MS = 20_000;

function failure(exitCode, message) {
  return Object.assign(new Error(message), { exitCode });
}

function assertSafeName(value, prefix, label) {
  if (
    !value.startsWith(prefix) ||
    !/^[a-z0-9][a-z0-9_.-]+$/.test(value) ||
    value.length > 63
  ) {
    throw failure(2, `${label} 不满足安全随机前缀约束：${value}`);
  }
}

function printCaptured(result) {
  if (result.stdout?.trim()) console.error(result.stdout.trim());
  if (result.stderr?.trim()) console.error(result.stderr.trim());
}

async function runDocker(resource, args, options) {
  const isolated = resource.docker.command(args, options.env);
  return runStage(
    {
      label: options.label,
      executable: "docker",
      args: isolated.args,
      capture: options.capture ?? true,
      env: isolated.env,
      input: options.input,
      timeoutMs: options.timeoutMs,
    },
    {
      scope: options.scope,
      deadlineAt: options.deadlineAt,
    },
  );
}

async function runDockerChecked(resource, args, options) {
  const result = await runDocker(resource, args, options);
  if (result.code === 0) return result;
  printCaptured(result);
  throw failure(
    options.exitCode ?? 2,
    `${options.label} 失败（退出码 ${result.code}）`,
  );
}

export function createPostgresResource(options = {}) {
  const prefix = options.prefix ?? "narra-release-pg-";
  const suffix = randomBytes(8).toString("hex");
  const resource = {
    prefix,
    containerName: `${prefix}${suffix}`,
    ownerToken: randomUUID(),
    ownerLabelKey: options.ownerLabelKey ?? "com.narra.release.owner",
    image: options.image ?? "postgres:17-alpine",
    databaseUser: options.databaseUser ?? "narra_release",
    databasePassword:
      options.databasePassword ??
      `Narra:@#?/${randomBytes(18).toString("base64url")}`,
    adminDatabase: `narra_admin_${suffix}`,
    hostPort: null,
    creationAttempted: false,
    containerId: null,
    docker: new LocalDockerSession(),
  };
  assertSafeName(resource.containerName, prefix, "容器名");
  assertSafeName(resource.adminDatabase, "narra_admin_", "数据库名");
  return resource;
}

export async function assertDockerPrerequisites(resource, options) {
  await resource.docker.pin(async (args, label) => {
    const result = await runDocker(resource, args, { ...options, label, timeoutMs: DOCKER_PROBE_TIMEOUT_MS });
    if (result.code !== 0 || !result.stdout.trim()) throw failure(2, `${label} failed; local Docker is required`);
    return result.stdout.trim();
  });
  const probes = [
    ["检查 Docker CLI", ["--version"]],
    ["检查 Docker daemon", ["info", "--format", "{{.ServerVersion}}"]],
    [
      `检查本地镜像 ${resource.image}`,
      ["image", "inspect", "--format", "{{.Id}}", resource.image],
    ],
  ];
  for (const [label, args] of probes) {
    const result = await runDocker(resource, args, {
      ...options,
      label,
      timeoutMs: DOCKER_PROBE_TIMEOUT_MS,
    });
    if (result.code !== 0 || !result.stdout.trim()) {
      printCaptured(result);
      throw failure(2, `${label}失败；runner 不会自动 pull 镜像`);
    }
  }
  resource.docker.prepare();
}

async function findContainer(resource, options) {
  return runDocker(resource,
    [
      "container",
      "ls",
      "--all",
      "--quiet",
      "--filter",
      `name=^/${resource.containerName}$`,
    ],
    {
      ...options,
      label: "查找 runner PostgreSQL 容器",
      timeoutMs: DOCKER_PROBE_TIMEOUT_MS,
    },
  );
}

async function readContainerIdentity(resource, options) {
  const result = await runDocker(resource,
    [
      "container",
      "inspect",
      "--format",
      "{{json .}}",
      resource.containerName,
    ],
    {
      ...options,
      label: "校验 runner PostgreSQL owner label",
      timeoutMs: DOCKER_PROBE_TIMEOUT_MS,
    },
  );
  if (result.code !== 0) return null;
  try {
    const container = JSON.parse(result.stdout.trim());
    if (!/^[a-f0-9]{64}$/.test(container.Id ?? "") || container.Name !== `/${resource.containerName}`
      || container.Config?.Labels?.[resource.ownerLabelKey] !== resource.ownerToken
      || (resource.containerId && container.Id !== resource.containerId)) return null;
    return container.Id;
  } catch { return null; }
}

export async function startPostgres(resource, options) {
  const existing = await findContainer(resource, options);
  if (existing.code !== 0 || existing.stdout.trim()) {
    printCaptured(existing);
    throw failure(2, "无法证明随机容器名可安全使用");
  }

  const dockerEnv = {
    POSTGRES_USER: resource.databaseUser,
    POSTGRES_PASSWORD: resource.databasePassword,
    POSTGRES_DB: resource.adminDatabase,
  };
  resource.creationAttempted = true;
  const started = await runDockerChecked(resource,
    [
      "run",
      "--detach",
      "--pull=never",
      "--name",
      resource.containerName,
      "--label",
      `${resource.ownerLabelKey}=${resource.ownerToken}`,
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
      resource.image,
    ],
    {
      ...options,
      label: "启动 disposable PostgreSQL",
      env: dockerEnv,
      exitCode: 2,
    },
  );

  if (/^[a-f0-9]{64}$/.test(started.stdout.trim())) resource.containerId = started.stdout.trim();
  const identity = await readContainerIdentity(resource, options);
  if (!identity) {
    throw failure(8, "新建容器 owner label 校验失败");
  }
  resource.containerId = identity;

  const mountsResult = await runDockerChecked(resource,
    [
      "container",
      "inspect",
      "--format",
      "{{json .Mounts}}",
      resource.containerName,
    ],
    {
      ...options,
      label: "校验 PostgreSQL tmpfs 与无持久卷",
      exitCode: 8,
    },
  );
  let mounts;
  try {
    mounts = JSON.parse(mountsResult.stdout.trim());
  } catch {
    throw failure(8, "无法解析 PostgreSQL mount 信息");
  }
  const tmpfsResult = await runDockerChecked(resource,
    [
      "container",
      "inspect",
      "--format",
      "{{json .HostConfig.Tmpfs}}",
      resource.containerName,
    ],
    {
      ...options,
      label: "校验 PostgreSQL tmpfs 配置",
      exitCode: 8,
    },
  );
  let tmpfs;
  try {
    tmpfs = JSON.parse(tmpfsResult.stdout.trim());
  } catch {
    throw failure(8, "无法解析 PostgreSQL tmpfs 配置");
  }
  if (
    typeof tmpfs?.["/var/lib/postgresql/data"] !== "string" ||
    mounts.some((mount) => mount.Type === "volume")
  ) {
    throw failure(8, "PostgreSQL 数据目录不是无持久卷的 tmpfs");
  }

  const portResult = await runDockerChecked(resource,
    [
      "container",
      "inspect",
      "--format",
      '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
      resource.containerName,
    ],
    {
      ...options,
      label: "读取 PostgreSQL 动态本地端口",
      exitCode: 2,
    },
  );
  const port = Number(portResult.stdout.trim());
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw failure(2, "PostgreSQL 动态端口无效");
  }
  resource.hostPort = port;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForPostgres(resource, options, { probe = runDocker, now = Date.now, sleep = delay } = {}) {
  const readyDeadlineAt = Math.min(
    options.deadlineAt,
    now() + POSTGRES_READY_TIMEOUT_MS,
  );
  while (now() < readyDeadlineAt) {
    const result = await probe(resource,
      [
        "exec",
        resource.containerName,
        "pg_isready",
        "--quiet",
        // The image's initialization-only server accepts Unix sockets, not TCP.
        "--host",
        "127.0.0.1",
        "--port",
        "5432",
        "--username",
        resource.databaseUser,
        "--dbname",
        resource.adminDatabase,
      ],
      {
        ...options,
        deadlineAt: readyDeadlineAt,
        label: "等待 disposable PostgreSQL ready",
        timeoutMs: 1_000,
      },
    );
    if (result.code === 0) return;
    await sleep(250);
  }
  throw failure(2, "disposable PostgreSQL 未在期限内 ready");
}

export function buildDatabaseUrl(resource, databaseName) {
  if (!resource.hostPort) throw failure(2, "PostgreSQL 动态端口尚未就绪");
  assertSafeName(databaseName, "narra_", "数据库名");
  const url = new URL("postgresql://127.0.0.1");
  url.username = resource.databaseUser;
  url.password = resource.databasePassword;
  url.port = String(resource.hostPort);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  url.searchParams.set("connect_timeout", "3");
  if (
    url.hostname !== "127.0.0.1" ||
    /prod(?:uction)?/i.test(databaseName)
  ) {
    throw failure(2, "拒绝构造非 disposable localhost 数据库 URL");
  }
  return url.toString();
}

export function buildDatabaseEnvironment(databaseUrl, extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.DOTENV_CONFIG_PATH;
  delete env.DOTENV_CONFIG_OVERRIDE;
  delete env.DOTENV_KEY;
  env.DATABASE_URL = databaseUrl;
  env.TEST_DATABASE_URL = databaseUrl;
  env.NODE_ENV = "test";
  env.PRISMA_HIDE_UPDATE_MESSAGE = "1";
  return env;
}

export async function runPsql(resource, options) {
  const args = [
    "exec",
    ...(options.input === undefined ? [] : ["--interactive"]),
    resource.containerName,
    "psql",
    "--set",
    "ON_ERROR_STOP=1",
    "--username",
    resource.databaseUser,
    "--dbname",
    options.databaseName ?? resource.adminDatabase,
  ];
  if (options.tuplesOnly) args.push("--tuples-only", "--no-align");
  if (options.command) args.push("--command", options.command);
  return runDockerChecked(resource, args, {
    ...options,
    label: options.label ?? "执行 disposable PostgreSQL SQL",
    input: options.input,
    exitCode: options.exitCode ?? 3,
  });
}

export async function createDatabase(resource, databaseName, options) {
  assertSafeName(databaseName, "narra_", "数据库名");
  await runPsql(resource, {
    ...options,
    label: `创建 disposable 数据库 ${databaseName}`,
    command: `CREATE DATABASE "${databaseName}"`,
  });
}

async function cleanupPostgresContainer(resource, options) {
  if (!resource.creationAttempted) return true;
  assertSafeName(resource.containerName, resource.prefix, "容器名");
  const existing = await findContainer(resource, options);
  if (existing.code !== 0) {
    printCaptured(existing);
    return false;
  }
  if (!existing.stdout.trim()) return true;

  const identity = await readContainerIdentity(resource, options);
  if (!identity) {
    console.error(`拒绝清理 owner 不匹配的容器：${resource.containerName}`);
    return false;
  }
  const removed = await runDocker(resource,
    [
      "container",
      "rm",
      "--force",
      identity,
    ],
    {
      ...options,
      label: "清理精确归属的 disposable PostgreSQL 容器（不删除卷）",
    },
  );
  if (removed.code !== 0) {
    printCaptured(removed);
    return false;
  }
  const verify = await findContainer(resource, options);
  return verify.code === 0 && !verify.stdout.trim();
}

export async function cleanupPostgres(resource, options) {
  let cleaned = false;
  try { cleaned = await cleanupPostgresContainer(resource, options); }
  catch { return false; }
  finally {
    // Retain the pinned config if container cleanup must be retried.
    if (cleaned && !resource.docker.cleanup()) cleaned = false;
  }
  if (cleaned) resource.creationAttempted = false;
  return cleaned;
}

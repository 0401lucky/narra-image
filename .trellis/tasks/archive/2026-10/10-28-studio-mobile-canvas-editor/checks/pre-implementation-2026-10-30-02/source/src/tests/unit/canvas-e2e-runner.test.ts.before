// @vitest-environment node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertE2EBuiltImage, assertE2EContainer, assertE2ENetwork, assertLocalDockerEndpoint,
  cleanupE2EWorkspace, createE2EConfiguration, createE2EProject, createE2EWorkspace,
  E2EHarness, E2E_OWNER_LABEL, e2eComposeArgs, e2eComposeEnvironment, e2eComposePluginDirectory, e2eSystemEnvironment,
} from "../../../scripts/lib/e2e-safety.mjs";
import { E2E_LIMITS, E2E_SCENARIOS, hasExactCanvasCapability, main, matchesReadiness } from "../../../scripts/verify-e2e.mjs";
import capability from "../../../contracts/canvas/v1/capability.json";

type Configuration = ReturnType<typeof createE2EConfiguration>;
type Command = { args: string[]; env?: NodeJS.ProcessEnv; timeoutMs: number };
const workspaces: ReturnType<typeof createE2EWorkspace>[] = [];
const harnesses: E2EHarness[] = [];
const id = "a".repeat(64);
const imageId = `sha256:${id}`;
const root = process.cwd();

function commandArgs(command: Command) {
  const args = [...command.args];
  while (["--host", "--config"].includes(args[0])) args.splice(0, 2);
  return args;
}

function fakeDocker(configuration: Configuration, { missing = false, buildCode = 0, endpoint = "unix:///var/run/docker.sock" } = {}) {
  const calls: { command: Command; deadlineAt: number }[] = [];
  const built = new Set<string>();
  let pluginDirectory: string | undefined;
  const run = vi.fn(async (command: Command, options: { deadlineAt?: number } = {}) => {
    calls.push({ command, deadlineAt: options.deadlineAt ?? Number.NaN });
    const args = commandArgs(command);
    let stdout = "";
    let code = 0;
    if (args.join(" ") === "context show") stdout = "local-test";
    else if (args[0] === "context" && args[1] === "inspect") stdout = JSON.stringify(endpoint);
    else if (args[0] === "info" && args.includes("{{json .ClientInfo.Plugins}}")) {
      const workspace = createE2EWorkspace(configuration.owner);
      workspaces.push(workspace);
      pluginDirectory = workspace.directory;
      const pluginPath = path.join(pluginDirectory, process.platform === "win32" ? "docker-compose.exe" : "docker-compose");
      writeFileSync(pluginPath, "mock binary; never executed by unit tests");
      stdout = JSON.stringify([{ Name: "compose", Path: pluginPath }, { Name: "unrelated", Path: process.execPath }]);
    }
    else if (args[0] === "info") stdout = "linux 29.0.0";
    else if (args[0] === "compose" && args.includes("version")) stdout = "2.39.0";
    else if (args[0] === "compose" && args.includes("config")) stdout = "";
    else if (args[0] === "image" && args[1] === "inspect") {
      const image = args.at(-1)!;
      const owned = image === configuration.images.app || image === configuration.images.worker;
      if (missing || (owned && !configuration.skipBuild && !built.has(image))) code = 1;
      else stdout = JSON.stringify({ Id: imageId, Os: "linux", RepoTags: [image], Config: { Labels: built.has(image) ? { [E2E_OWNER_LABEL]: configuration.owner } : {} } });
    } else if (args[0] === "image" && args[1] === "ls") stdout = built.has(args.at(-1)!.replace("reference=", "")) ? imageId : "";
    else if (args[0] === "image" && args[1] === "rm") built.delete(args.at(-1)!);
    else if (args[0] === "build") { code = buildCode; if (!code) built.add(args[args.indexOf("-t") + 1]); }
    else throw new Error(`Unexpected mocked Docker operation: ${args.join(" ")}`);
    return { code, stdout, stderr: code ? "fixture failure" : "", timedOut: false, signal: null, durationMs: 1 };
  });
  return { calls, run, get pluginDirectory() { return pluginDirectory; } };
}

function fixtureHarness(configuration: Configuration, docker = fakeDocker(configuration)) {
  const harness = new E2EHarness({ configuration, projectRoot: root, run: docker.run, deadlineAt: Date.now() + 60_000 });
  harnesses.push(harness);
  return { harness, docker };
}

function resourceHarness() {
  const configuration = createE2EConfiguration({});
  const project = { ...createE2EProject(configuration, "resources"), networkId: "b".repeat(64) };
  const labels: Record<string, string> = { [E2E_OWNER_LABEL]: configuration.owner, "com.docker.compose.project": project.name };
  const containerLabels: Record<string, string> = { ...labels, "com.docker.compose.service": "db" };
  const network = { Id: project.networkId, Name: project.networkName, Internal: true, Labels: labels, Containers: { [id]: { Name: `${project.name}-db-1` } } };
  const database = {
    Id: id, Name: `/${project.name}-db-1`,
    Config: {
      Image: configuration.images.postgres,
      Labels: containerLabels,
      Env: [`POSTGRES_DB=${project.databaseName}`, `POSTGRES_USER=${configuration.databaseUser}`, `POSTGRES_PASSWORD=${configuration.databasePassword}`],
    },
    HostConfig: { Tmpfs: { "/var/lib/postgresql/data": "rw,noexec,nosuid" } },
    Mounts: [{ Type: "tmpfs" }],
    NetworkSettings: { Networks: { [project.networkName]: { NetworkID: network.Id } } },
  };
  const state = { network, database, containers: [database], networkPresent: true, failures: new Map<string, number>() };
  const calls: { command: Command; deadlineAt: number }[] = [];
  const run = vi.fn(async (command: Command, options: { deadlineAt?: number } = {}) => {
    calls.push({ command, deadlineAt: options.deadlineAt ?? Number.NaN });
    const args = commandArgs(command);
    const operation = args.slice(0, 2).join(" ");
    const code = state.failures.get(operation) ?? 0;
    let stdout = "";
    if (!code) {
      if (operation === "container ls") stdout = state.containers.map((container) => container.Id).join("\n");
      else if (operation === "container inspect") stdout = JSON.stringify(state.containers);
      else if (operation === "network ls") stdout = state.networkPresent ? state.network.Id : "";
      else if (operation === "network inspect") stdout = JSON.stringify(state.network);
      else if (operation === "container rm") {
        state.containers = state.containers.filter((container) => !args.includes(container.Id));
        for (const containerId of args.slice(3)) delete state.network.Containers[containerId];
      } else if (operation === "network rm") state.networkPresent = false;
      else if (args[0] !== "compose") throw new Error(`Unexpected resource fixture operation: ${args.join(" ")}`);
    }
    return { code, stdout, stderr: code ? "fixture failure" : "", timedOut: false, signal: null, durationMs: 1 };
  });
  const harness = new E2EHarness({ configuration, projectRoot: root, run, deadlineAt: Date.now() + 60_000 });
  harness.workspace = createE2EWorkspace(configuration.owner);
  harness.endpoint = "unix:///var/run/docker.sock";
  harness.projects.add(project);
  project.creationAttempted = true;
  harnesses.push(harness);
  return { harness, project, state, calls };
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) if (harness.workspace) expect(cleanupE2EWorkspace(harness.workspace)).toBe(true);
  for (const workspace of workspaces.splice(0)) expect(cleanupE2EWorkspace(workspace)).toBe(true);
  vi.restoreAllMocks();
});

describe("safe E2E runner environment and prerequisites", () => {
  it("whitelists OS essentials and ignores caller DB, storage, owner, proxy and Docker/Compose configuration", () => {
    const source = {
      PATH: "safe-path", SystemRoot: "safe-system", HOME: "safe-home",
      DATABASE_URL: "postgresql://prod/real", TEST_DATABASE_URL: "postgresql://prod/real",
      AUTH_SECRET: "ambient-secret", S3_SECRET_ACCESS_KEY: "ambient-secret", S3_ENDPOINT: "https://real.invalid",
      DOCKER_HOST: "tcp://prod:2375", DOCKER_CONTEXT: "prod", DOCKER_CONFIG: "real-config",
      COMPOSE_FILE: "prod.yml", COMPOSE_ENV_FILES: ".env", HTTP_PROXY: "https://real.invalid",
      NODE_OPTIONS: "--require=untrusted", E2E_OWNER_TOKEN: "foreign-owner", E2E_DATABASE_URL: "postgresql://prod/real",
    };
    expect(e2eSystemEnvironment(source)).toEqual({ PATH: "safe-path", SystemRoot: "safe-system", HOME: "safe-home" });
    const configuration = createE2EConfiguration(source);
    const project = createE2EProject(configuration, "canvas-test", { canvas: true });
    const env = e2eComposeEnvironment(configuration, project);
    expect(env.E2E_OWNER_TOKEN).not.toBe(source.E2E_OWNER_TOKEN);
    expect(JSON.stringify(env)).not.toMatch(/ambient-secret|prod\/real|real-config|real\.invalid|untrusted/);
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("DOCKER_HOST");
    expect(env.COMPOSE_DISABLE_ENV_FILE).toBe("1");
    const db = new URL(env.E2E_DATABASE_URL);
    expect(db.hostname).toBe("db");
    expect(db.port).toBe("5432");
    expect(db.pathname).toBe(`/${project.databaseName}`);
    expect(decodeURIComponent(db.password)).toBe(configuration.databasePassword);
    expect(env.E2E_S3_ENDPOINT).toBe("http://object-store:9090");
    expect(env.E2E_S3_PUBLIC_BASE_URL).toBe(`http://object-store:9090/${project.bucket}`);
  });

  it("generates fresh identities, credentials, project and database names every time", () => {
    const first = createE2EConfiguration({});
    const second = createE2EConfiguration({});
    for (const field of ["owner", "suffix", "authSecret", "databaseUser", "databasePassword", "storeToken"] as const) expect(first[field]).not.toBe(second[field]);
    expect(createE2EProject(first, "same").name).not.toBe(createE2EProject(first, "same").name);
    expect(() => createE2EConfiguration({ E2E_APP_IMAGE: "prod/app:latest" })).toThrow(/SKIP_BUILD/);
    expect(() => createE2EConfiguration({ E2E_SKIP_BUILD: "1" })).toThrow(/both/);
  });

  it.each(["tcp://127.0.0.1:2375", "tcp://prod:2375", "ssh://host", "npipe:////remote/pipe/docker", "unix:///tmp/../other.sock", "unix:///tmp/docker.sock?remote=1"])("rejects unsafe Docker endpoint %s", (endpoint) => {
    expect(() => assertLocalDockerEndpoint(endpoint)).toThrow(/local/);
  });

  it.each(["unix:///var/run/docker.sock", "npipe:////./pipe/dockerDesktopLinuxEngine"])("accepts and pins local Docker endpoint %s", (endpoint) => {
    expect(assertLocalDockerEndpoint(endpoint)).toBe(endpoint);
  });

  it("missing local images refuses before scratch/build/container/network creation and inspects every base", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const configuration = createE2EConfiguration({});
    const docker = fakeDocker(configuration, { missing: true });
    const { harness } = fixtureHarness(configuration, docker);
    await expect(harness.preflight()).rejects.toMatchObject({ exitCode: 2 });
    expect(harness.workspace).toBeNull();
    expect(harness.projects.size).toBe(0);
    const operations = docker.calls.map(({ command }) => commandArgs(command));
    expect(operations.filter((args) => args[0] === "image" && args[1] === "inspect").map((args) => args.at(-1))).toEqual([
      configuration.images.postgres, configuration.images.node, configuration.images.go, configuration.images.alpine,
    ]);
    expect(operations.every((args) => ["context", "info", "image"].includes(args[0]))).toBe(true);
    expect(docker.calls.every(({ command, deadlineAt }) => command.timeoutMs > 0 && Number.isFinite(deadlineAt))).toBe(true);
    expect(docker.calls.filter(({ command }) => commandArgs(command)[0] !== "context").every(({ command }) => command.args.slice(0, 2).join(" ") === "--host unix:///var/run/docker.sock")).toBe(true);
    await expect(harness.buildImages()).rejects.toThrow(/preflight/);
  });

  it("refuses a remote active context before daemon/image probes", async () => {
    const configuration = createE2EConfiguration({});
    const { harness, docker } = fixtureHarness(configuration, fakeDocker(configuration, { endpoint: "ssh://production" }));
    await expect(harness.preflight()).rejects.toMatchObject({ exitCode: 2 });
    expect(docker.calls).toHaveLength(2);
    expect(harness.workspace).toBeNull();
  });

  it("returns actual prerequisite exit 2 from main without running scenarios", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const docker = fakeDocker(createE2EConfiguration({}), { missing: true });
    expect(await main({ source: {}, run: docker.run })).toBe(2);
    expect(docker.calls.some(({ command }) => ["build", "network", "container"].includes(commandArgs(command)[0]))).toBe(false);
  });

  it("uses only empty explicit env files and isolated Docker config, never implicit Compose builds/pulls", async () => {
    const configuration = createE2EConfiguration({});
    const { harness, docker } = fixtureHarness(configuration);
    await harness.preflight();
    const workspace = harness.workspace!;
    expect(readFileSync(workspace.envFile, "utf8")).toBe("");
    expect(JSON.parse(readFileSync(path.join(workspace.dockerConfig, "config.json"), "utf8"))).toEqual({ auths: {}, cliPluginsExtraDirs: [docker.pluginDirectory] });
    expect(() => e2eComposePluginDirectory([{ Name: "compose", Path: process.execPath }])).toThrow(/locally installed/);
    expect(() => e2eComposePluginDirectory([{ Name: "compose", Path: "relative/docker-compose" }])).toThrow(/locally installed/);
    const project = createE2EProject(configuration, "args");
    for (const operation of [["up", "-d", "app"], ["run", "--rm", "migrate"], ["exec", "-T", "app", "node", "script.mjs"], ["ps"], ["port", "app", "3000"], ["logs", "app"], ["stop", "app"], ["start", "db"], ["config", "--quiet"]]) {
      const args = e2eComposeArgs(root, workspace, project, operation);
      expect(args[args.indexOf("--env-file") + 1]).toBe(workspace.envFile);
      expect(args).not.toContain("--build");
      if (["up", "run"].includes(operation[0])) expect(args).toContain("--pull=never");
      if (operation[0] === "up") expect(args).toContain("--no-build");
    }
    for (const dangerous of [["pull"], ["down", "--rmi", "local"], ["up", "--build"], ["up", "--pull=always"], ["--env-file", ".env", "config"]]) expect(() => e2eComposeArgs(root, workspace, project, dangerous)).toThrow();
    const composeCalls = docker.calls.filter(({ command }) => commandArgs(command)[0] === "compose");
    expect(composeCalls.every(({ command }) => command.args.includes(workspace.dockerConfig))).toBe(true);
    expect(composeCalls.every(({ command }) => command.args.includes(workspace.envFile))).toBe(true);
    writeFileSync(workspace.envFile, "DATABASE_URL=foreign");
    expect(() => e2eComposeArgs(root, workspace, project, ["config"])).toThrow(/empty/);
  });

  it("builds with inspected immutable local bases and preserves a real nonzero build exit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const configuration = createE2EConfiguration({});
    const { harness, docker } = fixtureHarness(configuration, fakeDocker(configuration, { buildCode: 37 }));
    await harness.preflight();
    await expect(harness.buildImages()).rejects.toMatchObject({ exitCode: 37 });
    const build = docker.calls.find(({ command }) => commandArgs(command)[0] === "build")!.command;
    expect(build.args).toContain("--pull=false");
    expect(build.args).toContain("--force-rm");
    expect(build.args).toContain(`NODE_BASE_IMAGE=${imageId}`);
    expect(build.args).toContain(`GO_BASE_IMAGE=${imageId}`);
    expect(build.env?.DOCKER_BUILDKIT).toBe("0");
    expect(build.args).toContain(`${E2E_OWNER_LABEL}=${configuration.owner}`);
    expect(build.timeoutMs).toBe(600_000);
  });

  it("keeps supplied SKIP_BUILD images read-only and never cleans their tags", async () => {
    const configuration = createE2EConfiguration({ E2E_SKIP_BUILD: "1", E2E_APP_IMAGE: "local/app:checked", E2E_WORKER_IMAGE: "local/worker:checked" });
    const { harness, docker } = fixtureHarness(configuration);
    await harness.preflight();
    await harness.buildImages();
    expect(await harness.cleanup(Date.now() + 5_000)).toBe(true);
    expect(docker.calls.some(({ command }) => commandArgs(command)[0] === "build" || commandArgs(command).slice(0, 2).join(" ") === "image rm")).toBe(false);
  });

  it("preserves the original failure when final cleanup fails and keeps an independent cleanup reserve", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(E2EHarness.prototype, "preflight").mockResolvedValue(undefined);
    vi.spyOn(E2EHarness.prototype, "buildImages").mockRejectedValue(Object.assign(new Error("build failed"), { exitCode: 37 }));
    let cleanupBudget = 0;
    const cleanup = vi.spyOn(E2EHarness.prototype, "cleanup").mockImplementation(async function (this: E2EHarness, deadlineAt: number) {
      cleanupBudget = deadlineAt - this.deadlineAt;
      return false;
    });
    const run = vi.fn(async () => { throw new Error("No actual Docker command is allowed"); });
    expect(await main({ source: {}, run })).toBe(37);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanupBudget).toBe(E2E_LIMITS.cleanupMs);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("exact E2E resource cleanup and readiness contracts", () => {
  it("executes only exact verified ID cleanup with a finite shared deadline", async () => {
    const { harness, project, state, calls } = resourceHarness();
    const deadlineAt = Date.now() + 15_000;
    expect(await harness.cleanupProject(project, deadlineAt)).toBe(true);
    const operations = calls.map(({ command }) => commandArgs(command));
    expect(operations.filter((args) => args[1] === "rm")).toEqual([
      ["container", "rm", "--force", id], ["network", "rm", state.network.Id],
    ]);
    const firstRemoval = operations.findIndex((args) => args[1] === "rm");
    expect(operations.slice(0, firstRemoval).some((args) => args.slice(0, 2).join(" ") === "container inspect")).toBe(true);
    expect(operations.slice(0, firstRemoval).some((args) => args.slice(0, 2).join(" ") === "network inspect")).toBe(true);
    expect(calls.every(({ command, deadlineAt: actual }) => actual === deadlineAt && Number.isFinite(command.timeoutMs))).toBe(true);
    expect(project.cleaned).toBe(true);
    expect(state.containers).toEqual([]);
    expect(state.networkPresent).toBe(false);
    const count = calls.length;
    expect(await harness.cleanupProject(project, deadlineAt)).toBe(true);
    expect(calls).toHaveLength(count);
  });

  it.each(["container-owner", "container-name", "network-owner", "network-id", "foreign-attachment"])("refuses all destructive cleanup for %s mismatch", async (mismatch) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { harness, project, state, calls } = resourceHarness();
    if (mismatch === "container-owner") state.database.Config.Labels[E2E_OWNER_LABEL] = "foreign";
    if (mismatch === "container-name") state.database.Name = "/production-db-1";
    if (mismatch === "network-owner") state.network.Labels[E2E_OWNER_LABEL] = "foreign";
    if (mismatch === "network-id") state.network.Id = "c".repeat(64);
    if (mismatch === "foreign-attachment") state.network.Containers["c".repeat(64)] = { Name: "foreign" };
    expect(await harness.cleanupProject(project, Date.now() + 15_000)).toBe(false);
    expect(calls.some(({ command }) => commandArgs(command)[1] === "rm")).toBe(false);
    expect(project.cleaned).toBe(false);
    expect(state.containers).toHaveLength(1);
    expect(state.networkPresent).toBe(true);
  });

  it("rechecks ownership on cleanup retry after a partial removal failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { harness, project, state, calls } = resourceHarness();
    state.failures.set("network rm", 42);
    expect(await harness.cleanupProject(project, Date.now() + 15_000)).toBe(false);
    expect(state.containers).toEqual([]);
    expect(project.cleaned).toBe(false);
    state.failures.clear();
    calls.length = 0;
    expect(await harness.cleanupProject(project, Date.now() + 15_000)).toBe(true);
    expect(calls.filter(({ command }) => commandArgs(command)[1] === "rm").map(({ command }) => commandArgs(command))).toEqual([["network", "rm", state.network.Id]]);
    expect(calls.some(({ command }) => commandArgs(command).slice(0, 2).join(" ") === "network inspect")).toBe(true);
  });

  it("never accesses unregistered projects or removes resources before creation was attempted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { harness, project, calls } = resourceHarness();
    const foreign = createE2EProject(harness.configuration, "unregistered");
    expect(await harness.cleanupProject(foreign, Date.now() + 15_000)).toBe(false);
    await expect(harness.checkedCompose(foreign, ["stop", "db"])).rejects.toThrow(/Unknown/);
    project.creationAttempted = false;
    expect(await harness.cleanupProject(project, Date.now() + 15_000)).toBe(true);
    await expect(harness.checkedCompose(project, ["stop", "db"])).rejects.toThrow(/not created/);
    expect(calls).toHaveLength(0);
  });

  it.each(["name", "user", "password", "image", "volume", "network"])("rejects a %s mismatch before fixture SQL is allowed", async (mismatch) => {
    const { harness, project, state } = resourceHarness();
    await expect(harness.assertDatabase(project)).resolves.toBeUndefined();
    if (mismatch === "name") state.database.Config.Env[0] = "POSTGRES_DB=production";
    if (mismatch === "user") state.database.Config.Env[1] = "POSTGRES_USER=production";
    if (mismatch === "password") state.database.Config.Env[2] = "POSTGRES_PASSWORD=production";
    if (mismatch === "image") state.database.Config.Image = "foreign/postgres:latest";
    if (mismatch === "volume") state.database.Mounts[0].Type = "volume";
    if (mismatch === "network") state.database.NetworkSettings.Networks.foreign = { NetworkID: "c".repeat(64) };
    await expect(harness.assertDatabase(project)).rejects.toThrow(/exact generated/);
  });

  it("executes lifecycle commands only after actual helper ownership checks", async () => {
    const { harness, project, calls } = resourceHarness();
    await harness.checkedCompose(project, ["stop", "db"], { timeoutMs: 5_000 });
    const operation = calls.at(-1)!.command;
    const args = commandArgs(operation);
    expect(args[0]).toBe("compose");
    expect(args.slice(-2)).toEqual(["stop", "db"]);
    expect(args[args.indexOf("--project-name") + 1]).toBe(project.name);
    expect(args[args.indexOf("--env-file") + 1]).toBe(harness.workspace!.envFile);
    expect(operation.env).toEqual(e2eComposeEnvironment(harness.configuration, project));
    expect(calls.slice(0, -1).map(({ command }) => commandArgs(command).slice(0, 2).join(" "))).toEqual(["network inspect", "container ls", "container inspect"]);
  });

  it("refuses published host ports and host networking even when resource owner labels match", async () => {
    const { harness, project, state } = resourceHarness();
    Object.assign(state.database.HostConfig, { PortBindings: { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "32000" }] } });
    await expect(harness.containers(project)).rejects.toThrow(/host ports/);
    Object.assign(state.database.HostConfig, { PortBindings: {}, NetworkMode: "host" });
    await expect(harness.containers(project)).rejects.toThrow(/host networking/);
  });

  it("rejects foreign names/owners, uncreated containers, networks and arbitrary images", () => {
    const configuration = createE2EConfiguration({});
    const project = createE2EProject(configuration, "cleanup");
    const container = { Id: id, Name: `/${project.name}-db-1`, Config: { Labels: { [E2E_OWNER_LABEL]: configuration.owner, "com.docker.compose.project": project.name, "com.docker.compose.service": "db" } } };
    expect(() => assertE2EContainer(configuration, project, container)).toThrow(/container/);
    project.creationAttempted = true;
    expect(assertE2EContainer(configuration, project, container)).toBe(id);
    expect(() => assertE2EContainer(configuration, project, { ...container, Name: "/production-db-1" })).toThrow();
    expect(() => assertE2EContainer(configuration, project, { ...container, Config: { Labels: { ...container.Config.Labels, [E2E_OWNER_LABEL]: "foreign" } } })).toThrow();
    const network = { Id: id, Name: project.networkName, Internal: true, Labels: container.Config.Labels };
    expect(assertE2ENetwork(configuration, project, network)).toBe(id);
    expect(() => assertE2ENetwork(configuration, project, { ...network, Internal: false })).toThrow();
    expect(() => assertE2ENetwork(configuration, project, { ...network, Name: "production" })).toThrow();
    const image = { Id: imageId, RepoTags: [configuration.images.app], Config: { Labels: { [E2E_OWNER_LABEL]: configuration.owner } } };
    const built = new Map([[configuration.images.app, imageId]]);
    expect(assertE2EBuiltImage(configuration, configuration.images.app, image, built)).toBe(configuration.images.app);
    expect(() => assertE2EBuiltImage(configuration, "production/app:latest", image, built)).toThrow();
    expect(() => assertE2EBuiltImage(configuration, configuration.images.app, { ...image, Id: `sha256:${"b".repeat(64)}` }, built)).toThrow();
    expect(() => assertE2EBuiltImage(configuration, configuration.images.app, image, new Map())).toThrow();
  });

  it("bounds scratch cleanup to the resolved owner-marked directory", () => {
    const workspace = createE2EWorkspace(createE2EConfiguration({}).owner);
    workspaces.push(workspace);
    expect(cleanupE2EWorkspace({ ...workspace, directory: workspace.safeParent })).toBe(false);
    expect(cleanupE2EWorkspace({ ...workspace, owner: "someone-else" })).toBe(false);
    expect(existsSync(workspace.directory)).toBe(true);
    expect(cleanupE2EWorkspace(workspace)).toBe(true);
    expect(existsSync(workspace.directory)).toBe(false);
  });

  it("uses exact capability DTOs and explicit 503 negatives, not generic health or arbitrary failures", () => {
    const ready = { status: 200, body: { status: "ready", capabilities: { canvas: capability.readyCapability } } };
    expect(matchesReadiness(ready, { canvas: true })).toBe(true);
    expect(matchesReadiness({ status: 200, body: { status: "ready" } }, { canvas: true })).toBe(false);
    expect(hasExactCanvasCapability({ capabilities: { canvas: { ...capability.readyCapability, other: true } } })).toBe(false);
    expect(matchesReadiness({ status: 503, body: { status: "not_ready", code: "CANVAS_STORAGE_CAPABILITY_INVALID" } }, { ready: false, code: "CANVAS_STORAGE_CAPABILITY_INVALID" })).toBe(true);
    expect(matchesReadiness({ status: 500, body: { status: "not_ready" } }, { ready: false })).toBe(false);
    expect(matchesReadiness({ status: 503, body: "not JSON" }, { ready: false })).toBe(false);
    expect(E2E_LIMITS.cleanupMs).toBeGreaterThanOrEqual(60_000);
    expect(E2E_SCENARIOS).toHaveLength(9);
  });

  it("keeps Compose images no-pull, no implicit builds, in-memory S3 private, and actual .env excluded from builds", () => {
    const compose = readFileSync(path.join(root, "docker-compose.e2e.yml"), "utf8");
    expect(compose).not.toMatch(/^\s+build:|^\s+env_file:/m);
    expect(compose).not.toMatch(/^\s+ports:/m);
    expect(compose.match(/pull_policy: never/g)).toHaveLength(7);
    expect(compose).toContain("external: true");
    const store = compose.split("  object-store:")[1].split("  migrate:")[0];
    expect(store).not.toContain("ports:");
    expect(store).toContain("scripts/fixtures/canvas-object-store.mjs");
    expect(compose).toContain("CANVAS_ASSET_GC_INTERVAL_SECONDS");
    expect(compose).toContain("CANVAS_ASSET_GC_BATCH_SIZE");
    const ignored = readFileSync(path.join(root, ".dockerignore"), "utf8");
    for (const name of [".env*", "**/.env*", ".npmrc", "**/.npmrc", ".trellis", ".agents", ".codex", ".claude", "narra-image-promo"]) expect(ignored.split(/\r?\n/)).toContain(name);
    const source = readFileSync(path.join(root, "scripts/lib/e2e-safety.mjs"), "utf8");
    expect(source).toContain('"--internal"');
    expect(source).not.toContain("POSITIVE_INFINITY");
    expect(source).not.toContain('"--volumes"');
    expect(source).not.toContain('"--remove-orphans"');
    const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8");
    expect(dockerfile.indexOf("ENV NEXT_TELEMETRY_DISABLED=1")).toBeGreaterThan(-1);
    expect(dockerfile.indexOf("ENV NEXT_TELEMETRY_DISABLED=1")).toBeLessThan(dockerfile.indexOf("RUN pnpm build"));
  });

  it("provisions every default base image explicitly in CI before invoking the no-pull E2E wrapper", () => {
    const workflow = readFileSync(path.join(root, ".github/workflows/verify.yml"), "utf8").split("  verify-e2e:")[1];
    const images = createE2EConfiguration({}).images;
    for (const image of [images.postgres, images.node, images.go, images.alpine]) {
      expect(workflow).toContain(`docker pull ${image}`);
      expect(workflow.indexOf(`docker pull ${image}`)).toBeLessThan(workflow.indexOf("run: pnpm verify:e2e"));
    }
    expect(workflow).not.toContain("E2E_SKIP_BUILD");
    expect(workflow).not.toContain("docker compose up");
  });
});

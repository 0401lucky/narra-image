// @vitest-environment node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../../../scripts/lib/command-runner.mjs", () => ({ runStage: mocks.run }));

import { cleanupPostgres, createPostgresResource, assertDockerPrerequisites, startPostgres } from "../../../scripts/lib/disposable-postgres.mjs";
import { cleanupLocalDockerWorkspace, LocalDockerSession } from "../../../scripts/lib/local-docker-safety.mjs";
import { prepareWorkerContractCommand } from "../integration/worker-contracts/postgres-runner";

const sessions: LocalDockerSession[] = [];
const containerId = "b".repeat(64);
const imageId = `sha256:${"a".repeat(64)}`;
const options = { scope: "mock-local-postgres", deadlineAt: Date.now() + 60_000 };
type Command = { args: string[]; env?: NodeJS.ProcessEnv; timeoutMs?: number };

function stripDockerFlags(command: Command) {
  const args = [...command.args];
  while (["--host", "--config"].includes(args[0])) args.splice(0, 2);
  return args;
}

function postgresFixture({ endpoint = "unix:///var/run/docker.sock", missing = false } = {}) {
  const resource = createPostgresResource({ prefix: "narra-canvas-contracts-", ownerLabelKey: "com.narra.canvas-contracts.owner", databaseUser: "narra_canvas" });
  let present = false;
  const state: { owner: string; id: string; endpoint: string } = { owner: resource.ownerToken, id: containerId, endpoint };
  mocks.run.mockImplementation(async (command: Command) => {
    const args = stripDockerFlags(command);
    let stdout = "";
    let code = 0;
    if (args.join(" ") === "context show") stdout = "local-fixture";
    else if (args[0] === "context" && args[1] === "inspect") stdout = JSON.stringify(state.endpoint);
    else if (args[0] === "--version") stdout = "Docker version 29.0.0";
    else if (args[0] === "info") stdout = args.includes("{{.OSType}} {{.ServerVersion}}") ? "linux 29.0.0" : "29.0.0";
    else if (args[0] === "image" && args[1] === "inspect") { code = missing ? 1 : 0; stdout = missing ? "" : imageId; }
    else if (args[0] === "container" && args[1] === "ls") stdout = present ? state.id : "";
    else if (args[0] === "run") { present = true; stdout = state.id; }
    else if (args[0] === "container" && args[1] === "inspect") {
      const format = args[args.indexOf("--format") + 1];
      if (format === "{{json .}}") stdout = JSON.stringify({ Id: state.id, Name: `/${resource.containerName}`, Config: { Labels: { [resource.ownerLabelKey]: state.owner } } });
      else if (format.includes(".Config.Labels")) stdout = state.owner;
      else if (format === "{{json .Mounts}}") stdout = JSON.stringify([{ Type: "tmpfs" }]);
      else if (format === "{{json .HostConfig.Tmpfs}}") stdout = JSON.stringify({ "/var/lib/postgresql/data": "rw,noexec,nosuid" });
      else if (format.includes("HostPort")) stdout = "19001";
      else throw new Error(`Unexpected fake inspection: ${format}`);
    } else if (args[0] === "container" && args[1] === "rm") present = false;
    else throw new Error(`No real Docker command is allowed: ${args.join(" ")}`);
    return { code, stdout, stderr: missing && code ? "missing local image" : "", timedOut: false, signal: null, durationMs: 1 };
  });
  return { resource, state };
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => {
  for (const session of sessions.splice(0)) expect(session.cleanup()).toBe(true);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("shared local Docker session", () => {
  it("applies the same pin/config guard at the standalone worker runner's actual command boundary", async () => {
    const session = new LocalDockerSession({ PATH: "fixture-path", DOCKER_HOST: "ssh://production" });
    sessions.push(session);
    const spec = { executable: "docker", args: ["exec", containerId, "pg_isready"], label: "Worker DB readiness", env: { NODE_ENV: "test" as const, DOCKER_CONTEXT: "production", NODE_OPTIONS: "--require=private-hook" } };
    expect(() => prepareWorkerContractCommand(spec, session)).toThrow(/pinned/);
    await session.pin(async (args: string[]) => args[1] === "show" ? "fixture" : JSON.stringify("unix:///var/run/docker.sock"));
    expect(() => prepareWorkerContractCommand(spec, session)).toThrow(/preflight/);
    session.prepare();
    expect(prepareWorkerContractCommand(spec, session)).toEqual({ ...spec,
      args: ["--host", "unix:///var/run/docker.sock", "--config", session.workspace!.dockerConfig, ...spec.args],
      env: { PATH: "fixture-path" },
    });
    const nonDocker = { executable: "go", args: ["version"], label: "Go", env: { NODE_ENV: "test" as const, GOCACHE: "isolated-cache" } };
    expect(prepareWorkerContractCommand(nonDocker, session)).toBe(nonDocker);
  });

  it.each(["ssh://production", "tcp://127.0.0.1:2375", "npipe:////remote/pipe/docker", "unix:///tmp/../other.sock", null])("rejects %s before any daemon/mutation command", async (endpoint) => {
    const session = new LocalDockerSession({ PATH: "fixture-path", DOCKER_HOST: "ssh://production" });
    sessions.push(session);
    const probe = vi.fn(async (args: string[]) => args[1] === "show" ? "fixture" : JSON.stringify(endpoint));
    await expect(session.pin(probe)).rejects.toMatchObject({ exitCode: 2 });
    expect(session.workspace).toBeNull();
    expect(() => session.command(["run", "postgres:17-alpine"])).toThrow(/pinned/);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("pins commands independently of subsequent context/env changes and strips private ambient configuration", async () => {
    const session = new LocalDockerSession({ PATH: "fixture-path", HOME: "fixture-home", DOCKER_HOST: "ssh://production", DOCKER_CONTEXT: "production", DOCKER_CONFIG: "private-config", HTTPS_PROXY: "private-proxy", NODE_OPTIONS: "--require=private-hook" });
    sessions.push(session);
    await session.pin(async (args: string[]) => args[1] === "show" ? "fixture" : JSON.stringify("unix:///var/run/docker.sock"));
    expect(() => session.command(["run", "postgres:17-alpine"])).toThrow(/preflight/);
    session.prepare();
    vi.stubEnv("DOCKER_CONTEXT", "production");
    vi.stubEnv("DOCKER_HOST", "ssh://production");
    const command = session.command(["container", "ls"], { DOCKER_CONTEXT: "production", HTTP_PROXY: "private-proxy", POSTGRES_DB: "fixture" });
    expect(command.args).toEqual(["--host", "unix:///var/run/docker.sock", "--config", session.workspace!.dockerConfig, "container", "ls"]);
    expect(command.env).toEqual({ PATH: "fixture-path", HOME: "fixture-home", POSTGRES_DB: "fixture" });
    expect(JSON.parse(readFileSync(path.join(session.workspace!.dockerConfig, "config.json"), "utf8"))).toEqual({ auths: {} });
    await expect(session.pin(async () => "production")).rejects.toThrow(/already pinned/);
    expect(() => session.command(["--context", "production", "info"])).toThrow(/override/);
  });

  it("refuses altered config or scratch owner and never broadens cleanup", async () => {
    const session = new LocalDockerSession({});
    sessions.push(session);
    await session.pin(async (args: string[]) => args[1] === "show" ? "fixture" : JSON.stringify("unix:///var/run/docker.sock"));
    session.prepare();
    const workspace = session.workspace!;
    const config = path.join(workspace.dockerConfig, "config.json");
    writeFileSync(config, JSON.stringify({ auths: { private: {} }, proxies: { default: {} } }));
    expect(() => session.command(["container", "rm", containerId])).toThrow(/empty/);
    expect(cleanupLocalDockerWorkspace({ ...workspace, owner: "foreign-owner" })).toBe(false);
    expect(cleanupLocalDockerWorkspace({ ...workspace, directory: workspace.safeParent })).toBe(false);
    expect(existsSync(workspace.directory)).toBe(true);
  });
});

describe("PostgreSQL wrapper uses the shared local Docker boundary", () => {
  it("refuses a remote active context before daemon/images/container mutation", async () => {
    const { resource } = postgresFixture({ endpoint: "ssh://production" });
    await expect(assertDockerPrerequisites(resource, options)).rejects.toMatchObject({ exitCode: 2 });
    expect(mocks.run.mock.calls.map(([command]) => stripDockerFlags(command))).toEqual([
      ["context", "show"], ["context", "inspect", "local-fixture", "--format", "{{json .Endpoints.docker.Host}}"],
    ]);
    expect(resource.creationAttempted).toBe(false);
    expect(await cleanupPostgres(resource, options)).toBe(true);
  });

  it("missing local images never create scratch or resources and every daemon probe is pinned", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { resource } = postgresFixture({ missing: true });
    await expect(assertDockerPrerequisites(resource, options)).rejects.toMatchObject({ exitCode: 2 });
    const calls = mocks.run.mock.calls.map(([command]) => command as Command);
    expect(calls.every((command) => ["context", "--version", "info", "image"].includes(stripDockerFlags(command)[0]))).toBe(true);
    expect(calls.filter((command) => stripDockerFlags(command)[0] !== "context").every((command) => command.args[0] === "--host")).toBe(true);
    expect(resource.creationAttempted).toBe(false);
    expect(await cleanupPostgres(resource, options)).toBe(true);
  });

  it("retains pinned host/config through a context switch and cleans only the exact owner-verified container ID", async () => {
    const { resource, state } = postgresFixture();
    try {
      await assertDockerPrerequisites(resource, options);
      state.endpoint = "ssh://production";
      vi.stubEnv("DOCKER_HOST", state.endpoint);
      await startPostgres(resource, options);
      expect(await cleanupPostgres(resource, options)).toBe(true);
      const calls = mocks.run.mock.calls.map(([command]) => command as Command);
      const mutation = calls.filter((command) => ["run", "container"].includes(stripDockerFlags(command)[0]));
      expect(mutation.every((command) => command.args[0] === "--host" && command.args[1] === "unix:///var/run/docker.sock" && command.args.includes("--config"))).toBe(true);
      expect(mutation.every((command) => !command.env?.DOCKER_HOST)).toBe(true);
      expect(calls.filter((command) => stripDockerFlags(command)[1] === "rm").map(stripDockerFlags)).toEqual([["container", "rm", "--force", containerId]]);
    } finally { await cleanupPostgres(resource, options); }
  });

  it("refuses cleanup after the exact container identity/owner changes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { resource, state } = postgresFixture();
    try {
      await assertDockerPrerequisites(resource, options);
      await startPostgres(resource, options);
      state.owner = "foreign-owner";
      expect(await cleanupPostgres(resource, options)).toBe(false);
      expect(mocks.run.mock.calls.some(([command]) => stripDockerFlags(command)[1] === "rm")).toBe(false);
    } finally {
      state.owner = resource.ownerToken;
      await cleanupPostgres(resource, options);
    }
  });
});

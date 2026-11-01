import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SYSTEM_KEYS = [
  "PATH", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "TEMP", "TMP",
  "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH",
];

function failure(message) { return Object.assign(new Error(message), { exitCode: 2 }); }
const samePath = (left, right) => process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;

/** @param {Record<string, string | undefined>} [source] */
export function localDockerSystemEnvironment(source = process.env) {
  /** @type {NodeJS.ProcessEnv} */
  const result = {};
  for (const key of SYSTEM_KEYS) {
    const sourceKey = Object.keys(source).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (sourceKey && typeof source[sourceKey] === "string") result[key] = source[sourceKey];
  }
  return result;
}

export function assertLocalDockerEndpoint(endpoint) {
  const pipe = typeof endpoint === "string" && /^npipe:\/{4}\.\/pipe\/[a-zA-Z0-9_.-]+$/.test(endpoint);
  const socket = typeof endpoint === "string" && /^unix:\/\/\/[a-zA-Z0-9/_. -]+$/.test(endpoint) && !endpoint.split("/").includes("..");
  if (!pipe && !socket) throw failure("Verification requires a local unix socket or local Windows named pipe; remote Docker contexts are refused");
  return endpoint;
}

export async function resolveLocalDockerEndpoint(probe) {
  const context = await probe(["context", "show"], "Inspect active Docker context");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(context)) throw failure("Invalid Docker context name");
  let endpoint;
  try { endpoint = JSON.parse(await probe(["context", "inspect", context, "--format", "{{json .Endpoints.docker.Host}}"], "Inspect Docker context endpoint")); }
  catch { throw failure("Cannot verify the local Docker context endpoint"); }
  return assertLocalDockerEndpoint(endpoint);
}

export function createLocalDockerWorkspace(owner, parent = tmpdir(), composePluginDirectory = null, prefix = "narra-local-docker-") {
  if (!["narra-local-docker-", "narra-e2e-"].includes(prefix)) throw failure("Unsafe local Docker scratch prefix");
  const safeParent = realpathSync(path.resolve(parent));
  const directory = mkdtempSync(path.join(safeParent, prefix));
  const envFile = path.join(directory, "empty.env");
  const dockerConfig = path.join(directory, "docker");
  writeFileSync(path.join(directory, "owner.json"), JSON.stringify({ owner }), { flag: "wx", mode: 0o600 });
  writeFileSync(envFile, "", { flag: "wx", mode: 0o600 });
  mkdirSync(dockerConfig);
  writeFileSync(path.join(dockerConfig, "config.json"), `${JSON.stringify({ auths: {}, ...(composePluginDirectory ? { cliPluginsExtraDirs: [composePluginDirectory] } : {}) })}\n`, { flag: "wx", mode: 0o600 });
  return Object.freeze({ owner, safeParent, directory, envFile, dockerConfig });
}

function assertWorkspaceOwner(workspace) {
  const target = path.resolve(workspace.directory);
  if (!samePath(path.dirname(target), workspace.safeParent) || !/^narra-(?:e2e|local-docker)-[a-zA-Z0-9]+$/.test(path.basename(target))
    || lstatSync(target).isSymbolicLink() || !samePath(realpathSync(target), target)
    || JSON.parse(readFileSync(path.join(target, "owner.json"), "utf8")).owner !== workspace.owner) throw failure("Local Docker scratch ownership mismatch");
  return target;
}

export function cleanupLocalDockerWorkspace(workspace) {
  if (!workspace) return true;
  const target = path.resolve(workspace.directory);
  if (!samePath(path.dirname(target), workspace.safeParent) || !/^narra-(?:e2e|local-docker)-[a-zA-Z0-9]+$/.test(path.basename(target))) return false;
  if (!existsSync(target)) return true;
  try {
    assertWorkspaceOwner(workspace);
    rmSync(target, { recursive: true, force: true });
    return !existsSync(target);
  } catch { return false; }
}

export class LocalDockerSession {
  /** @param {Record<string, string | undefined>} [source] */
  constructor(source = process.env) {
    this.env = Object.freeze(localDockerSystemEnvironment(source));
    this.owner = randomUUID();
    this.endpoint = null;
    this.workspace = null;
  }

  async pin(probe) {
    if (this.endpoint !== null) throw failure("Docker endpoint is already pinned for this run");
    this.endpoint = await resolveLocalDockerEndpoint(probe);
  }

  prepare() {
    if (!this.endpoint || this.workspace) throw failure("A pinned local Docker endpoint and fresh workspace are required");
    this.workspace = createLocalDockerWorkspace(this.owner);
  }

  command(args, extra = {}) {
    if (!this.endpoint) {
      const contextRead = args.length === 2 && args[0] === "context" && args[1] === "show"
        || args.length === 5 && args[0] === "context" && args[1] === "inspect" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(args[2]) && args[3] === "--format" && args[4] === "{{json .Endpoints.docker.Host}}";
      if (!contextRead) throw failure("Docker operations require a verified, pinned local endpoint");
      return { args: [...args], env: { ...this.env } };
    }
    assertLocalDockerEndpoint(this.endpoint);
    if (!["--version", "info", "image", "container", "run", "exec"].includes(args[0])) throw failure("Unsupported local Docker operation or endpoint override");
    const prefix = ["--host", this.endpoint];
    if (this.workspace) {
      assertWorkspaceOwner(this.workspace);
      const config = path.join(this.workspace.dockerConfig, "config.json");
      if (this.workspace.owner !== this.owner || this.workspace.dockerConfig !== path.join(this.workspace.directory, "docker")
        || lstatSync(this.workspace.dockerConfig).isSymbolicLink() || !samePath(realpathSync(this.workspace.dockerConfig), this.workspace.dockerConfig)
        || lstatSync(config).isSymbolicLink() || !samePath(realpathSync(config), config)
        || JSON.stringify(JSON.parse(readFileSync(config, "utf8"))) !== '{"auths":{}}') throw failure("An empty runner-owned Docker config is required");
      prefix.push("--config", this.workspace.dockerConfig);
    } else if (!(args[0] === "--version" || args[0] === "info" || (args[0] === "image" && args[1] === "inspect"))) {
      throw failure("Docker mutation requires completed local preflight and isolated config");
    }
    const env = { ...this.env };
    for (const key of ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"]) if (typeof extra[key] === "string") env[key] = extra[key];
    return { args: [...prefix, ...args], env };
  }

  cleanup() { return cleanupLocalDockerWorkspace(this.workspace); }
}

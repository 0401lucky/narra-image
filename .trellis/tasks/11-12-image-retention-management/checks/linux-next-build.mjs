import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, readdirSync, readSync, realpathSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Invoked only by isolated.py in its frozen, credential-denied source copy.
// No installation, build, artifact replacement or Docker access occurs on import.
const CHECKS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(CHECKS, "../../../..");
const OWNER_KIND = "image-storage-foundation-local-v1";
const ARTIFACT_KIND = "image-retention-linux-next-artifact-v1";
const LABEL = "com.narra.c2-next.owner";
const SOURCE_LABEL = "com.narra.c2-next.source";
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const RESOURCE_ID = /^[a-f0-9]{64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_FILES = 30_000;
const MAX_BYTES = 2 * 1024 ** 3;
const BUILD_NODE_OPTIONS = "--max-old-space-size=1536 --max-semi-space-size=8";
const WORK_MS = 1_320_000;
const CLEANUP_MS = 90_000;
const keepBuilder = process.argv.slice(2).includes("--keep-builder");
const same = (left, right) => process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const demand = (condition, message) => { if (!condition) throw Object.assign(new Error(message), { exitCode: 2 }); };

function real(target, directory = false) {
  const absolute = path.resolve(target);
  const info = lstatSync(absolute);
  demand(!info.isSymbolicLink() && (directory ? info.isDirectory() : info.isFile())
    && same(realpathSync(absolute), absolute), "Expected an exact, non-linked owned path");
  return absolute;
}

function inside(base, relative) {
  demand(typeof relative === "string" && relative.length > 0 && !/[\\:\x00-\x1f]/.test(relative)
    && relative.split("/").every((part) => part && part !== "." && part !== ".."), "Unsafe manifest path");
  const target = path.resolve(base, ...relative.split("/"));
  demand(same(path.dirname(target), base) || same(target.slice(0, base.length + 1), `${base}${path.sep}`), "Manifest path escaped its root");
  return target;
}

function digest(target, deadlineAt) {
  demand(Date.now() < deadlineAt, "File hashing exceeded the independent deadline");
  real(target);
  const hash = createHash("sha256");
  const block = Buffer.allocUnsafe(1024 * 1024);
  const fd = openSync(target, "r");
  let bytes = 0;
  try {
    let count;
    while ((count = readSync(fd, block, 0, block.length, null)) > 0) {
      bytes += count;
      demand(bytes <= MAX_BYTES && Date.now() < deadlineAt, "File hashing exceeded its byte/time bound");
      hash.update(block.subarray(0, count));
    }
  } finally { closeSync(fd); }
  return { bytes, sha256: hash.digest("hex") };
}

function recordsHash(records) {
  return sha(JSON.stringify(Object.keys(records).sort().map((name) => [name, records[name].bytes, records[name].sha256])));
}

function jsonFile(target) {
  real(target);
  demand(lstatSync(target).size <= 16 * 1024 * 1024, "JSON metadata exceeded its bound");
  return JSON.parse(readFileSync(target, "utf8"));
}

// The shared runner settles on process exit. This one potentially large JSON
// response must drain through close, with explicit stdout/stderr byte limits.
async function captureAtClose(command, deadlineAt, terminateProcessTree) {
  const started = Date.now();
  const timeoutMs = Math.min(command.timeoutMs, deadlineAt - started);
  if (timeoutMs <= 0) return { code: 124, timedOut: true, stdout: "", stderr: "Inspector deadline expired", durationMs: 0 };
  console.log(`[c2:linux-next] ${command.label}: start`);
  const result = await new Promise((resolve) => {
    const child = spawn(command.executable, command.args, { cwd: command.cwd, env: command.env,
      detached: process.platform !== "win32", windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputLimited = false;
    let spawnError;
    const timer = setTimeout(() => { timedOut = true; terminateProcessTree(child); }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= 16 * 1024 * 1024) stdout.push(chunk);
      else if (!outputLimited) { outputLimited = true; terminateProcessTree(child); }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 1024 * 1024) stderr.push(chunk);
      else if (!outputLimited) { outputLimited = true; terminateProcessTree(child); }
    });
    child.stdin.on("error", () => { /* The actual close/exit status owns failure. */ });
    child.once("error", (error) => { spawnError = error.message; });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? 124 : outputLimited ? 2 : (code ?? 2), signal, timedOut, outputLimited,
        durationMs: Date.now() - started, stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: [Buffer.concat(stderr).toString("utf8"), spawnError, outputLimited ? "Inspector output limit exceeded" : ""].filter(Boolean).join("\n") });
    });
    child.stdin.end(command.input);
  });
  console.log(`[c2:linux-next] ${command.label}: close; exit=${result.code}; duration_ms=${result.durationMs}`);
  return result;
}

function snapshot(ownerRoot, deadlineAt) {
  const manifestPath = real(path.join(ownerRoot, "source-manifest.json"));
  const manifest = jsonFile(manifestPath);
  demand(manifest.files && typeof manifest.files === "object" && !Array.isArray(manifest.files), "Missing frozen source manifest");
  const names = Object.keys(manifest.files).sort();
  demand(names.length > 0 && names.length <= MAX_FILES, "Invalid frozen source file count");
  const records = {};
  let total = 0;
  for (const name of names) {
    const filename = path.posix.basename(name).toLowerCase();
    demand(!(filename === ".env" || filename.startsWith(".env.")) || name === ".env.example", "A private dotenv file entered the source manifest");
    demand(![".npmrc", ".pnpmrc", ".netrc", ".pypirc", ".yarnrc", ".yarnrc.yml", "credentials"].includes(filename)
      && !/\.(pem|key|pfx|p12)$/i.test(filename), "A credential file entered the source manifest");
    const record = manifest.files[name];
    demand(SHA256.test(record.sha256 ?? "") && Number.isSafeInteger(record.bytes) && record.bytes >= 0, "Invalid frozen source hash");
    const actual = digest(inside(ROOT, name), deadlineAt);
    demand(actual.sha256 === record.sha256 && actual.bytes === record.bytes, `Frozen source does not match its manifest: ${name}`);
    total += actual.bytes;
    demand(total <= MAX_BYTES, "Frozen source exceeded its byte bound");
    records[name] = actual;
  }
  const runtime = path.join(path.resolve(manifest.sourceRoot), ".trellis/tasks/11-12-image-storage-foundation/checks/.runtime");
  demand(same(real(runtime, true), path.dirname(ownerRoot)), "Owner root is outside the source project's task runtime");
  demand(records[".trellis/tasks/11-12-image-retention-management/checks/linux-next-build.mjs"], "The helper must be part of the frozen manifest");
  return { manifestPath, manifestSha256: digest(manifestPath, deadlineAt).sha256, capturedAt: manifest.capturedAt,
    fileCount: names.length, bytes: total, treeSha256: recordsHash(records), records };
}

function transformedDockerfile(original) {
  const match = [...original.matchAll(/^RUN pnpm build\r?$/gm)];
  demand(match.length === 1 && original.includes("FROM base AS builder") && original.includes("COPY . .")
    && match[0].index > original.indexOf("FROM base AS builder")
    && match[0].index < original.indexOf("FROM ${GO_BASE_IMAGE} AS worker-builder"), "Re-audit the original production builder stage");
  const replacement = `RUN CIRCLE_NODE_TOTAL=2 NODE_OPTIONS="${BUILD_NODE_OPTIONS}" pnpm build`;
  return original.slice(0, match[0].index) + replacement + (match[0][0].endsWith("\r") ? "\r" : "")
    + original.slice(match[0].index + match[0][0].length);
}

function createContext(workspace, source, deadlineAt) {
  const context = path.join(workspace.directory, "context");
  mkdirSync(context);
  const records = {};
  for (const [name, record] of Object.entries(source.records)) {
    // The real .dockerignore excludes all assistant/task metadata. Keeping it
    // outside COPY also prevents this run's reports from entering the image.
    if (name.startsWith(".trellis/")) continue;
    const from = inside(ROOT, name);
    const to = inside(context, name);
    mkdirSync(path.dirname(to), { recursive: true });
    if (name === "Dockerfile") {
      const text = transformedDockerfile(readFileSync(from, "utf8"));
      writeFileSync(to, text, { flag: "wx" });
      records[name] = { bytes: Buffer.byteLength(text), sha256: sha(text) };
    } else {
      copyFileSync(from, to, constants.COPYFILE_EXCL);
      records[name] = record;
    }
    // The host deny-env preload permits only the ORIGINAL copied public
    // example. Do not widen it for this second copy; verify that copy in the
    // read-only Linux inspector after Docker has consumed the context.
    if (name !== ".env.example") demand(digest(to, deadlineAt).sha256 === records[name].sha256, "Build context copy hash mismatch");
  }
  const ignore = readFileSync(path.join(context, ".dockerignore"), "utf8").split(/\r?\n/);
  for (const pattern of [".trellis", ".env*", "**/.env*", "!.env.example", ".npmrc", ".pnpmrc", "**/.npmrc", "**/.pnpmrc", ".next", "**/.next", "node_modules", "**/node_modules"]) {
    demand(ignore.includes(pattern), "Re-audit credential/build-output exclusions in the original .dockerignore");
  }
  const pkg = jsonFile(path.join(context, "package.json"));
  demand(pkg.scripts?.build === "prisma generate && next build" && pkg.packageManager === "pnpm@10.32.1"
    && pkg.dependencies?.next === "16.2.4", "Re-audit the complete production build command and pinned toolchain");
  return { directory: context, records, treeSha256: recordsHash(records) };
}

// This fixed program runs in one owned, read-only, network=none container. It
// reads files only: it never starts Next or runs application code. The bounded
// stdin carries expected source hashes, not environment values or credentials.
function inspectLinuxBuild() {
  const fs = require("node:fs");
  const crypto = require("node:crypto");
  const path = require("node:path");
  const deadline = Date.now() + 60_000;
  const maximum = 2 * 1024 ** 3;
  const insist = (ok, message) => { if (!ok) throw new Error(message); };
  const hashFile = (name) => {
    const info = fs.lstatSync(name);
    insist(info.isFile() && !info.isSymbolicLink() && info.size <= maximum, "Non-regular/oversized inspection input");
    const fd = fs.openSync(name, "r");
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0;
    try {
      let count;
      while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
        bytes += count;
        insist(Date.now() < deadline && bytes <= maximum, "Inspection deadline/byte limit");
        hash.update(buffer.subarray(0, count));
      }
    } finally { fs.closeSync(fd); }
    return { bytes, sha256: hash.digest("hex") };
  };
  const chunks = [];
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let inputBytes = 0;
  let count;
  while ((count = fs.readSync(0, buffer, 0, buffer.length, null)) > 0) {
    inputBytes += count;
    insist(inputBytes <= 8 * 1024 * 1024 && Date.now() < deadline, "Inspection input bound");
    chunks.push(Buffer.from(buffer.subarray(0, count)));
  }
  const inputs = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  insist(process.platform === "linux" && process.version === "v24.22.1", "Unexpected Linux Node runtime");
  const generatedSource = {};
  for (const [name, expected] of Object.entries(inputs)) {
    insist(!name.startsWith("/") && !name.split("/").includes(".."), "Unsafe input path");
    const actual = hashFile(path.join("/app", name));
    // Next owns this generated type reference. Its Linux build value is
    // recorded; all other copied product/config/dependency inputs must match.
    if (name === "next-env.d.ts") generatedSource[name] = actual;
    else insist(actual.sha256 === expected.sha256 && actual.bytes === expected.bytes, `Image input changed: ${name}`);
  }
  const nextPackage = JSON.parse(fs.readFileSync("/app/node_modules/next/package.json", "utf8"));
  insist(nextPackage.version === "16.2.4", "Unexpected installed Next version");
  insist(fs.readFileSync("/app/node_modules/next/dist/server/config-shared.js", "utf8").includes("Number(process.env.CIRCLE_NODE_TOTAL)"), "Re-audit Next's build concurrency setting");
  const required = JSON.parse(fs.readFileSync("/app/.next/required-server-files.json", "utf8"));
  insist(required.config?.typescript?.ignoreBuildErrors === false && required.config?.experimental?.cpus === 1, "Unexpected production build type/concurrency settings");
  const files = {};
  const seen = new Set();
  let bytes = 0;
  function walk(directory, prefix = "") {
    for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (!prefix && item.name === "cache") continue;
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      insist(!/[\\:\x00-\x1f]/.test(name) && !/[ .]$/.test(item.name)
        && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(item.name), "Nonportable artifact path");
      const target = path.join(directory, item.name);
      insist(!item.isSymbolicLink() && fs.realpathSync(target) === target && Date.now() < deadline, "Linked/expired artifact inspection");
      if (item.isDirectory()) walk(target, name);
      else {
        insist(item.isFile() && !seen.has(name.toLowerCase()), "Non-regular/colliding artifact path");
        seen.add(name.toLowerCase());
        files[name] = { ...hashFile(target), mtimeNs: fs.lstatSync(target, { bigint: true }).mtimeNs.toString() };
        bytes += files[name].bytes;
        insist(seen.size <= 30_000 && bytes <= maximum, "Artifact inventory bound");
      }
    }
  }
  walk("/app/.next");
  for (const name of ["BUILD_ID", "build-manifest.json", "routes-manifest.json", "prerender-manifest.json", "required-server-files.json", "server/app-paths-manifest.json"]) insist(files[name], `Missing completed build output: ${name}`);
  insist(Object.keys(files).some((name) => name.startsWith("static/")) && Object.keys(files).some((name) => name.startsWith("server/app/")), "Missing runtime bundles");
  const buildId = fs.readFileSync("/app/.next/BUILD_ID", "utf8").trim();
  insist(/^[a-zA-Z0-9_-]{1,128}$/.test(buildId), "Invalid BUILD_ID");
  process.stdout.write(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    next: nextPackage.version, buildId, files, bytes, generatedSource, inputFilesVerified: Object.keys(inputs).length,
    excluded: ["cache"], topLevel: fs.readdirSync("/app/.next").filter((name) => name !== "cache").sort(),
    nativeFiles: Object.keys(files).filter((name) => /\.(node|dll|so|dylib)$/i.test(name)),
    typescriptIgnoreBuildErrors: false, buildCpus: required.config.experimental.cpus }));
}

function artifactOwner(directory, ownerRoot, runOwner, source) {
  real(directory, true);
  demand(same(path.dirname(directory), real(path.join(ownerRoot, "temp"), true))
    && /^narra-c2-next-[a-zA-Z0-9]+$/.test(path.basename(directory)), "Artifact directory escaped its owner");
  const marker = jsonFile(path.join(directory, "owner.json"));
  demand(marker.kind === ARTIFACT_KIND && marker.owner === runOwner && same(marker.workspace, ROOT)
    && marker.sourceManifestSha256 === source.manifestSha256, "Artifact owner mismatch");
}

function verifyArtifact(directory, expected, deadlineAt) {
  const actual = {};
  const mtimeCounts = {};
  const timeResolution = (sourceNs, copiedNs) => {
    if (sourceNs === copiedNs) return "exact";
    for (const [unit, label] of [[100n, "100ns"], [1_000_000n, "1ms"], [1_000_000_000n, "1s"]]) {
      if (copiedNs === sourceNs / unit * unit) return `truncated-${label}`;
      if (copiedNs === (sourceNs + unit / 2n) / unit * unit) return `rounded-${label}`;
    }
    throw Object.assign(new Error("Artifact mtime changed beyond declared filesystem/tar precision loss"), { exitCode: 2 });
  };
  const visit = (current, prefix = "") => {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      const target = inside(directory, name);
      demand(!item.isSymbolicLink(), "Exported artifact contains a link");
      if (item.isDirectory()) { real(target, true); visit(target, name); }
      else {
        demand(item.isFile() && expected[name], "Unexpected exported artifact file");
        actual[name] = { ...digest(target, deadlineAt), mtimeNs: lstatSync(target, { bigint: true }).mtimeNs.toString() };
        demand(actual[name].sha256 === expected[name].sha256 && actual[name].bytes === expected[name].bytes, "Exported artifact hash mismatch");
        const resolution = timeResolution(BigInt(expected[name].mtimeNs), BigInt(actual[name].mtimeNs));
        actual[name].mtimeComparison = resolution;
        mtimeCounts[resolution] = (mtimeCounts[resolution] ?? 0) + 1;
      }
    }
  };
  real(directory, true);
  visit(directory);
  demand(Object.keys(actual).length === Object.keys(expected).length && !existsSync(path.join(directory, "cache")), "Incomplete or cache-contaminated artifact export");
  return { treeSha256: recordsHash(actual), files: actual, mtimeCounts,
    mtimePolicy: "Exact, or subsecond precision reduction to 100ns/1ms/1s by truncation or nearest rounding; no timestamp writes" };
}

async function main() {
  demand(process.argv.slice(2).every((arg, index) => arg === "--keep-builder" && index === 0), "Only --keep-builder is supported");
  demand(process.version === "v24.22.1" && same(real(ROOT, true), path.resolve(process.cwd()))
    && same(ROOT, path.resolve(process.env.NARRA_CHECK_ROOT ?? "__missing__")), "Run this helper through isolated.py in the frozen workspace");
  const ownerRoot = real(path.dirname(ROOT), true);
  const parentOwner = jsonFile(path.join(ownerRoot, "owner.json"));
  demand(parentOwner.kind === OWNER_KIND && /^[a-f0-9]{24}$/.test(parentOwner.token ?? "")
    && same(path.resolve(parentOwner.workspace), ROOT) && same(real(parentOwner.node), real(process.execPath))
    && same(path.resolve(process.env.NARRA_CHECK_OWNER_ROOT ?? "__missing__"), ownerRoot), "Frozen workspace owner mismatch");
  for (const key of ["HOME", "USERPROFILE"]) demand(same(path.resolve(process.env[key] ?? "__missing__"), real(path.join(ownerRoot, "home"), true)), "Docker may only read the isolated task home");
  for (const [key, relative] of [["APPDATA", "home/AppData/Roaming"], ["LOCALAPPDATA", "home/AppData/Local"]]) {
    demand(same(path.resolve(process.env[key] ?? "__missing__"), real(path.join(ownerRoot, relative), true)), "Docker may only read the isolated task app-data directories");
  }
  demand(!process.env.DOCKER_CONFIG && !process.env.DOCKER_CONTEXT && !existsSync(path.join(ownerRoot, "home/.docker")), "User Docker configuration/context must not enter this helper");
  const workDeadline = Date.now() + WORK_MS;
  const source = snapshot(ownerRoot, workDeadline);
  const { createLocalDockerWorkspace, cleanupLocalDockerWorkspace, localDockerSystemEnvironment, assertLocalDockerEndpoint } = await import(pathToFileURL(path.join(ROOT, "scripts/lib/local-docker-safety.mjs")));
  const { runStage, terminateProcessTree } = await import(pathToFileURL(path.join(ROOT, "scripts/lib/command-runner.mjs")));
  const endpoint = assertLocalDockerEndpoint(process.env.DOCKER_HOST);
  const systemEnv = Object.freeze(localDockerSystemEnvironment());
  const runOwner = randomUUID();
  const suffix = runOwner.replaceAll("-", "");
  const imageName = `narra-c2-next-builder:${suffix}`;
  const containerName = `narra-c2-next-export-${suffix}`;
  const report = { schemaVersion: 1, kind: ARTIFACT_KIND, owner: runOwner, workspace: ROOT,
    startedAt: new Date().toISOString(), source: { manifest: source.manifestPath, manifestSha256: source.manifestSha256,
      treeSha256: source.treeSha256, capturedAt: source.capturedAt, files: source.fileCount, bytes: source.bytes },
    endpoint, baseImages: {}, imageName, builderImageId: null, exportContainerId: null, build: null,
    buildSettings: { target: "builder", command: "pnpm build", script: "prisma generate && next build", circleNodeTotal: "2", nodeOptions: BUILD_NODE_OPTIONS,
      dockerBuildkit: "0", pull: false, memory: "3g", memorySwap: "3g", cpuQuota: 200000, cpuPeriod: 100000 },
    artifact: null, cleanup: { containersRemoved: false, builder: "not-created", scratchRemoved: false,
      networksCreated: false, cacheLayers: "Docker-managed build cache retained; never pruned" }, windowsRuntime: "not-verified", complete: false };
  let workspace;
  let artifact;
  let context;
  let daemonId;
  let containerId;
  let imageId;
  let buildAttempted = false;
  let createAttempted = false;
  let exitCode = 0;
  const docker = async (args, { label = args.slice(0, 2).join(" "), timeoutMs = 10_000, capture = true, input, build = false, closeCapture = false, deadlineAt = workDeadline } = {}) => {
    assertLocalDockerEndpoint(endpoint);
    if (workspace) {
      demand(real(workspace.directory, true) === workspace.directory && jsonFile(path.join(workspace.directory, "owner.json")).owner === runOwner
        && real(workspace.dockerConfig, true) === workspace.dockerConfig
        && JSON.stringify(jsonFile(path.join(workspace.dockerConfig, "config.json"))) === '{"auths":{}}', "Docker scratch/config owner mismatch");
    } else demand(args[0] === "info" || args[0] === "image" && args[1] === "inspect", "Mutation before local-image preflight");
    const command = { executable: "docker", args: ["--host", endpoint, ...(workspace ? ["--config", workspace.dockerConfig] : []), ...args],
      cwd: ROOT, env: { ...systemEnv, ...(build ? { DOCKER_BUILDKIT: "0" } : {}) }, label, timeoutMs, capture,
      ...(input === undefined ? {} : { input }) };
    return closeCapture ? captureAtClose(command, deadlineAt, terminateProcessTree)
      : runStage(command, { scope: "c2:linux-next", deadlineAt });
  };
  const checked = async (args, options) => {
    const result = await docker(args, options);
    if (result.code !== 0) {
      if (result.stderr?.trim()) console.error(result.stderr.trim());
      throw Object.assign(new Error(`${options?.label ?? args[0]} failed (exit ${result.code})`), { exitCode: result.code });
    }
    return result;
  };
  const inspect = async (kind, name, options) => JSON.parse((await checked([kind, "inspect", "--format", "{{json .}}", name], options)).stdout);
  const verifyDaemon = async (options) => {
    const info = JSON.parse((await checked(["info", "--format", "{{json .}}"], options)).stdout);
    demand(info.OSType === "linux" && typeof info.ID === "string" && info.ID && (!daemonId || info.ID === daemonId), "Local Linux daemon identity changed");
    daemonId = info.ID;
    return { id: daemonId, os: info.OSType, architecture: info.Architecture, memoryBytes: info.MemTotal, cpus: info.NCPU };
  };
  const verifyImage = (image) => {
    demand(IMAGE_ID.test(image.Id ?? "") && (!imageId || image.Id === imageId) && image.Os === "linux"
      && image.RepoTags?.includes(imageName) && image.Config?.Labels?.[LABEL] === runOwner
      && image.Config?.Labels?.[SOURCE_LABEL] === source.manifestSha256 && !Object.keys(image.Config?.Volumes ?? {}).length, "Exact built image owner/ID mismatch");
    imageId = image.Id;
    report.builderImageId = imageId;
  };
  const verifyContainer = (container) => {
    demand(RESOURCE_ID.test(container.Id ?? "") && (!containerId || container.Id === containerId)
      && container.Name === `/${containerName}` && container.Image === imageId && container.Config?.Image === imageId
      && container.Config?.Labels?.[LABEL] === runOwner && container.Config?.Labels?.[SOURCE_LABEL] === source.manifestSha256
      && container.HostConfig?.NetworkMode === "none" && container.HostConfig?.ReadonlyRootfs === true
      && !(container.Mounts ?? []).length && !Object.keys(container.HostConfig?.PortBindings ?? {}).length, "Exact export container owner/ID/isolation mismatch");
    containerId = container.Id;
    report.exportContainerId = containerId;
  };
  try {
    report.daemon = await verifyDaemon();
    for (const [kind, name] of [["node", "node:24.22.1-alpine"], ["go", "golang:1.25-alpine"]]) {
      const image = await inspect("image", name, { label: `Verify preinstalled local ${kind} image` });
      demand(IMAGE_ID.test(image.Id ?? "") && image.Os === "linux" && !Object.keys(image.Config?.Volumes ?? {}).length, "Invalid preinstalled Linux base image");
      report.baseImages[kind] = { reference: name, id: image.Id, architecture: image.Architecture };
    }
    workspace = createLocalDockerWorkspace(runOwner, real(path.join(ownerRoot, "temp"), true));
    artifact = mkdtempSync(path.join(real(path.join(ownerRoot, "temp"), true), "narra-c2-next-"));
    writeFileSync(path.join(artifact, "owner.json"), `${JSON.stringify({ kind: ARTIFACT_KIND, owner: runOwner, workspace: ROOT,
      parentOwnerKind: parentOwner.kind, parentOwnerTokenSha256: sha(parentOwner.token), sourceManifestSha256: source.manifestSha256 })}\n`, { flag: "wx", mode: 0o600 });
    artifactOwner(artifact, ownerRoot, runOwner, source);
    context = createContext(workspace, source, workDeadline);
    report.context = { files: Object.keys(context.records).length, treeSha256: context.treeSha256,
      originalDockerfileSha256: source.records.Dockerfile.sha256, generatedDockerfileSha256: context.records.Dockerfile.sha256,
      excludedFromCopy: [".trellis/"], credentialFilesCopied: false };
    writeFileSync(path.join(artifact, "context-manifest.json"), `${JSON.stringify(context.records, null, 2)}\n`, { flag: "wx" });
    writeFileSync(path.join(artifact, "Dockerfile.build"), readFileSync(path.join(context.directory, "Dockerfile")), { flag: "wx" });
    demand(!(await checked(["image", "ls", "--quiet", "--filter", `reference=${imageName}`])).stdout.trim(), "Generated image tag is already in use");
    demand(!(await checked(["container", "ls", "--all", "--quiet", "--filter", `name=^/${containerName}$`])).stdout.trim(), "Generated container name is already in use");
    await verifyDaemon();
    buildAttempted = true;
    const built = await docker(["build", "--pull=false", "--force-rm", "--rm=true", "--network=default", "--memory=3g", "--memory-swap=3g", "--cpu-period=100000", "--cpu-quota=200000",
      "--label", `${LABEL}=${runOwner}`, "--label", `${SOURCE_LABEL}=${source.manifestSha256}`, "--target", "builder",
      "--build-arg", `NODE_BASE_IMAGE=${report.baseImages.node.id}`, "--build-arg", `GO_BASE_IMAGE=${report.baseImages.go.id}`,
      "--iidfile", path.join(workspace.directory, "builder.iid"), "-f", path.join(context.directory, "Dockerfile"), "-t", imageName, context.directory],
    { label: "Complete production Linux pnpm build", timeoutMs: 1_080_000, capture: false, build: true });
    report.build = { exitCode: built.code, timedOut: built.timedOut, signal: built.signal, durationMs: built.durationMs };
    if (built.code !== 0) throw Object.assign(new Error(`Complete Linux pnpm build failed (exit ${built.code})`), { exitCode: built.code });
    verifyImage(await inspect("image", imageName));
    demand(readFileSync(real(path.join(workspace.directory, "builder.iid")), "utf8").trim() === imageId, "Builder iidfile does not match inspected image");
    const unchanged = snapshot(ownerRoot, workDeadline);
    demand(unchanged.manifestSha256 === source.manifestSha256 && unchanged.treeSha256 === source.treeSha256, "Frozen inputs changed during the Linux build");
    await verifyDaemon();
    createAttempted = true;
    const created = await checked(["container", "create", "--pull=never", "--name", containerName, "--interactive", "--network=none", "--read-only", "--memory=192m", "--pids-limit=32", "--cpus=1",
      "--label", `${LABEL}=${runOwner}`, "--label", `${SOURCE_LABEL}=${source.manifestSha256}`, "--entrypoint", "node", imageId, "-e", `(${inspectLinuxBuild.toString()})()`],
    { label: "Create owned read-only artifact inspector" });
    const createdId = created.stdout.trim();
    demand(RESOURCE_ID.test(createdId), "Missing exact created container ID");
    containerId = createdId;
    verifyContainer(await inspect("container", containerId));
    const input = JSON.stringify(context.records);
    demand(Buffer.byteLength(input) <= 8 * 1024 * 1024, "Image source inspection input exceeded its bound");
    const inspected = await checked(["container", "start", "--attach", "--interactive", containerId], { label: "Hash original Linux build artifacts and source inputs", input, timeoutMs: 75_000, closeCapture: true });
    const stopped = await inspect("container", containerId);
    verifyContainer(stopped);
    demand(stopped.State?.Status === "exited" && stopped.State?.ExitCode === 0 && stopped.State?.OOMKilled === false, "Artifact inspector did not finish successfully");
    const inventory = JSON.parse(inspected.stdout);
    demand(inventory.files && Object.keys(inventory.files).length <= MAX_FILES && inventory.bytes <= MAX_BYTES
      && inventory.excluded?.length === 1 && inventory.excluded[0] === "cache", "Invalid Linux artifact inventory");
    for (const [name, record] of Object.entries(inventory.files)) {
      inside(artifact, name);
      demand(SHA256.test(record.sha256 ?? "") && Number.isSafeInteger(record.bytes) && record.bytes >= 0
        && /^\d+$/.test(record.mtimeNs ?? ""), "Invalid artifact hash/time record");
    }
    artifactOwner(artifact, ownerRoot, runOwner, source);
    const nextDirectory = path.join(artifact, ".next");
    mkdirSync(nextDirectory);
    for (const entry of inventory.topLevel) {
      demand(typeof entry === "string" && entry !== "cache" && !entry.includes("/"), "Unsafe artifact export entry");
      const destination = inside(nextDirectory, entry);
      demand(!existsSync(destination), "Artifact export would overwrite an existing path");
      verifyContainer(await inspect("container", containerId));
      await checked(["container", "cp", `${containerId}:/app/.next/${entry}`, destination], { label: `Export .next/${entry}`, timeoutMs: 120_000 });
    }
    const exported = verifyArtifact(nextDirectory, inventory.files, workDeadline);
    const inventoryPath = path.join(artifact, "artifact-manifest.json");
    const exportPath = path.join(artifact, "artifact-export-manifest.json");
    writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, { flag: "wx" });
    writeFileSync(exportPath, `${JSON.stringify(exported, null, 2)}\n`, { flag: "wx" });
    report.artifact = { directory: artifact, nextDirectory, manifest: inventoryPath, manifestSha256: digest(inventoryPath, workDeadline).sha256,
      exportManifest: exportPath, exportManifestSha256: digest(exportPath, workDeadline).sha256,
      treeSha256: exported.treeSha256, files: Object.keys(inventory.files).length, bytes: inventory.bytes, excluded: [".next/cache"],
      mtimePolicy: exported.mtimePolicy, mtimeCounts: exported.mtimeCounts,
      buildIdMtime: { linuxNs: inventory.files.BUILD_ID.mtimeNs, exportedNs: exported.files.BUILD_ID.mtimeNs, comparison: exported.files.BUILD_ID.mtimeComparison },
      buildId: inventory.buildId, node: inventory.node, next: inventory.next, platform: inventory.platform, arch: inventory.arch,
      nativeFiles: inventory.nativeFiles, copiedImageInputsVerified: inventory.inputFilesVerified, generatedSource: inventory.generatedSource,
      existingWorkspaceNextModified: false, preservedForReview: true };
  } catch (error) {
    exitCode = Number.isInteger(error.exitCode) && error.exitCode > 0 ? error.exitCode : 2;
    report.error = error.message;
    console.error(`[c2:linux-next] ${error.message}`);
  } finally {
    const cleanupDeadline = Date.now() + CLEANUP_MS;
    const options = { deadlineAt: cleanupDeadline, timeoutMs: 10_000 };
    let clean = true;
    if (workspace) {
      try {
        await verifyDaemon(options);
        if (createAttempted) {
          const found = await checked(["container", "ls", "--all", "--no-trunc", "--quiet", "--filter", `name=^/${containerName}$`], options);
          if (found.stdout.trim()) {
            verifyContainer(await inspect("container", containerName, options));
            await checked(["container", "rm", "--force", containerId], { ...options, timeoutMs: 20_000 });
          }
        }
        const remaining = await checked(["container", "ls", "--all", "--no-trunc", "--quiet", "--filter", `label=${LABEL}=${runOwner}`], options);
        demand(!remaining.stdout.trim(), "Owned containers remain after cleanup; no prefix/prune fallback permitted");
        report.cleanup.containersRemoved = true;
      } catch (error) { clean = false; report.cleanup.containerError = error.message; }
      try {
        await verifyDaemon(options);
        if (buildAttempted) {
          const found = await checked(["image", "ls", "--quiet", "--filter", `reference=${imageName}`], options);
          if (found.stdout.trim()) {
            verifyImage(await inspect("image", imageName, options));
            if (keepBuilder && exitCode === 0 && report.artifact) {
              report.cleanup.builder = "explicitly-retained-for-linux-runtime";
              report.cleanup.retainedImage = { name: imageName, id: imageId, owner: runOwner, endpoint };
            } else {
              await checked(["image", "rm", imageId], { ...options, timeoutMs: 20_000 });
              report.cleanup.builder = "removed";
            }
          }
          const remaining = (await checked(["image", "ls", "--all", "--no-trunc", "--quiet", "--filter", `label=${LABEL}=${runOwner}`], options)).stdout.trim().split(/\s+/).filter(Boolean);
          demand(remaining.every((id) => report.cleanup.retainedImage && id === imageId), "Owned image remains after cleanup; unknown cache is never deleted");
          if (report.build?.timedOut) { clean = false; report.cleanup.buildCancellation = "CLI deadline expired; daemon intermediate cleanup is not claimed"; }
        }
      } catch (error) { clean = false; report.cleanup.imageError = error.message; }
      report.cleanup.scratchRemoved = cleanupLocalDockerWorkspace(workspace);
      if (!report.cleanup.scratchRemoved) clean = false;
    }
    try {
      const after = snapshot(ownerRoot, Date.now() + 60_000);
      demand(after.manifestSha256 === source.manifestSha256 && after.treeSha256 === source.treeSha256, "Frozen inputs changed during build/export/cleanup");
      report.source.postTreeSha256 = after.treeSha256;
      report.source.unchanged = true;
    } catch (error) { clean = false; report.source.error = error.message; }
    report.cleanup.complete = clean;
    if (!clean && exitCode === 0) exitCode = 2;
    report.exitCode = exitCode;
    report.complete = exitCode === 0 && report.build?.exitCode === 0 && Boolean(report.artifact) && clean;
    report.finishedAt = new Date().toISOString();
    if (artifact) {
      try {
        artifactOwner(artifact, ownerRoot, runOwner, source);
        report.resultFile = path.join(artifact, "result.json");
        writeFileSync(report.resultFile, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
      } catch (error) {
        if (exitCode === 0) exitCode = 2;
        report.exitCode = exitCode;
        report.complete = false;
        report.resultWriteError = error.message;
        delete report.resultFile;
      }
    }
    console.log(JSON.stringify(report, null, 2));
  }
  return exitCode;
}

// Importing the helper is safe for a static review. Only the isolated direct
// invocation may perform the bounded build and export.
if (process.argv[1] && same(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`[c2:linux-next] ${error.message}`);
    process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 2;
  });
}

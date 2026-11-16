import { strict as assert } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// The original untagged C2 dependency image was removed with the final image's
// dangling ancestors. Keep a new task-owned tag until final validation ends.
const INPUTS = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];
const COREPACK_CACHE = "/root/.cache/node/corepack";
const PNPM_VERSION = "10.32.1";
const sha = (data) => createHash("sha256").update(data).digest("hex");

// Compare the full dependency tree without copying it through another large
// overlay layer. Include every entry, mode and literal symlink target; reject
// special files and never follow symlinks. The freshly generated runner client
// must reproduce exactly what the complete production build used.
function dependencyTree(mode) {
  const fs = require("node:fs");
  const crypto = require("node:crypto");
  const assert = require("node:assert/strict");
  const root = "/app/node_modules";
  const proof = "/tmp/narra-built-dependencies.json";
  const entries = [];
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const hashFile = (target) => {
    const hash = crypto.createHash("sha256");
    const descriptor = fs.openSync(target, "r");
    try {
      let count;
      while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
      return hash.digest("hex");
    } finally { fs.closeSync(descriptor); }
  };
  const visit = (relative) => {
    const target = relative ? `${root}/${relative}` : root;
    const stat = fs.lstatSync(target);
    const entry = { path: relative || ".", mode: stat.mode & 0o7777, uid: stat.uid, gid: stat.gid };
    if (stat.isSymbolicLink()) entries.push({ ...entry, type: "symlink", target: fs.readlinkSync(target) });
    else if (stat.isDirectory()) {
      entries.push({ ...entry, type: "directory" });
      for (const name of fs.readdirSync(target).sort()) visit(relative ? `${relative}/${name}` : name);
    } else {
      assert(stat.isFile(), "Unexpected dependency entry type");
      entries.push({ ...entry, type: "file", size: stat.size, sha256: hashFile(target) });
    }
  };
  assert(fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink());
  visit("");
  const treeSha256 = crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  if (mode === "capture") {
    fs.writeFileSync(proof, JSON.stringify(entries), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ builderDependencyTreeCaptured: true, entries: entries.length, sha256: treeSha256 }));
  }
  else {
    assert.equal(mode, "verify");
    const expected = JSON.parse(fs.readFileSync(proof, "utf8"));
    assert.equal(entries.length, expected.length, "Dependency entry count differs from the full build");
    for (let index = 0; index < entries.length; index++) assert.deepEqual(entries[index], expected[index], `Dependency entry differs: ${entries[index].path}`);
    console.log(JSON.stringify({ runnerDependencyTreeMatchesFullBuild: true, entries: entries.length, sha256: treeSha256 }));
    fs.unlinkSync(proof);
  }
}

const dependencyTreeCommand = (mode) => `RUN node -e '${`(${dependencyTree.toString()})(${JSON.stringify(mode)})`.replace(/\r?\n\s*/g, " ")}'`;

export async function buildWithCachedDependencies(command, options, runStage, root) {
  const index = command.args.indexOf("build");
  assert(index >= 0 && command.args.includes("--pull=false") && command.args.includes("--force-rm"));
  const prefix = command.args.slice(0, index);
  assert(prefix.includes("--host") && prefix.includes("--config"));
  const cacheFile = path.join(path.dirname(root), "receipts", "history-dependency-cache.json");
  const source = readFileSync(path.join(root, "Dockerfile"), "utf8");
  assert.equal(source.split("FROM base AS builder").length, 2);
  const seedSource = source.split("FROM base AS builder")[0];
  assert(seedSource.includes("RUN pnpm install --frozen-lockfile"));
  const sourceHashes = Object.fromEntries(INPUTS.map((file) => [file, sha(readFileSync(path.join(root, file)))]));
  const nodeArgument = command.args.find((value) => value.startsWith("NODE_BASE_IMAGE="));
  assert.match(nodeArgument ?? "", /^NODE_BASE_IMAGE=sha256:[a-f0-9]{64}$/);
  const nodeBaseId = nodeArgument.slice("NODE_BASE_IMAGE=".length);
  const owner = randomUUID();
  const name = `narra-history-deps-${owner}`;
  const directory = mkdtempSync(path.join(path.dirname(root), "temp", "history-deps-"));
  writeFileSync(path.join(directory, "owner.json"), JSON.stringify({ owner, workspace: root }), { flag: "wx" });
  let dependencies;
  let containerId;
  const docker = async (args, label) => {
    const result = await runStage({ ...command, label, args: [...prefix, ...args], timeoutMs: 15_000, capture: true }, options);
    if (result.code !== 0) throw new Error(`${label} failed (${result.code}): ${result.stderr}`);
    return result.stdout.trim();
  };
  const inspect = async () => {
    const [container] = JSON.parse(await docker(["container", "inspect", containerId], "Verify dependency inspection owner"));
    assert.equal(container.Id, containerId);
    assert.equal(container.Name, `/${name}`);
    assert.equal(container.Image, dependencies);
    assert.equal(container.Config.Labels["com.narra.history-deps.owner"], owner);
    assert.equal(container.HostConfig.NetworkMode, "none");
    assert.equal(container.HostConfig.ReadonlyRootfs, true);
    assert.equal(container.Mounts.length, 0);
    return container;
  };
  try {
    if (!existsSync(cacheFile)) {
      const seedDockerfile = path.join(directory, "Dependencies.Dockerfile");
      writeFileSync(seedDockerfile, seedSource, { flag: "wx" });
      const tag = `narra-history-deps:${owner.replaceAll("-", "")}`;
      const unused = await runStage({ ...command, label: "Require an unused task dependency tag", args: [...prefix, "image", "inspect", tag], timeoutMs: 15_000, capture: true }, options);
      assert(unused.code !== 0 && /No such image/.test(unused.stderr));
      writeFileSync(path.join(path.dirname(root), "receipts", `dependency-cache-attempt-${owner}.json`), JSON.stringify({
        kind: "image-history-task-dependency-attempt-v1", workspace: root, owner, tag,
        nodeBaseImage: nodeBaseId, inputs: sourceHashes, dockerfileSha256: sha(seedSource),
        tagVerifiedAbsentBeforeBuild: true,
      }, null, 2) + "\n", { flag: "wx" });
      const built = await runStage({ ...command, label: "Build tagged task dependencies with the original frozen install",
        args: [...prefix, "build", "--no-cache", "--pull=false", "--force-rm", "--memory", "3g", "--cpuset-cpus", "0",
          "--label", `com.narra.history-deps-cache.owner=${owner}`, "-f", seedDockerfile, "-t", tag, "--build-arg", nodeArgument, "."],
        timeoutMs: 600_000 }, options);
      if (built.code !== 0) throw new Error(`Task dependency build failed (${built.code})`);
      const [seed] = JSON.parse(await docker(["image", "inspect", tag], "Record the exact newly built task dependency cache"));
      assert.match(seed.Id, /^sha256:[a-f0-9]{64}$/);
      assert.equal(seed.Config.Labels["com.narra.history-deps-cache.owner"], owner);
      const cache = { kind: "image-history-task-dependencies-v1", workspace: root, owner, tag, image: seed.Id,
        nodeBaseImage: nodeBaseId, inputs: sourceHashes, dockerfileSha256: sha(seedSource), originalFrozenInstall: true };
      writeFileSync(cacheFile, JSON.stringify(cache, null, 2) + "\n", { flag: "wx" });
    }
    assert(!lstatSync(cacheFile).isSymbolicLink() && realpathSync(cacheFile) === cacheFile);
    const cache = JSON.parse(readFileSync(cacheFile, "utf8"));
    assert.equal(cache.kind, "image-history-task-dependencies-v1");
    assert.equal(cache.workspace, root);
    assert.equal(cache.nodeBaseImage, nodeBaseId);
    assert.equal(cache.dockerfileSha256, sha(seedSource));
    assert.match(cache.owner, /^[a-f0-9-]{36}$/);
    assert.equal(cache.tag, `narra-history-deps:${cache.owner.replaceAll("-", "")}`);
    assert.match(cache.image, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(cache.inputs, sourceHashes);
    assert.equal(cache.originalFrozenInstall, true);
    dependencies = cache.image;
    const [image] = JSON.parse(await docker(["image", "inspect", cache.tag], "Require the exact tagged task dependency image"));
    assert.equal(image.Id, dependencies);
    assert.equal(image.Config.Labels["com.narra.history-deps-cache.owner"], cache.owner);
    assert.equal(image.Os, "linux");
    assert.equal(image.Architecture, "amd64");
    const [nodeBase] = JSON.parse(await docker(["image", "inspect", nodeBaseId], "Check inherited dependency image runtime configuration"));
    assert.equal(nodeBase.Id, nodeBaseId);
    assert.deepEqual(image.RootFS.Layers.slice(0, nodeBase.RootFS.Layers.length), nodeBase.RootFS.Layers);
    const environment = (values) => {
      const entries = values.map((value) => [value.slice(0, value.indexOf("=")), value.slice(value.indexOf("=") + 1)]);
      assert.equal(new Set(entries.map(([key]) => key)).size, entries.length);
      return Object.fromEntries(entries);
    };
    const baseEnvironment = environment(nodeBase.Config.Env);
    const inheritedEnvironment = environment(image.Config.Env);
    assert.deepEqual(inheritedEnvironment, { ...baseEnvironment, PNPM_HOME: "/pnpm", PATH: `/pnpm:${baseEnvironment.PATH}` });
    for (const key of ["DATABASE_URL", "AUTH_SECRET", "APP_URL", "BUILTIN_PROVIDER_BASE_URL", "BUILTIN_PROVIDER_API_KEY"]) {
      assert(!Object.hasOwn(inheritedEnvironment, key), `Build configuration inherited by runtime: ${key}`);
    }
    assert.equal(image.Config.WorkingDir, "/app");
    for (const key of ["User", "Entrypoint", "Cmd", "Shell"]) assert.deepEqual(image.Config[key], nodeBase.Config[key]);
    const probe = `const fs=require('node:fs'),crypto=require('node:crypto'); const files=${JSON.stringify(INPUTS)},cache=${JSON.stringify(COREPACK_CACHE)},version=${JSON.stringify(PNPM_VERSION)}; console.log(JSON.stringify({node:process.version,appEntries:fs.readdirSync('/app').sort(),inputs:Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync('/app/'+f)).digest('hex')])),corepack:{root:cache,versions:fs.readdirSync(cache+'/v1/pnpm'),packageVersion:JSON.parse(fs.readFileSync(cache+'/v1/pnpm/'+version+'/package.json','utf8')).version,marker:JSON.parse(fs.readFileSync(cache+'/v1/pnpm/'+version+'/.corepack','utf8'))}}));`;
    containerId = await docker(["container", "create", "--pull=never", "--name", name,
      "--label", `com.narra.history-deps.owner=${owner}`, "--network", "none", "--read-only",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--entrypoint", "node", dependencies, "-e", probe], "Create read-only dependency hash inspector");
    assert.match(containerId, /^[a-f0-9]{64}$/);
    await inspect();
    const actual = JSON.parse(await docker(["container", "start", "--attach", containerId], "Hash installed dependency inputs without network"));
    assert.equal((await inspect()).State.ExitCode, 0);
    assert.equal(actual.node, "v24.22.1");
    assert.deepEqual(actual.inputs, sourceHashes);
    assert.deepEqual(actual.appEntries, [...INPUTS, "node_modules"].sort());
    assert.deepEqual(actual.corepack.versions, [PNPM_VERSION]);
    assert.equal(actual.corepack.packageVersion, PNPM_VERSION);
    assert.deepEqual(actual.corepack.marker.locator, { name: "pnpm", reference: PNPM_VERSION });
    for (const marker of ["FROM base AS deps", "FROM base AS builder", "FROM base AS runner", "COPY --from=deps /app/node_modules ./node_modules", "COPY --from=builder /app/node_modules ./node_modules", "RUN go mod download", "RUN pnpm build", "EXPOSE 3000"]) {
      assert.equal(source.split(marker).length, 2);
    }
    const offlineVersion = "RUN COREPACK_ENABLE_NETWORK=0 pnpm --version";
    const generated = source.replace("FROM base AS deps", `FROM ${dependencies} AS deps`)
      // Inherit the same verified dependency bytes instead of making another
      // large overlay copy before compiling or packaging. The runner must
      // reproduce every dependency byte from the completed builder.
      .replace("FROM base AS builder", "FROM deps AS builder")
      .replace("COPY --from=deps /app/node_modules ./node_modules", "")
      .replace("FROM base AS runner", "FROM deps AS runner")
      .replace("RUN go mod download", "RUN go mod download || go mod download || go mod download")
      .replace("RUN pnpm build", `${offlineVersion}\nRUN CIRCLE_NODE_TOTAL=2 RAYON_NUM_THREADS=1 TOKIO_WORKER_THREADS=1 UV_THREADPOOL_SIZE=2 NODE_OPTIONS="--max-old-space-size=1536 --max-semi-space-size=4" pnpm build\n${dependencyTreeCommand("capture")}`)
      .replace("COPY --from=builder /app/node_modules ./node_modules", 'RUN COREPACK_ENABLE_NETWORK=0 DATABASE_URL="postgresql://postgres:postgres@localhost:5432/narra_image?schema=public" pnpm exec prisma generate\nCOPY --from=builder /tmp/narra-built-dependencies.json /tmp/narra-built-dependencies.json\n' + dependencyTreeCommand("verify"))
      .replace("EXPOSE 3000", `${offlineVersion}\n\nEXPOSE 3000`);
    assert(generated.includes("RUN pnpm install --frozen-lockfile") && generated.includes(" pnpm build"));
    const dockerfile = path.join(directory, "Dockerfile");
    writeFileSync(dockerfile, generated, { flag: "wx" });
    const args = [...command.args];
    assert(args[args.indexOf("-f") + 1] === "Dockerfile");
    args[args.indexOf("-f") + 1] = dockerfile;
    args.splice(index + 1, 0, "--no-cache", "--memory", "3g", "--memory-swap", "3g", "--cpuset-cpus", "0", "--cpu-period", "100000", "--cpu-quota", "100000");
    const proof = { dependencyImage: dependencies, dependencyCacheTag: cache.tag, dependencyCacheOwner: cache.owner, inputs: sourceHashes,
      nodeBaseImage: nodeBaseId, inheritedRuntimeConfigurationValidated: true,
      corepackCache: actual.corepack, corepackCacheInheritedBy: ["builder", "runner"], offlineVersionProbeRequired: true,
      dependencyAppEntries: actual.appEntries, builderDependencyCopyReplacedByInheritance: true,
      runnerDependencyCopyReplacedByInheritanceAndFreshPrisma: true, runnerFullTreeEqualityRequired: true,
      originalDockerfileSha256: sha(source), generatedDockerfileSha256: sha(generated),
      originalInstallCommandRetained: true, originalProductionBuildRetained: true,
      goDependencyDownloadAttempts: 3,
      buildResourceLimits: { memory: "3g", cpus: 1, cpuSet: "0", nextWorkers: 1, rayonThreads: 1, tokioThreads: 1, uvThreads: 2, oldSpaceMiB: 1536, semiSpaceMiB: 4 } };
    console.log(JSON.stringify(proof));
    writeFileSync(path.join(path.dirname(root), "receipts", `dependency-reuse-${owner}.json`), JSON.stringify(proof, null, 2) + "\n", { flag: "wx" });
    return await runStage({ ...command, args }, options);
  } finally {
    if (containerId) {
      await inspect();
      await docker(["container", "rm", "--force", containerId], "Remove exact dependency inspection container");
    }
    assert(realpathSync(directory) === directory && !lstatSync(directory).isSymbolicLink()
      && path.dirname(directory) === realpathSync(path.join(path.dirname(root), "temp"))
      && JSON.parse(readFileSync(path.join(directory, "owner.json"), "utf8")).owner === owner);
    rmSync(directory, { recursive: true });
  }
}

export async function buildWorkerWithDependencyRetries(command, options, runStage, root) {
  const index = command.args.indexOf("build");
  assert(index >= 0 && command.args.includes("--pull=false") && command.args.includes("--force-rm"));
  assert.equal(command.args[command.args.indexOf("-f") + 1], "worker/Dockerfile");
  const owner = randomUUID();
  const directory = mkdtempSync(path.join(path.dirname(root), "temp", "history-worker-build-"));
  writeFileSync(path.join(directory, "owner.json"), JSON.stringify({ owner, workspace: root }), { flag: "wx" });
  try {
    const source = readFileSync(path.join(root, "worker/Dockerfile"), "utf8");
    assert.equal(source.split("RUN go mod download").length, 2);
    const generated = source.replace("RUN go mod download", "RUN go mod download || go mod download || go mod download");
    const dockerfile = path.join(directory, "Dockerfile");
    writeFileSync(dockerfile, generated, { flag: "wx" });
    const args = [...command.args];
    args[args.indexOf("-f") + 1] = dockerfile;
    args.splice(index + 1, 0, "--no-cache", "--memory", "3g", "--memory-swap", "3g", "--cpuset-cpus", "0");
    const proof = { originalDockerfileSha256: sha(source), generatedDockerfileSha256: sha(generated),
      goDependencyDownloadAttempts: 3, originalGoBuildsRetained: true, cpuSet: "0", memory: "3g" };
    writeFileSync(path.join(path.dirname(root), "receipts", `worker-dependency-retry-${owner}.json`), JSON.stringify(proof, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify(proof));
    return await runStage({ ...command, args }, options);
  } finally {
    assert(realpathSync(directory) === directory && !lstatSync(directory).isSymbolicLink()
      && path.dirname(directory) === realpathSync(path.join(path.dirname(root), "temp"))
      && JSON.parse(readFileSync(path.join(directory, "owner.json"), "utf8")).owner === owner);
    rmSync(directory, { recursive: true });
  }
}

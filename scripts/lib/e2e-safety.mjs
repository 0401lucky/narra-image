import { randomBytes, randomUUID } from "node:crypto";
import {
  existsSync, lstatSync, readFileSync, realpathSync, statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runStage } from "./command-runner.mjs";
import {
  assertLocalDockerEndpoint, cleanupLocalDockerWorkspace as cleanupE2EWorkspace,
  createLocalDockerWorkspace, localDockerSystemEnvironment as e2eSystemEnvironment,
  resolveLocalDockerEndpoint,
} from "./local-docker-safety.mjs";

export { assertLocalDockerEndpoint, cleanupE2EWorkspace, e2eSystemEnvironment };

export const E2E_OWNER_LABEL = "com.narra.e2e.owner";
const PROJECT_LABEL = "com.docker.compose.project";
const SERVICES = new Set(["db", "object-store", "migrate", "worker", "app", "embedded", "embedded_conflict"]);
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const RESOURCE_ID = /^[a-f0-9]{64}$/;
const PROBE_TIMEOUT_MS = 10_000;

export function e2eFailure(message, exitCode = 2) {
  return Object.assign(new Error(message), { exitCode });
}

export function printE2ECaptured(result) {
  if (result.stdout?.trim()) console.error(result.stdout.trim());
  if (result.stderr?.trim()) console.error(result.stderr.trim());
}

function imageReference(value) {
  if (!value || value.length > 255 || !/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/.test(value) || value.includes("://")) {
    throw e2eFailure("Invalid local E2E image reference");
  }
  return value;
}

/** @param {Record<string, string | undefined>} [source] */
export function createE2EConfiguration(source = process.env) {
  const owner = randomUUID();
  const suffix = randomBytes(8).toString("hex");
  const skipBuild = source.E2E_SKIP_BUILD === "1";
  if (!skipBuild && (source.E2E_APP_IMAGE || source.E2E_WORKER_IMAGE)) {
    throw e2eFailure("Caller-supplied images require E2E_SKIP_BUILD=1; the runner never overwrites those tags");
  }
  if (skipBuild && (!source.E2E_APP_IMAGE?.trim() || !source.E2E_WORKER_IMAGE?.trim())) {
    throw e2eFailure("E2E_SKIP_BUILD=1 requires both already-built local app and worker images");
  }
  return Object.freeze({
    owner,
    suffix,
    skipBuild,
    keepImages: source.E2E_KEEP_IMAGES === "1",
    systemEnv: e2eSystemEnvironment(source),
    databaseUser: `narra_e2e_${suffix}`,
    databasePassword: `Narra:@#?/${randomBytes(32).toString("base64url")}`,
    authSecret: randomBytes(48).toString("base64url"),
    metricsToken: randomBytes(32).toString("base64url"),
    storeToken: randomBytes(32).toString("base64url"),
    storeAccessKey: `e2e-${randomBytes(16).toString("hex")}`,
    storeSecretKey: randomBytes(32).toString("base64url"),
    images: Object.freeze({
      postgres: imageReference(source.E2E_POSTGRES_IMAGE?.trim() || "postgres:17-alpine"),
      node: imageReference(source.E2E_NODE_BASE_IMAGE?.trim() || "node:24.22.1-alpine"),
      go: imageReference(source.E2E_GO_BASE_IMAGE?.trim() || "golang:1.25-alpine"),
      alpine: imageReference(source.E2E_ALPINE_BASE_IMAGE?.trim() || "alpine:3.22"),
      app: imageReference(skipBuild ? source.E2E_APP_IMAGE.trim() : `narra-e2e-app:${suffix}`),
      worker: imageReference(skipBuild ? source.E2E_WORKER_IMAGE.trim() : `narra-e2e-worker:${suffix}`),
    }),
  });
}

export function e2eComposePluginDirectory(plugins) {
  const plugin = Array.isArray(plugins) ? plugins.find((entry) => entry.Name === "compose") : undefined;
  const expectedName = process.platform === "win32" ? "docker-compose.exe" : "docker-compose";
  if (!plugin || typeof plugin.Path !== "string" || !path.isAbsolute(plugin.Path)
    || path.basename(plugin.Path).toLowerCase() !== expectedName || !existsSync(plugin.Path) || !statSync(plugin.Path).isFile()) {
    throw e2eFailure("A locally installed Docker Compose plugin is required; the runner will not download one");
  }
  return realpathSync(path.dirname(plugin.Path));
}

export function createE2EWorkspace(owner, parent = tmpdir(), composePluginDirectory = null) {
  return createLocalDockerWorkspace(owner, parent, composePluginDirectory, "narra-e2e-");
}

function projectName(configuration, label, suffix) {
  if (!/^[a-z][a-z0-9-]{0,19}$/.test(label)) throw e2eFailure("Invalid E2E scenario label");
  return `narra-e2e-${label}-${configuration.suffix}-${suffix}`;
}

export function createE2EProject(configuration, label, { canvas = false, workerCanvas = canvas, genericReadinessRequired = true } = {}) {
  const suffix = randomBytes(4).toString("hex");
  const name = projectName(configuration, label, suffix);
  return {
    owner: configuration.owner,
    name,
    label,
    networkName: `${name}-net`,
    databaseName: `narra_e2e_${label.replaceAll("-", "_")}_${suffix}`,
    bucket: `narra-e2e-${configuration.suffix}-${suffix}`,
    canvas,
    workerCanvas,
    genericReadinessRequired,
    missingDatabase: false,
    creationAttempted: false,
    networkId: null,
    cleaned: false,
    oneOffNames: new Set(),
  };
}

export function assertE2EProject(configuration, project) {
  const expectedPrefix = `narra-e2e-${project.label}-${configuration.suffix}-`;
  if (project.owner !== configuration.owner || !project.name.startsWith(expectedPrefix)
    || !/^[a-z0-9-]{1,63}$/.test(project.name) || !/^[a-f0-9]{8}$/.test(project.name.slice(expectedPrefix.length))
    || project.networkName !== `${project.name}-net`
    || project.databaseName !== `narra_e2e_${project.label.replaceAll("-", "_")}_${project.name.slice(-8)}`
    || project.bucket !== `narra-e2e-${configuration.suffix}-${project.name.slice(-8)}`) {
    throw e2eFailure("Refusing an E2E resource outside this run's exact random namespace");
  }
}

export function e2eComposeEnvironment(configuration, project) {
  assertE2EProject(configuration, project);
  const databaseName = project.missingDatabase ? `${project.databaseName}_missing` : project.databaseName;
  // Only this generated service alias on the owned internal network is allowed.
  // Host-side tools never consume a caller's DATABASE_URL or TEST_DATABASE_URL.
  const databaseUrl = `postgresql://${configuration.databaseUser}:${encodeURIComponent(configuration.databasePassword)}@db:5432/${databaseName}?schema=public&connect_timeout=3`;
  return {
    ...configuration.systemEnv,
    COMPOSE_DISABLE_ENV_FILE: "1",
    COMPOSE_ANSI: "never",
    COMPOSE_MENU: "0",
    E2E_OWNER_TOKEN: configuration.owner,
    E2E_NETWORK_NAME: project.networkName,
    E2E_AUTH_SECRET: configuration.authSecret,
    E2E_METRICS_TOKEN: configuration.metricsToken,
    E2E_POSTGRES_IMAGE: configuration.images.postgres,
    E2E_APP_IMAGE: configuration.images.app,
    E2E_WORKER_IMAGE: configuration.images.worker,
    E2E_POSTGRES_DB: project.databaseName,
    E2E_POSTGRES_USER: configuration.databaseUser,
    E2E_POSTGRES_PASSWORD: configuration.databasePassword,
    E2E_DATABASE_URL: databaseUrl,
    E2E_CANVAS_ENABLED: String(project.canvas),
    E2E_WORKER_CANVAS_ENABLED: String(project.workerCanvas),
    E2E_WORKER_READINESS_REQUIRED: String(project.genericReadinessRequired),
    E2E_STORE_BUCKET: project.bucket,
    E2E_STORE_TOKEN: configuration.storeToken,
    E2E_STORE_ACCESS_KEY: configuration.storeAccessKey,
    E2E_STORE_SECRET_KEY: configuration.storeSecretKey,
    E2E_S3_ENDPOINT: project.canvas ? "http://object-store:9090" : "",
    E2E_S3_REGION: "us-east-1",
    E2E_S3_BUCKET: project.canvas ? project.bucket : "",
    E2E_S3_ACCESS_KEY_ID: project.canvas ? configuration.storeAccessKey : "",
    E2E_S3_SECRET_ACCESS_KEY: project.canvas ? configuration.storeSecretKey : "",
    E2E_S3_PUBLIC_BASE_URL: project.canvas ? `http://object-store:9090/${project.bucket}` : "",
  };
}

function composeCommandIndex(args) {
  let index = 0;
  while (args[index] === "--profile") {
    if (!["embedded", "conflict"].includes(args[index + 1])) throw e2eFailure("Unknown E2E Compose profile");
    index += 2;
  }
  if (!["config", "up", "run", "exec", "ps", "port", "logs", "stop", "start"].includes(args[index])) {
    throw e2eFailure("Unsupported E2E Compose operation");
  }
  return index;
}

export function e2eComposeArgs(projectRoot, workspace, project, args) {
  if (!workspace || workspace.owner !== project.owner
    || workspace.envFile !== path.join(workspace.directory, "empty.env")
    || lstatSync(workspace.envFile).isSymbolicLink()
    || realpathSync(workspace.envFile) !== workspace.envFile
    || readFileSync(workspace.envFile, "utf8") !== "") {
    throw e2eFailure("An empty runner-owned explicit Compose env file is required");
  }
  if (args.some((arg) => ["--build", "--env-file", "--project-directory", "--project-name", "-p", "-f", "--rmi", "--pull"].includes(arg)
    || /^(?:--env-file|--project-name|--project-directory|--pull)=/.test(arg))) {
    throw e2eFailure("Compose callers may not override environment, project, build or pull policy");
  }
  const index = composeCommandIndex(args);
  const command = args[index];
  const policy = command === "up" ? ["--pull=never", "--no-build"] : command === "run" ? ["--pull=never"] : [];
  return [
    "compose", "--env-file", workspace.envFile,
    "--project-directory", projectRoot, "-f", path.join(projectRoot, "docker-compose.e2e.yml"),
    "--project-name", project.name,
    ...args.slice(0, index + 1), ...policy, ...args.slice(index + 1),
  ];
}

export function assertE2EContainer(configuration, project, container) {
  assertE2EProject(configuration, project);
  const labels = container.Config?.Labels ?? {};
  const service = labels["com.docker.compose.service"];
  const name = container.Name?.replace(/^\//, "");
  const ordinaryName = SERVICES.has(service) && new RegExp(`^${project.name}-${service}-[1-9][0-9]*$`).test(name);
  const oneOffName = service === "migrate" && name === `${project.name}-migrate-recovery` && project.oneOffNames.has(name);
  if (!project.creationAttempted || !RESOURCE_ID.test(container.Id ?? "")
    || labels[E2E_OWNER_LABEL] !== configuration.owner || labels[PROJECT_LABEL] !== project.name
    || !SERVICES.has(service) || (!ordinaryName && !oneOffName)) {
    throw e2eFailure("Refusing a container without this run's exact name, service and owner labels");
  }
  if (container.HostConfig?.NetworkMode === "host"
    || Object.values(container.HostConfig?.PortBindings ?? {}).some((bindings) => bindings?.length)
    || Object.values(container.NetworkSettings?.Ports ?? {}).some((bindings) => bindings?.length)) {
    throw e2eFailure("E2E containers may not publish host ports or use host networking");
  }
  return container.Id;
}

export function assertE2ENetwork(configuration, project, network) {
  assertE2EProject(configuration, project);
  if (!project.creationAttempted || !RESOURCE_ID.test(network.Id ?? "") || network.Name !== project.networkName
    || (project.networkId && network.Id !== project.networkId) || network.Internal !== true
    || network.Labels?.[E2E_OWNER_LABEL] !== configuration.owner || network.Labels?.[PROJECT_LABEL] !== project.name) {
    throw e2eFailure("Refusing a network without this run's exact name, internal flag and owner labels");
  }
  return network.Id;
}

export function assertE2EBuiltImage(configuration, imageName, metadata, builtImages) {
  const expectedId = builtImages.get(imageName);
  if (configuration.skipBuild || ![configuration.images.app, configuration.images.worker].includes(imageName)
    || !expectedId || !IMAGE_ID.test(expectedId) || metadata.Id !== expectedId
    || metadata.Config?.Labels?.[E2E_OWNER_LABEL] !== configuration.owner
    || !metadata.RepoTags?.includes(imageName)) {
    throw e2eFailure("Refusing to remove an image not built and labelled by this run");
  }
  return imageName;
}

function parseInspection(result, label) {
  if (result.code !== 0) {
    printE2ECaptured(result);
    throw e2eFailure(`${label} failed (exit ${result.code})`, result.code);
  }
  try { return JSON.parse(result.stdout); }
  catch { throw e2eFailure(`${label} returned invalid inspection JSON`); }
}

export class E2EHarness {
  constructor({ projectRoot, configuration = createE2EConfiguration(), run = runStage, deadlineAt }) {
    if (!Number.isFinite(deadlineAt)) throw e2eFailure("E2E requires a finite independent deadline");
    this.projectRoot = path.resolve(projectRoot);
    this.configuration = configuration;
    this.runStage = run;
    this.deadlineAt = deadlineAt;
    this.endpoint = null;
    this.workspace = null;
    this.preflightPassed = false;
    this.projects = new Set();
    this.localImages = new Map();
    this.buildAttempts = new Set();
    this.builtImages = new Map();
  }

  async docker(args, { label = "Docker E2E", timeoutMs = PROBE_TIMEOUT_MS, capture = true, env, input, deadlineAt = this.deadlineAt } = {}) {
    if (!Number.isFinite(deadlineAt) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw e2eFailure("Unbounded E2E command refused");
    return this.runStage({
      label, executable: "docker",
      args: [...(this.endpoint ? ["--host", this.endpoint] : []), ...(this.workspace ? ["--config", this.workspace.dockerConfig] : []), ...args],
      cwd: this.projectRoot, env: env ?? this.configuration.systemEnv,
      capture, timeoutMs, ...(input === undefined ? {} : { input }),
    }, { scope: "verify:e2e", deadlineAt });
  }

  async checkedDocker(args, options = {}) {
    const result = await this.docker(args, options);
    if (result.code !== 0) {
      printE2ECaptured(result);
      throw e2eFailure(`${options.label ?? args[0]} failed (exit ${result.code})`, result.code);
    }
    return result;
  }

  async preflight() {
    const probe = async (args, label) => {
      const result = await this.docker(args, { label });
      if (result.code !== 0 || !result.stdout.trim()) {
        printE2ECaptured(result);
        throw e2eFailure(`${label} unavailable (exit ${result.code}); no pull or live-resource fallback is permitted`);
      }
      return result.stdout.trim();
    };
    this.endpoint = await resolveLocalDockerEndpoint(probe);
    const daemon = await probe(["info", "--format", "{{.OSType}} {{.ServerVersion}}"], "Inspect local Linux Docker daemon");
    if (!/^linux\s+\S+/.test(daemon)) throw e2eFailure("The E2E images require a local Linux Docker daemon");
    const required = this.configuration.skipBuild ? ["postgres", "app", "worker"] : ["postgres", "node", "go", "alpine"];
    const missing = [];
    for (const kind of required) {
      const image = this.configuration.images[kind];
      const result = await this.docker(["image", "inspect", "--format", "{{json .}}", image], { label: `Inspect local ${kind} image ${image}` });
      if (result.code !== 0) { printE2ECaptured(result); missing.push(image); continue; }
      const metadata = parseInspection(result, `Inspect ${kind} image`);
      if (!IMAGE_ID.test(metadata.Id ?? "") || metadata.Os !== "linux") throw e2eFailure(`Invalid local Linux image: ${image}`);
      if (["app", "worker"].includes(kind) && Object.keys(metadata.Config?.Volumes ?? {}).length) {
        throw e2eFailure("Prebuilt E2E runtime images may not declare persistent volumes");
      }
      this.localImages.set(kind, metadata.Id);
      console.log(`[verify:e2e] Local ${kind} image: ${metadata.Id}`);
    }
    if (missing.length) throw e2eFailure(`Required local images are absent: ${missing.join(", ")}. No images were pulled; no containers, networks or builds were created.`);

    // Only read-only prerequisites precede scratch creation. Docker gets no
    // inherited registry credentials, proxy config or selected remote builder.
    const plugins = JSON.parse(await probe(["info", "--format", "{{json .ClientInfo.Plugins}}"], "Locate installed local Compose plugin"));
    this.workspace = createE2EWorkspace(this.configuration.owner, undefined, e2eComposePluginDirectory(plugins));
    await probe(["compose", "--env-file", this.workspace.envFile, "--project-directory", this.projectRoot, "version", "--short"], "Check Docker Compose plugin");
    const preflightProject = createE2EProject(this.configuration, "preflight");
    const config = await this.docker(e2eComposeArgs(this.projectRoot, this.workspace, preflightProject, ["config", "--quiet"]), {
      label: "Validate isolated E2E Compose configuration", env: e2eComposeEnvironment(this.configuration, preflightProject),
    });
    if (config.code !== 0) { printE2ECaptured(config); throw e2eFailure(`E2E Compose configuration failed (exit ${config.code})`); }
    if (!this.configuration.skipBuild) {
      for (const kind of ["app", "worker"]) {
        const existing = await this.docker(["image", "inspect", this.configuration.images[kind]], { label: `Check unused generated ${kind} image tag` });
        if (existing.code === 0) throw e2eFailure("Generated E2E image tag already exists; refusing to overwrite it");
      }
    }
    this.preflightPassed = true;
  }

  async buildImages() {
    if (!this.preflightPassed) throw e2eFailure("Local Docker/image preflight must pass before any build");
    if (this.configuration.skipBuild) return;
    for (const kind of ["app", "worker"]) {
      const app = kind === "app";
      const image = this.configuration.images[kind];
      const bases = app ? [["NODE_BASE_IMAGE", "node"], ["GO_BASE_IMAGE", "go"]] : [["GO_BASE_IMAGE", "go"], ["ALPINE_BASE_IMAGE", "alpine"]];
      // The local daemon's classic builder consumes the inspected image IDs;
      // never switch to a buildx/container/remote builder that could fetch bases.
      const args = ["build", "--pull=false", "--force-rm", "--label", `${E2E_OWNER_LABEL}=${this.configuration.owner}`,
        "-f", app ? "Dockerfile" : "worker/Dockerfile", "-t", image,
        ...bases.flatMap(([arg, base]) => ["--build-arg", `${arg}=${this.localImages.get(base)}`]), "."];
      this.buildAttempts.add(image);
      const result = await this.docker(args, {
        label: `Build owned ${kind} image`, capture: false, timeoutMs: app ? 600_000 : 300_000,
        env: { ...this.configuration.systemEnv, DOCKER_BUILDKIT: "0" },
      });
      const inspection = await this.docker(["image", "inspect", "--format", "{{json .}}", image], { label: `Inspect built ${kind} image` });
      if (inspection.code === 0) {
        const metadata = parseInspection(inspection, "Built image inspection");
        if (metadata.Config?.Labels?.[E2E_OWNER_LABEL] !== this.configuration.owner || !IMAGE_ID.test(metadata.Id ?? "")) {
          throw e2eFailure("Built image owner label mismatch");
        }
        this.builtImages.set(image, metadata.Id);
        console.log(`[verify:e2e] Built ${kind} image: ${metadata.Id}; owner=${this.configuration.owner}`);
      }
      if (result.code !== 0) { printE2ECaptured(result); throw e2eFailure(`${kind} build failed (exit ${result.code})`, result.code); }
      if (!this.builtImages.has(image)) throw e2eFailure("Build succeeded without an inspectable owned image");
    }
  }

  async createProject(label, options = {}) {
    if (!this.preflightPassed || (!this.configuration.skipBuild && this.builtImages.size !== 2)) {
      throw e2eFailure("Runtime creation requires successful local-image preflight and both built images");
    }
    const project = createE2EProject(this.configuration, label, options);
    this.projects.add(project);
    const containers = await this.checkedDocker(["container", "ls", "--all", "--quiet", "--filter", `label=${PROJECT_LABEL}=${project.name}`], { label: "Check unused E2E project" });
    const networks = await this.checkedDocker(["network", "ls", "--quiet", "--filter", `name=^${project.networkName}$`], { label: "Check unused E2E network" });
    if (containers.stdout.trim() || networks.stdout.trim()) throw e2eFailure("E2E project/network already exists; no resource will be reused");
    project.creationAttempted = true;
    const created = await this.checkedDocker(["network", "create", "--internal", "--driver", "bridge",
      "--label", `${E2E_OWNER_LABEL}=${this.configuration.owner}`, "--label", `${PROJECT_LABEL}=${project.name}`, project.networkName], { label: `Create isolated network ${project.networkName}` });
    project.networkId = created.stdout.trim();
    await this.inspectNetwork(project);
    return project;
  }

  assertRegisteredProject(project) {
    if (!this.projects.has(project)) throw e2eFailure("Unknown E2E project; refusing external resource access");
    assertE2EProject(this.configuration, project);
  }

  async inspectNetwork(project, options = {}) {
    this.assertRegisteredProject(project);
    const result = await this.docker(["network", "inspect", "--format", "{{json .}}", project.networkName], { ...options, label: "Verify exact owned internal network" });
    const network = parseInspection(result, "Network inspection");
    assertE2ENetwork(this.configuration, project, network);
    return network;
  }

  async containers(project, options = {}) {
    this.assertRegisteredProject(project);
    const listed = await this.checkedDocker(["container", "ls", "--all", "--quiet", "--filter", `label=${PROJECT_LABEL}=${project.name}`], { ...options, label: "List exact E2E project containers" });
    const ids = listed.stdout.trim().split(/\s+/).filter(Boolean);
    if (ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id))) throw e2eFailure("Invalid container ID in E2E inventory");
    if (!ids.length) return [];
    const result = await this.docker(["container", "inspect", ...ids], { ...options, label: "Verify E2E container ownership" });
    const containers = parseInspection(result, "Container inspection");
    if (!Array.isArray(containers) || containers.length !== ids.length) throw e2eFailure("Incomplete E2E container inventory");
    for (const container of containers) assertE2EContainer(this.configuration, project, container);
    return containers;
  }

  async assertDatabase(project, options = {}) {
    const containers = await this.containers(project, options);
    const databases = containers.filter((container) => container.Config.Labels["com.docker.compose.service"] === "db");
    if (databases.length !== 1) throw e2eFailure("Expected exactly one owned E2E database");
    const database = databases[0];
    const env = Object.fromEntries((database.Config.Env ?? []).map((entry) => {
      const split = entry.indexOf("=");
      return [entry.slice(0, split), entry.slice(split + 1)];
    }));
    const networks = Object.keys(database.NetworkSettings?.Networks ?? {});
    if (env.POSTGRES_DB !== project.databaseName || env.POSTGRES_USER !== this.configuration.databaseUser
      || env.POSTGRES_PASSWORD !== this.configuration.databasePassword
      || database.Config.Image !== this.configuration.images.postgres
      || !database.HostConfig?.Tmpfs?.["/var/lib/postgresql/data"]
      || (database.Mounts ?? []).some((mount) => mount.Type !== "tmpfs")
      || networks.length !== 1 || networks[0] !== project.networkName) {
      throw e2eFailure("Refusing SQL outside the exact generated, tmpfs, isolated-network database");
    }
  }

  async compose(project, args, options = {}) {
    this.assertRegisteredProject(project);
    if (!project.creationAttempted || project.cleaned) throw e2eFailure("E2E project was not created by this run or is already cleaned");
    await this.inspectNetwork(project, options);
    await this.containers(project, options);
    return this.docker(e2eComposeArgs(this.projectRoot, this.workspace, project, args), {
      timeoutMs: 240_000, ...options, env: e2eComposeEnvironment(this.configuration, project),
    });
  }

  async checkedCompose(project, args, options = {}) {
    const result = await this.compose(project, args, options);
    if (result.code !== 0) { printE2ECaptured(result); throw e2eFailure(`${options.label ?? "Compose"} failed (exit ${result.code})`, result.code); }
    return result;
  }

  async cleanupProject(project, deadlineAt) {
    try {
      this.assertRegisteredProject(project);
      if (!project.creationAttempted || project.cleaned) return true;
      const options = { deadlineAt, timeoutMs: 10_000 };
      const containers = await this.containers(project, options);
      const listed = await this.checkedDocker(["network", "ls", "--quiet", "--filter", `name=^${project.networkName}$`], { ...options, label: "Locate exact E2E network for cleanup" });
      if (!listed.stdout.trim() && !containers.length) { project.cleaned = true; return true; }
      const network = await this.inspectNetwork(project, options);
      const ids = new Set(containers.map((container) => container.Id));
      if (Object.keys(network.Containers ?? {}).some((id) => !ids.has(id))) throw e2eFailure("Foreign container attached to E2E network; refusing cleanup");
      // No compose down, volume deletion, prune or prefix-based fallback. All
      // exact IDs are re-inspected before the first destructive command.
      if (ids.size) await this.checkedDocker(["container", "rm", "--force", ...ids], { ...options, timeoutMs: 30_000, label: `Remove owned containers for ${project.name}` });
      await this.inspectNetwork(project, options);
      await this.checkedDocker(["network", "rm", network.Id], { ...options, label: `Remove owned network for ${project.name}` });
      project.cleaned = true;
      return true;
    } catch (error) {
      console.error(`[verify:e2e] Cleanup refused/failed for ${project.name}: ${error.message}`);
      return false;
    }
  }

  async cleanup(deadlineAt) {
    let clean = true;
    for (const project of this.projects) if (!await this.cleanupProject(project, deadlineAt)) clean = false;
    if (!this.configuration.keepImages && !this.configuration.skipBuild) {
      for (const image of this.buildAttempts) {
        try {
          const found = await this.checkedDocker(["image", "ls", "--quiet", "--filter", `reference=${image}`], { deadlineAt, label: "Locate exact attempted E2E image" });
          if (!found.stdout.trim()) continue;
          const result = await this.docker(["image", "inspect", "--format", "{{json .}}", image], { deadlineAt, label: "Verify built image before removal" });
          const metadata = parseInspection(result, "Image cleanup inspection");
          if (!this.builtImages.has(image) && metadata.Config?.Labels?.[E2E_OWNER_LABEL] === this.configuration.owner && IMAGE_ID.test(metadata.Id ?? "")) {
            this.builtImages.set(image, metadata.Id);
          }
          assertE2EBuiltImage(this.configuration, image, metadata, this.builtImages);
          await this.checkedDocker(["image", "rm", image], { deadlineAt, timeoutMs: 20_000, label: `Remove owned image ${image}` });
        } catch (error) { console.error(`[verify:e2e] Image cleanup refused/failed: ${error.message}`); clean = false; }
      }
    }
    if (!cleanupE2EWorkspace(this.workspace)) { console.error("[verify:e2e] Scratch cleanup refused/failed"); clean = false; }
    return clean;
  }
}

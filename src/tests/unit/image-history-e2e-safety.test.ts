// @vitest-environment node

import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertE2EContainer, assertE2EImageVolume, cleanupE2EWorkspace, createE2EConfiguration,
  createE2EProject, createE2EWorkspace, E2EHarness, E2E_OWNER_LABEL, e2eComposeArgs, e2eComposeEnvironment,
} from "../../../scripts/lib/e2e-safety.mjs";
import { hasExactImageCapability, imageHistoryCliProgress } from "../../../scripts/verify-e2e.mjs";
import { enableImageHistoryRetirementPolicy } from "../../../scripts/fixtures/image-history-runtime.mjs";
import imageMaintenance from "../../../contracts/media/v1/maintenance.json";
import {
  encodeImageAppRequest, performImageAppRequest, validateImageAppRequest,
} from "../../../scripts/fixtures/canvas-object-store.mjs";

const workspaces: ReturnType<typeof createE2EWorkspace>[] = [];
afterEach(() => {
  for (const workspace of workspaces.splice(0)) expect(cleanupE2EWorkspace(workspace)).toBe(true);
  vi.restoreAllMocks();
});

function volumeFixture() {
  const configuration = createE2EConfiguration({});
  const project = {
    ...createE2EProject(configuration, "image-owned", { canvas: true, images: true }),
    creationAttempted: true, volumeCreationAttempted: true, volumeCreatedAt: "2026-11-15T00:00:00Z",
  };
  const volume = { Name: project.volumeName, Driver: "local", Scope: "local", Options: null,
    CreatedAt: project.volumeCreatedAt, Labels: { [E2E_OWNER_LABEL]: configuration.owner, "com.docker.compose.project": project.name } };
  return { configuration, project, volume };
}

describe("owned image-history topology resources", () => {
  it("requires the exact new local volume identity with no bind/NFS driver options", () => {
    const { configuration, project, volume } = volumeFixture();
    expect(assertE2EImageVolume(configuration, project, volume)).toBe(project.volumeName);
    for (const changed of [
      { ...volume, Name: "existing-user-volume" }, { ...volume, Driver: "nfs" },
      { ...volume, Options: { type: "none", device: "/private", o: "bind" } },
      { ...volume, Scope: "global" }, { ...volume, CreatedAt: "2026-11-14T00:00:00Z" },
      { ...volume, Labels: { ...volume.Labels, [E2E_OWNER_LABEL]: "other-run" } },
    ]) expect(() => assertE2EImageVolume(configuration, project, changed)).toThrow(/Refusing a volume/);
    expect(() => assertE2EImageVolume(configuration, { ...project, volumeCreationAttempted: false }, volume)).toThrow();
  });

  it("rejects an app using a bind mount, another volume or a read-only image mount", () => {
    const { configuration, project } = volumeFixture();
    const mount = { Type: "volume", Name: project.volumeName, Destination: "/data/images", RW: true };
    const container = { Id: "a".repeat(64), Name: `/${project.name}-app-1`, Config: {
      Labels: { [E2E_OWNER_LABEL]: configuration.owner, "com.docker.compose.project": project.name, "com.docker.compose.service": "app" },
    }, Mounts: [mount], HostConfig: {}, NetworkSettings: {} };
    expect(assertE2EContainer(configuration, project, container)).toBe(container.Id);
    for (const changed of [{ ...mount, Type: "bind" }, { ...mount, Name: "foreign" }, { ...mount, RW: false }, { ...mount, Destination: "/app" }]) {
      expect(() => assertE2EContainer(configuration, project, { ...container, Mounts: [changed] })).toThrow(/verified image volume/);
    }
    expect(() => assertE2EContainer(configuration, project, { ...container, Mounts: [mount, mount] })).toThrow();
  });

  it("accepts only the explicitly registered standalone history-copy container on the owned image volume", () => {
    const { configuration, project } = volumeFixture();
    const name = `${project.name}-image-history-copy`;
    const container = { Id: "b".repeat(64), Name: `/${name}`, Config: {
      Labels: { [E2E_OWNER_LABEL]: configuration.owner, "com.docker.compose.project": project.name, "com.docker.compose.service": "worker" },
    }, Mounts: [{ Type: "volume", Name: project.volumeName, Destination: "/data/images", RW: true }], HostConfig: {}, NetworkSettings: {} };
    expect(() => assertE2EContainer(configuration, project, container)).toThrow();
    project.oneOffNames.add(name);
    expect(assertE2EContainer(configuration, project, container)).toBe(container.Id);
    const arbitrary = `${project.name}-unreviewed-command`;
    project.oneOffNames.add(arbitrary);
    expect(() => assertE2EContainer(configuration, project, { ...container, Name: `/${arbitrary}` })).toThrow();
    expect(() => assertE2EContainer(configuration, project, { ...container, Config: { Labels: {
      ...container.Config.Labels, "com.docker.compose.service": "app",
    } } })).toThrow();
    expect(() => assertE2EContainer(configuration, project, { ...container, Mounts: [{ ...container.Mounts[0], Name: "foreign-volume" }] })).toThrow();
  });

  it("only injects the fixed image overlay and ignores caller volume/backend/credential options", () => {
    const { configuration, project } = volumeFixture();
    const workspace = createE2EWorkspace(configuration.owner);
    workspaces.push(workspace);
    const args = e2eComposeArgs(process.cwd(), workspace, project, ["up", "-d", "app"]);
    expect(args).toContain(path.join(process.cwd(), "docker-compose.image-history.e2e.yml"));
    expect(args).toContain("--pull=never");
    expect(args).toContain("--no-build");
    expect(e2eComposeEnvironment(configuration, project).E2E_IMAGE_VOLUME_NAME).toBe(project.volumeName);
    expect(() => e2eComposeArgs(process.cwd(), workspace, project, ["-f", "foreign.yml", "up"])).toThrow();
    const generic = createE2EProject(configuration, "legacy");
    expect(e2eComposeArgs(process.cwd(), workspace, generic, ["config"])).not.toContain(path.join(process.cwd(), "docker-compose.image-history.e2e.yml"));
  });

  it.each([false, true])("requires zero remaining container attachments before deleting only the exact image volume (foreign=%s)", async (attached) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { configuration, project, volume } = volumeFixture();
    const calls: string[][] = [];
    const run = vi.fn(async (command: { args: string[] }) => {
      const args = [...command.args];
      while (["--host", "--config"].includes(args[0])) args.splice(0, 2);
      calls.push(args);
      let stdout = "";
      if (args.slice(0, 2).join(" ") === "volume inspect") stdout = JSON.stringify(volume);
      else if (args.slice(0, 2).join(" ") === "volume ls") stdout = project.volumeName;
      else if (args.slice(0, 2).join(" ") === "container ls" && args.includes(`volume=${project.volumeName}`) && attached) stdout = "f".repeat(64);
      else if (!["container ls", "network ls", "volume rm"].includes(args.slice(0, 2).join(" "))) throw new Error("Unexpected fixture operation");
      return { code: 0, stdout, stderr: "", timedOut: false, signal: null, durationMs: 1 };
    });
    const harness = new E2EHarness({ projectRoot: process.cwd(), configuration, run, deadlineAt: Date.now() + 10_000 });
    harness.workspace = createE2EWorkspace(configuration.owner);
    workspaces.push(harness.workspace);
    harness.endpoint = "unix:///var/run/docker.sock";
    harness.projects.add(project);
    expect(await harness.cleanupProject(project, Date.now() + 5_000)).toBe(!attached);
    expect(calls.filter((args) => args.slice(0, 2).join(" ") === "volume rm")).toEqual(attached ? [] : [["volume", "rm", project.volumeName]]);
    expect(calls.every((args) => !args.includes("--force") && !args.includes("--volumes"))).toBe(true);
  });
});

describe("image-history runtime verification boundaries", () => {
  const owner = "11111111-1111-4111-8111-111111111111";
  const token = "a".repeat(64);
  const url = `https://narra-e2e.invalid/media/images/${token}`;

  it("proves disabled retirement before enabling only explicit maintenance with the current policy version", async () => {
    const policy = { version: 7, enabled: false, limitBytes: "110100480", quotaCleanupEnabled: false,
      scheduleEnabled: false, retentionDays: 14, intervalSeconds: 3000, nextRunAt: null };
    const order: string[] = [];
    const resume = vi.fn(async () => {
      order.push("disabled refusal");
      // Match historyCommandResult from worker/cmd/image-history/main.go:
      // the public command wraps its internal ApplyReport in progress.
      return { schemaVersion: 1, dryRun: false, code: "IMAGE_HISTORY_PENDING", status: "pending",
        progress: { schemaVersion: 1, dryRun: false, processed: 1, blocked: 1, hasMore: true,
          items: [{ subjectKind: "CANVAS_IMPORT", subjectId: owner, code: "IMAGE_POLICY_DISABLED",
            state: "BLOCKED", stateAcknowledged: true, readerVerified: true, retirementJobId: null }] } };
    });
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT to_jsonb(p)")) { order.push("read policy"); return policy; }
      const payload = /^SELECT image_update_storage_policy\('([^']+)'::jsonb\);$/.exec(sql);
      expect(payload, "Policy activation must use the real SQL contract").not.toBeNull();
      expect(resume).toHaveBeenCalledOnce();
      const input = JSON.parse(payload![1]);
      expect(input).toEqual({ expectedVersion: 7, enabled: true, limitBytes: "110100480", quotaCleanupEnabled: false,
        scheduleEnabled: false, retentionDays: 14, intervalSeconds: 3000 });
      order.push("enable explicit maintenance");
      return { ...policy, ...input, version: 8 };
    });
    await enableImageHistoryRetirementPolicy({ query, resume, subjectId: owner });
    expect(order).toEqual(["read policy", "disabled refusal", "enable explicit maintenance"]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it.each([
    { code: "IMAGE_READER_INCOMPATIBLE", readerVerified: false },
    { code: "IMAGE_POLICY_DISABLED", readerVerified: false },
  ])("does not enable policy when the observed refusal is not a verified policy guard: %j", async (failure) => {
    const query = vi.fn(async () => ({ version: 1, enabled: false }));
    const resume = vi.fn(async () => ({ schemaVersion: 1, dryRun: false, code: "IMAGE_HISTORY_PENDING", status: "pending",
      progress: { schemaVersion: 1, dryRun: false, processed: 1, blocked: 1, hasMore: true,
        items: [{ subjectKind: "CANVAS_IMPORT", subjectId: owner,
          state: "BLOCKED", stateAcknowledged: true, retirementJobId: null, ...failure }] } }));
    await expect(enableImageHistoryRetirementPolicy({ query, resume, subjectId: owner })).rejects.toThrow();
    expect(query).toHaveBeenCalledOnce();
  });

  it("keeps the original CLI policy error and read proof without leaking binding or storage details", () => {
    const progress = imageHistoryCliProgress({ schemaVersion: 1, dryRun: false, code: "IMAGE_HISTORY_PENDING", status: "pending",
      progress: { schemaVersion: 1, dryRun: false, processed: 1, blocked: 1, hasMore: true,
        job: { publicUrlBase: "https://private.invalid", planDigest: "private-plan" },
        items: [{ subjectKind: "CANVAS_IMPORT", subjectId: "private-subject", state: "BLOCKED", code: "IMAGE_POLICY_DISABLED",
          stateAcknowledged: true, readerVerified: true, putAttempted: false, switched: false, storageKey: "/private/image.png" }] } });
    expect(progress).toEqual({ processed: 1, blocked: 1, hasMore: true, code: "IMAGE_HISTORY_PENDING",
      items: [{ subjectKind: "CANVAS_IMPORT", state: "BLOCKED", code: "IMAGE_POLICY_DISABLED", stateAcknowledged: true,
        readerVerified: true, putAttempted: false, switched: false }] });
    expect(JSON.stringify(progress)).not.toContain("private");
    const bounded = imageHistoryCliProgress({ schemaVersion: 1, dryRun: false, code: "IMAGE_HISTORY_PENDING", status: "pending",
      progress: { items: Array.from({ length: 150 }, () => ({
        subjectKind: "https://private.invalid", state: "private\nBLOCKED", code: "IMAGE_ERROR\nprivate", readerVerified: "true",
      })) } });
    expect(bounded.items).toHaveLength(100);
    expect(bounded.items[0]).toEqual({ subjectKind: null, state: null, code: null, stateAcknowledged: false,
      readerVerified: false, putAttempted: false, switched: false });
  });

  it("compares all eight live capability fields and rejects old reader/executor revisions", () => {
    const location = { provider: "LOCAL", locationId: `local-v1:${owner}` };
    const current = { version: 1, schema: "ready", ...location, maintenance: "running",
      storageRevision: imageMaintenance.storageRevision, readerRevision: imageMaintenance.readerRevision, executorRevision: imageMaintenance.executorRevision };
    expect(hasExactImageCapability({ capabilities: { images: current } }, location)).toBe(true);
    expect(hasExactImageCapability({ capabilities: { images: { ...current, provider: undefined, locationId: undefined } } })).toBe(false);
    for (const field of ["storageRevision", "readerRevision", "executorRevision"]) {
      expect(hasExactImageCapability({ capabilities: { images: { ...current, [field]: 2 } } }, location)).toBe(false);
    }
    expect(hasExactImageCapability({ capabilities: { images: { ...current, locationId: `local-v1:${"2".repeat(36)}` } } }, location)).toBe(false);
    expect(hasExactImageCapability({ capabilities: { images: { ...current, extra: true } } }, location)).toBe(false);
    expect(hasExactImageCapability({ status: "ready" }, location)).toBe(false);
  });

  it.each([
    "/api/proxy-image?url=https%3A%2F%2Fprivate.invalid%2Fimage.png", "/_next/image?url=%2Fadmin&w=384&q=75",
    `/api/proxy-image?url=${encodeURIComponent(url)}&extra=1`, "//external.invalid/api/readyz",
    "/media/images/%2e%2e", "/api/me/canvases/%2e%2e", "/api/admin/users",
  ])("rejects non-fixture image transport destinations: %s", async (route) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(encodeImageAppRequest(owner, route)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves actual binary response bytes and limits proxy/optimizer requests to fixture objects", async () => {
    const bytes = Buffer.from([0, 255, 3, 254]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(bytes, { headers: { "content-type": "image/png", etag: '"fixture"' } }));
    const request = JSON.parse(await encodeImageAppRequest(owner, `/media/images/${token}`));
    expect(validateImageAppRequest(request, owner)).toEqual(request);
    const response = await performImageAppRequest(request, owner);
    expect(Buffer.from(response.bodyBase64!, "base64")).toEqual(bytes);
    expect(response.headers?.etag).toBe('"fixture"');
    expect(JSON.parse(await encodeImageAppRequest(owner, `/api/proxy-image?url=${encodeURIComponent(url)}`)).path).toContain("/api/proxy-image?");
    expect(JSON.parse(await encodeImageAppRequest(owner, "/api/generate", { method: "POST", body: "{}" })).headers).not.toHaveProperty("x-narra-canvas-run");
  });
});

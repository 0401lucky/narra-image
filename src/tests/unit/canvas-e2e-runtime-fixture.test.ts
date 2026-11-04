// @vitest-environment node

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyCanvasImage } from "@/lib/canvas/image-container";
import { parseGenerateRequest } from "@/lib/generation/parse-generate-request";
import { canvasFixtureBytes, encodeCanvasAppRequest } from "../../../scripts/fixtures/canvas-object-store.mjs";
import { assertCanvasGcView, canvasApiHeaders, canvasGcClockSql, canvasGcInspectionSql, createCanvasRuntimeFixture, loadCanvasRuntimeContracts, runCanvasRuntimeSmoke } from "../../../scripts/fixtures/canvas-runtime.mjs";
import { createE2EConfiguration, createE2EProject } from "../../../scripts/lib/e2e-safety.mjs";
import retention from "../../../contracts/canvas/v1/retention.json";

function setup(phase: "failed" | "deleted" = "failed") {
  const configuration = createE2EConfiguration({});
  const project = createE2EProject(configuration, "canvas-fixture", { canvas: true });
  const fixture = createCanvasRuntimeFixture(configuration, project);
  const assets = Object.fromEntries(["orphan", "recent", "saved", "job"].map((name) => [name, { id: randomUUID() }]));
  Object.assign(fixture.assets, assets);
  const view = {
    assets: Object.fromEntries(Object.entries(assets).map(([name, asset]) => [asset.id, {
      state: name === "orphan" ? phase === "failed" ? "DELETING" : "DELETED" : "READY",
      key: `canvas-imports/${asset.id}.png`, accounted: name !== "orphan" || phase === "failed",
      outcome: name === "orphan" ? phase === "failed" ? "FAILED" : "DELETED" : "NOT_STARTED",
      attempts: name === "orphan" ? phase === "failed" ? 1 : 2 : 0,
      retrySeconds: name === "orphan" && phase === "failed" ? 10 : null,
    }])),
    savedRoots: 1, jobRoots: 1, jobs: 1, runs: 1, images: 1, credits: 100, retainedJob: true, deletedOrganization: true,
  };
  return { configuration, project, fixture, assets, view };
}

describe("enabled E2E runtime fixture assertions", () => {
  beforeEach(() => {
    // The real opt-in parser loads auth/database configuration before reading JSON.
    vi.stubEnv("AUTH_SECRET", "canvas-runtime-fixture-only-auth-secret");
    vi.stubEnv("DATABASE_URL", "postgresql://127.0.0.1:1/canvas_fixture_never_connect");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses an actual image accepted by production verification, not arbitrary fixture bytes", () => {
    expect(verifyCanvasImage(canvasFixtureBytes(), "image/png")).toEqual({ width: 1, height: 1 });
    const first = canvasFixtureBytes();
    first.fill(0);
    expect(canvasFixtureBytes()[0]).toBe(0x89);
  });

  it("loads production pure normalization/canonicalization and transport headers without copying them", async () => {
    const contracts = await loadCanvasRuntimeContracts();
    expect(contracts.canonicalCanvasJson({ z: 1, a: [{ b: 2, a: 1 }], omitted: undefined })).toBe('{"a":[{"a":1,"b":2}],"z":1}');
    expect(contracts.CANVAS_RUN_REQUEST_HEADERS).toEqual({ "Content-Type": "application/json", "X-Narra-Canvas-Run": "1" });
    expect(typeof contracts.canvasRunSchema.parse).toBe("function");
  });

  it("sends exactly one JSON media type through the relay and real opt-in generation parser", async () => {
    const { configuration, fixture } = setup();
    const contracts = await loadCanvasRuntimeContracts();
    const wire = contracts.canvasRunSchema.parse({ canvasId: fixture.canvasId, nodeId: fixture.nodeId, runId: fixture.runId,
      input: { prompt: { sourceNodeId: randomUUID(), text: "Fixture prompt" }, references: [] },
      parameters: { model: "gpt-image-2", generationType: "text_to_image", count: 1 },
    });
    const body = JSON.stringify({ canvasRun: wire });
    const bad = new Request("http://127.0.0.1:3000/api/generate", { method: "POST", body,
      headers: { "content-type": "application/json", ...contracts.CANVAS_RUN_REQUEST_HEADERS },
    });
    expect(bad.headers.get("content-type")).toBe("application/json, application/json");
    await expect(parseGenerateRequest(bad)).rejects.toMatchObject({ code: "CANVAS_INVALID_INPUT" });
    const encoded = await encodeCanvasAppRequest(configuration.owner, "/api/generate", { method: "POST", body,
      headers: canvasApiHeaders("narra_session=fixture-only", true, contracts.CANVAS_RUN_REQUEST_HEADERS),
    });
    const relayed = JSON.parse(encoded);
    expect(relayed.headers["content-type"]).toBe("application/json");
    const parsed = await parseGenerateRequest(new Request("http://127.0.0.1:3000/api/generate", {
      method: relayed.method, headers: relayed.headers, body: Buffer.from(relayed.bodyBase64, "base64"),
    }));
    expect(parsed.canvasRun).toEqual(wire);
  });

  it("requires an owned enabled project and gives synthetic accounts/keys fresh identities", () => {
    const { configuration, project, fixture } = setup();
    const next = createCanvasRuntimeFixture(configuration, project);
    expect(fixture.ownerId).not.toBe(next.ownerId);
    expect(fixture.ownerId).not.toBe(fixture.otherOwnerId);
    expect(fixture.generatedKey).toMatch(new RegExp(`^e2e/${configuration.owner}/[a-f0-9-]+\\.png$`));
    expect(() => createCanvasRuntimeFixture(configuration, { ...project, owner: "foreign" })).toThrow(/namespace/);
    expect(() => createCanvasRuntimeFixture(configuration, { ...project, canvas: false })).toThrow(/enabled/);
  });

  it("seeds only exact import timestamps using shared seven-day database-clock retention, never claims or finishes GC", () => {
    const { fixture, assets } = setup();
    const sql = canvasGcClockSql(fixture);
    expect(sql).toContain(`THEN ${Math.floor(retention.graceSeconds / 2)} ELSE ${retention.graceSeconds + 60}`);
    expect(sql).toContain(`"ownerId"='${fixture.ownerId}'::text`);
    for (const asset of Object.values(assets)) expect(sql).toContain(`'${asset.id}'::text`);
    expect(sql).toContain("clock_timestamp()");
    expect(sql).toContain("SET LOCAL session_replication_role = replica;");
    expect(sql).toContain("SET LOCAL session_replication_role = origin;");
    expect(sql).not.toMatch(/canvas_claim_imports|canvas_finish_asset_delete|canvas_acquire_gc_lease|DELETE FROM|DROP |DISABLE TRIGGER/);
    const query = canvasGcInspectionSql(fixture);
    expect(query).toContain('"CanvasSavedAssetUse"');
    expect(query).toContain('"CanvasJobAssetUse"');
    expect(query).toContain('"cancelRequestedAt" IS NULL AND "refundAppliedAt" IS NULL');
  });

  it.each(["failed", "deleted"] as const)("requires the real %s outcome with exact accounting, retry and protected inventory", (phase) => {
    const { fixture, view } = setup(phase);
    expect(() => assertCanvasGcView(view, fixture, phase)).not.toThrow();
    expect(() => assertCanvasGcView(view, fixture, phase === "failed" ? "deleted" : "failed")).toThrow(/outcome/);
  });

  it.each(["state", "outcome", "accounted", "attempts", "backoff", "root", "recent", "inventory", "credits", "job", "image", "organization"])("cannot report a pass after %s evidence is lost", (failure) => {
    const { fixture, assets, view } = setup();
    const orphan = view.assets[assets.orphan.id];
    if (failure === "state") orphan.state = "READY";
    if (failure === "outcome") orphan.outcome = "NOT_STARTED";
    if (failure === "accounted") orphan.accounted = false;
    if (failure === "attempts") orphan.attempts = 0;
    if (failure === "backoff") orphan.retrySeconds = 0;
    if (failure === "root") view.jobRoots = 0;
    if (failure === "recent") view.assets[assets.recent.id].attempts = 1;
    if (failure === "inventory") delete view.assets[assets.saved.id];
    if (failure === "credits") view.credits = 95;
    if (failure === "job") view.retainedJob = false;
    if (failure === "image") view.images = 0;
    if (failure === "organization") view.deletedOrganization = false;
    expect(() => assertCanvasGcView(view, fixture, "failed")).toThrow();
  });

  it("requires the explicit owned HTTP transport before database or fixture access", async () => {
    const { configuration, project } = setup();
    const sql = vi.fn();
    const operation = vi.fn();
    await expect(runCanvasRuntimeSmoke({ configuration, project, request: undefined, sql, control: operation, objects: operation, wait: operation })).rejects.toThrow(/internal HTTP/);
    expect(sql).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });
});

// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import expressions from "../../../contracts/canvas/v1/scenarios/catalog-expressions.json";

import { CANVAS_SCHEMA_CONTRACT, CANVAS_SCHEMA_QUERY_V1, checkCanvasSchemaInventoryV1, normalizeCanvasCatalogExpressionV1, probeCanvasSchemaV1 } from "@/lib/canvas/schema-probe";

const inventory = () => structuredClone(CANVAS_SCHEMA_CONTRACT.objects);
const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261029090000_canvas_v1/migration.sql"), "utf8").replaceAll("\r\n", "\n");

describe("canvas read-only schema contract", () => {
  it("requires the complete inventory and tolerates unrelated additive objects", () => {
    expect(checkCanvasSchemaInventoryV1(inventory())).toEqual({ version: 1, ready: true, code: null, issues: [] });
    expect(checkCanvasSchemaInventoryV1([...inventory(), { kind: "table", name: "FutureTable", definition: {} }]).ready).toBe(true);
    for (const kind of ["table", "column", "enum", "index", "constraint", "function", "trigger"]) {
      const rows = inventory();
      const missing = rows.find((item) => item.kind === kind)!;
      expect(checkCanvasSchemaInventoryV1(rows.filter((item) => item !== missing)).issues).toContainEqual({ kind, name: missing.name, reason: "missing" });
    }
    expect(checkCanvasSchemaInventoryV1([...inventory(), inventory()[0]]).issues[0].reason).toBe("duplicate");
  });

  it.each([
    ["column", "CanvasRun.state", "default", "'COMMITTED'"],
    ["column", "Canvas.userId", "nullable", false],
    ["index", "CanvasImportAsset_owner_upload_key", "unique", false],
    ["index", "CanvasImportAsset_gc_idx", "valid", false],
    ["constraint", "CanvasRun_liveJobId_fkey", "deleteAction", "c"],
    ["constraint", "CanvasRun_state_check", "expression", "true"],
    ["trigger", "CanvasSavedAssetUse_ready_guard", "enabled", "D"],
    ["trigger", "CanvasRun_committed_roots_guard", "deferred", false],
    ["function", "canvas_lock_assets", "bodyMd5", "0".repeat(32)],
    ["function", "canvas_claim_imports", "securityDefiner", true],
    ["function", "canvas_lock_assets", "argumentDefaults", "false"],
    ["function", "canvas_lock_assets", "defaultCount", 0],
    ["function", "canvas_lock_assets", "argumentNames", ["p_owner", "p_ids", "different_parameter"]],
  ])("fails closed for %s %s %s drift", (kind, name, key, value) => {
    const rows = inventory();
    const row = rows.find((item) => item.kind === kind && item.name === name)!;
    (row.definition as Record<string, unknown>)[key as string] = value;
    expect(checkCanvasSchemaInventoryV1(rows).issues).toContainEqual({ kind, name, reason: "mismatch" });
  });

  it("checks full function bodies/signatures against the unpublished SQL, not just names", () => {
    expect(createHash("sha256").update(sql).digest("hex")).toBe(CANVAS_SCHEMA_CONTRACT.migrationSha256);
    const definitions = [...sql.matchAll(/CREATE FUNCTION (canvas_\w+)\((.*?)\)[\s\S]*? AS \$\$([\s\S]*?)\$\$;/g)];
    const functions = CANVAS_SCHEMA_CONTRACT.objects.filter((item) => item.kind === "function");
    expect(functions).toHaveLength(definitions.length);
    for (const [, name, args, body] of definitions) {
      const expected = functions.find((item) => item.name === name);
      const parameters = args ? args.split(",").map((parameter) => parameter.trim()) : [];
      const defaults = parameters.flatMap((parameter) => parameter.includes(" DEFAULT ") ? [parameter.split(" DEFAULT ")[1]] : []);
      expect(expected?.definition).toMatchObject({
        bodyMd5: createHash("md5").update(body).digest("hex"), securityDefiner: false,
        argumentNames: parameters.map((parameter) => parameter.split(/\s/)[0]),
        defaultCount: defaults.length, argumentDefaults: defaults.length ? defaults.join(", ") : null,
      });
    }
    for (const [kind, pattern] of [
      ["table", /CREATE TABLE "(Canvas[^"]*)"/g],
      ["trigger", /CREATE (?:CONSTRAINT )?TRIGGER "(Canvas[^"]*)"/g],
    ] as const) expect([...sql.matchAll(pattern)].map((match) => match[1]).sort()).toEqual(CANVAS_SCHEMA_CONTRACT.objects.filter((item) => item.kind === kind).map((item) => item.name).sort());
  });

  it("only queries the active schema catalog and never repairs or exposes raw failures", async () => {
    expect(CANVAS_SCHEMA_QUERY_V1).toContain("n.nspname=current_schema()");
    expect(CANVAS_SCHEMA_QUERY_V1).toContain("md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))");
    expect(CANVAS_SCHEMA_QUERY_V1).toContain("pg_get_expr(p.proargdefaults,0)");
    expect(CANVAS_SCHEMA_QUERY_V1).toContain("p.pronargdefaults");
    expect(CANVAS_SCHEMA_QUERY_V1).toContain("p.proargnames[1:p.pronargs]");
    expect(CANVAS_SCHEMA_QUERY_V1).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
    const query = vi.fn(async () => inventory());
    expect((await probeCanvasSchemaV1(query)).ready).toBe(true);
    expect(query).toHaveBeenCalledWith(CANVAS_SCHEMA_QUERY_V1);
    const failed = await probeCanvasSchemaV1(async () => { throw new Error("postgresql://private:password@remote/db private SQL"); });
    expect(failed).toMatchObject({ ready: false, code: "CANVAS_SCHEMA_CONTRACT_MISMATCH", issues: [{ kind: "catalog", name: "canvas", reason: "query_failed" }] });
    expect(JSON.stringify(failed)).not.toMatch(/postgresql|private|remote/);
    expect(checkCanvasSchemaInventoryV1(null).ready).toBe(false);
    expect(checkCanvasSchemaInventoryV1([{ kind: "table" }]).ready).toBe(false);
  });

  it("normalizes PostgreSQL's documented deparser casts/IN and BETWEEN forms", () => {
    expect(normalizeCanvasCatalogExpressionV1(`state IN ('READY','QUARANTINED')`)).toBe(normalizeCanvasCatalogExpressionV1(`state = ANY (ARRAY['READY'::"CanvasImportAssetState",'QUARANTINED'::"CanvasImportAssetState"])`));
    expect(normalizeCanvasCatalogExpressionV1('"byteLength" BETWEEN 1 AND 8388608')).toBe(normalizeCanvasCatalogExpressionV1('(("byteLength" >= 1) AND ("byteLength" <= 8388608))'));
    expect(normalizeCanvasCatalogExpressionV1("'READY'::\"CanvasImportAssetState\"")).not.toBe(normalizeCanvasCatalogExpressionV1("'ready'"));
  });

  it("shares a fail-closed structural SQL grammar with the future Go probe", () => {
    for (const vector of expressions.equivalent) {
      for (const expression of vector.expressions) expect(JSON.parse(normalizeCanvasCatalogExpressionV1(expression)), vector.id).toEqual(vector.canonical);
    }
    for (const vector of expressions.different) expect(normalizeCanvasCatalogExpressionV1(vector.left), vector.id).not.toBe(normalizeCanvasCatalogExpressionV1(vector.right));
    for (const expression of expressions.unsupported) {
      expect(() => normalizeCanvasCatalogExpressionV1(expression), expression).toThrow();
      const rows = inventory();
      const row = rows.find((item) => item.name === "CanvasRun_intent_check")!;
      (row.definition as Record<string, unknown>).expression = expression;
      expect(checkCanvasSchemaInventoryV1(rows).ready, expression).toBe(false);
    }
  });

  it("accepts scalar deparsed argument defaults but preserves meaningful body carriage returns", () => {
    const rows = inventory();
    const definition = rows.find((item) => item.kind === "function" && item.name === "canvas_reserve_run")!.definition as Record<string, unknown>;
    definition.argumentDefaults = "NULL::text";
    expect(checkCanvasSchemaInventoryV1(rows).ready).toBe(true);
    const body = sql.match(/CREATE FUNCTION canvas_lock_assets\([\s\S]*? AS \$\$([\s\S]*?)\$\$;/)![1];
    const fingerprint = (value: string) => createHash("md5").update(value.replaceAll("\r\n", "\n")).digest("hex");
    expect(fingerprint(body.replaceAll("\n", "\r\n"))).toBe(fingerprint(body));
    expect(fingerprint(body.replace("CANVAS_INVALID_INPUT", "CANVAS_INVALID_INPUT\r"))).not.toBe(fingerprint(body));
  });

  it.each([
    ["CanvasGcLease_singleton_check", `id = 'canvas-imports' AND (token IS NULL AND "expiresAt" IS NULL) OR (token IS NOT NULL AND "expiresAt" IS NOT NULL)`],
    ["CanvasRun_intent_check", `"intentHash" !~ '^[a-f0-9]{64}$' AND ("credentialFingerprint" IS NULL OR "credentialFingerprint" ~ '^[a-f0-9]{64}$')`],
    ["CanvasRun_intent_check", `"intenthash" ~ '^[a-f0-9]{64}$' AND ("credentialFingerprint" IS NULL OR "credentialFingerprint" ~ '^[a-f0-9]{64}$')`],
    ["CanvasJobAssetUse_ordinal_check", "ordinal::boolean::integer BETWEEN 1 AND 16"],
  ])("does not erase meaningful CHECK syntax for %s", (name, expression) => {
    const rows = inventory();
    const row = rows.find((item) => item.kind === "constraint" && item.name === name)!;
    (row.definition as Record<string, unknown>).expression = expression;
    expect(checkCanvasSchemaInventoryV1(rows).issues).toContainEqual({ kind: "constraint", name, reason: "mismatch" });
  });

  it("keeps inventory/root locks, immutable principals and exact database-clock retention in SQL", () => {
    expect(sql).not.toMatch(/ON DELETE CASCADE|\b(?:DROP|TRUNCATE)\s+(?:TABLE|TYPE)\b/i);
    expect(sql).toContain('ORDER BY id FOR UPDATE');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("interval '604800 seconds'");
    expect(sql).not.toContain("interval '7 days'");
    expect(sql).toContain("p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100");
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(sql).toContain('"physicalBytesAccounted" := true; NEW."needsReconciliation" := true');
    expect(sql).not.toMatch(/\bcurrent_time\b/i);
    const finish = sql.slice(sql.indexOf('CREATE FUNCTION canvas_finish_asset_delete'));
    expect(finish.indexOf('FOR UPDATE')).toBeLessThan(finish.indexOf('v_now := clock_timestamp()'));
  });
});

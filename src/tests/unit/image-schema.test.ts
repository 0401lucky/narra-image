// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ImageRepository, type ImageQueryer } from "@/lib/storage/image-repository";
import {
  IMAGE_SCHEMA_CATALOG_QUERY, IMAGE_SCHEMA_CONTRACT, checkImageSchemaInventory, imageSchemaInventorySchema, probeImageSchema,
  type ImageSchemaCatalogRow,
} from "@/lib/storage/image-schema";

function inventory(): ImageSchemaCatalogRow[] {
  return imageSchemaInventorySchema.parse(structuredClone(IMAGE_SCHEMA_CONTRACT.objects));
}

describe("managed image schema readiness", () => {
  it("requires every image invariant and tolerates unrelated additive objects", () => {
    expect(checkImageSchemaInventory(inventory())).toEqual({ version: 1, storageRevision: 3, ready: true, code: null, issues: [] });
    expect(checkImageSchemaInventory([...inventory(), { kind: "table", name: "FutureTable", definition: {} }]).ready).toBe(true);
    for (const kind of ["table", "column", "enum", "index", "constraint", "function", "trigger"]) {
      const rows = inventory();
      const missing = rows.find((row) => row.kind === kind)!;
      expect(checkImageSchemaInventory(rows.filter((row) => row !== missing)).issues).toContainEqual({ kind, name: missing.name, reason: "missing" });
    }
    expect(checkImageSchemaInventory([...inventory(), inventory()[0]]).issues).toContainEqual({ kind: inventory()[0].kind, name: inventory()[0].name, reason: "duplicate" });
  });

  it.each([
    ["column", "ImageQuota.usedBytes", "type", "integer"],
    ["column", "ImageObject.reservationId", "nullable", false],
    ["column", "ImageStorageLocation.volumeId", "nullable", false],
    ["index", "ImageObject_physical_key", "unique", false],
    ["index", "ImageObject_slot_key", "valid", false],
    ["constraint", "ImageAsset_active_object_fkey", "deleteAction", "c"],
    ["constraint", "ImageStorageLocation_provider_check", "expression", "true"],
    ["trigger", "ImageReference_guard", "enabled", "D"],
    ["trigger", "ImageObject_reservation_balance", "deferred", false],
    ["trigger", "GenerationJob_image_inputs", "columns", ["prompt"]],
    ["function", "image_storage_revision", "bodyMd5", "0".repeat(32)],
    ["function", "image_account_delta", "bodyMd5", "0".repeat(32)],
    ["function", "image_finish_object", "securityDefiner", true],
    ["function", "image_get_asset", "defaultCount", 0],
    ["function", "image_begin_object", "argumentNames", ["different_parameter"]],
    ["column", "CanvasGcLease.token", "nullable", false],
    ["constraint", "CanvasGcLease_singleton_check", "expression", "true"],
    ["function", "canvas_claim_imports_v2", "bodyMd5", "0".repeat(32)],
    ["function", "canvas_finish_asset_delete_v2", "securityDefiner", true],
    ["trigger", "CanvasImportAsset_lifecycle_guard", "enabled", "D"],
    ["enum", "CanvasPutOutcome", "labels", ["CONFIRMED", "NOT_STARTED", "UNKNOWN"]],
  ] as const)("rejects %s %s %s drift", (kind, name, key, value) => {
    const rows = inventory();
    const row = rows.find((item) => item.kind === kind && item.name === name)!;
    row.definition[key] = typeof value === "object" ? [...value] : value;
    expect(checkImageSchemaInventory(rows).issues).toContainEqual({ kind, name, reason: "mismatch" });
  });

  it("matches the complete migration and guards, including full function bodies", () => {
    const sql = IMAGE_SCHEMA_CONTRACT.migrations.map((migration) => {
      const source = readFileSync(path.join(process.cwd(), "prisma/migrations", migration.name, "migration.sql"), "utf8").replaceAll("\r\n", "\n");
      expect(createHash("sha256").update(source).digest("hex")).toBe(migration.sha256);
      return source;
    }).join("\n");
    const definitions = [...new Map([...sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION ((?:image|canvas)_\w+)\((.*?)\)[\s\S]*? AS \$\$([\s\S]*?)\$\$;/g)].map((match) => [match[1], match])).values()];
    const functions = inventory().filter((row) => row.kind === "function");
    expect(functions).toHaveLength(definitions.length);
    for (const [, name, args, body] of definitions) {
      const parameters = args ? args.split(",").map((argument) => argument.trim()) : [];
      expect(functions.find((row) => row.name === name)?.definition).toMatchObject({
        bodyMd5: createHash("md5").update(body).digest("hex"), securityDefiner: false,
        argumentNames: parameters.map((parameter) => parameter.split(/\s/)[0]),
        defaultCount: parameters.filter((parameter) => parameter.includes(" DEFAULT ")).length,
      });
    }
    const tables = [...sql.matchAll(/CREATE TABLE "((?:Image|Canvas)[^"]*)"/g)].map((match) => match[1]).sort();
    expect(inventory().filter((row) => row.kind === "table" && /^(?:Image|Canvas)/.test(row.name)).map((row) => row.name).sort()).toEqual(tables);
    const triggers = [...sql.matchAll(/CREATE (?:CONSTRAINT )?TRIGGER "([^"]+)"[^\r\n]+EXECUTE FUNCTION (?:image|canvas)_\w+\(/g)].map((match) => match[1]).sort();
    expect(inventory().filter((row) => row.kind === "trigger").map((row) => row.name).sort()).toEqual(triggers);
  });

  it("keeps Prisma database-generated defaults aligned with the actual PostgreSQL catalogue", () => {
    const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const columns = new Map(inventory().filter((row) => row.kind === "column").map((row) => [row.name, row.definition.default]));
    const defaults = [...schema.matchAll(/^model ((?:Image|Canvas)\w*) \{([\s\S]*?)^\}/gm)].flatMap(([, model, body]) =>
      [...body.matchAll(/^\s+(\w+)[^\r\n]*@default\(dbgenerated\(("(?:\\.|[^"\\])*")\)\)/gm)].map(([, field, expression]) => ({
        name: `${model}.${field}`, expression: JSON.parse(expression) as unknown,
      })),
    );
    expect(defaults.map(({ name }) => name)).toContain("ImageAsset.publicToken");
    for (const { name, expression } of defaults) {
      // Prisma compares dbgenerated text with PG's deparsed expression. Even
      // equivalent SQL missing grouping parentheses can leave migrate diff red.
      expect(columns.get(name), name).toBe(expression);
    }
  });

  it("does not flatten expression grouping, operators or null guards", () => {
    for (const expression of ["(accounted OR (state = 'DELETED'))", "(accounted AND (state = 'DELETED'))", "true", "NULL"]) {
      const rows = inventory();
      const row = rows.find((item) => item.kind === "constraint" && item.name === "ImageObject_accounted_check")!;
      row.definition.expression = expression;
      expect(checkImageSchemaInventory(rows).ready).toBe(false);
    }
  });

  it("uses a read-only query and keeps raw failures out of readiness", async () => {
    expect(IMAGE_SCHEMA_CATALOG_QUERY).toContain("md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))");
    expect(IMAGE_SCHEMA_CATALOG_QUERY).toContain("g.tgattr::smallint[]");
    expect(IMAGE_SCHEMA_CATALOG_QUERY).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|COPY|CALL|DO)\b/i);
    expect((await probeImageSchema(async () => inventory())).ready).toBe(true);
    const failed = await probeImageSchema(async () => { throw new Error("private SQL and connection credentials"); });
    expect(failed).toMatchObject({ ready: false, code: "IMAGE_STORAGE_UNAVAILABLE", issues: [{ reason: "query_failed" }] });
    expect(JSON.stringify(failed)).not.toMatch(/private|SQL|credentials/);
    for (const malformed of [null, {}, [{ kind: "table" }], [{ kind: "table", name: "images", definition: null }]]) {
      expect(checkImageSchemaInventory(malformed).ready).toBe(false);
    }
  });

  it("checks the standalone media schema through the repository with Canvas disabled", async () => {
    const rows = inventory().filter((row) => row.name !== "ImageQuota_write_guard");
    const query = vi.fn().mockResolvedValueOnce([{ result: inventory() }]).mockResolvedValueOnce([{ result: rows }])
      .mockRejectedValueOnce(new Error("private database diagnostics"));
    const repository = new ImageRepository({ $queryRaw: query } as ImageQueryer);
    await expect(repository.verifySchema()).resolves.toBeUndefined();
    await expect(repository.verifySchema()).rejects.toMatchObject({ code: "IMAGE_STORAGE_UNAVAILABLE", message: "图片存储暂不可用" });
    await expect(repository.verifySchema()).rejects.toMatchObject({ code: "IMAGE_STORAGE_UNAVAILABLE", message: "图片存储暂不可用" });
  });

  it.each([["table", "CanvasGcLease"], ["function", "canvas_claim_imports_v2"], ["enum", "CanvasPutOutcome"]])("requires the dependent Canvas %s %s without a Canvas runtime", async (kind, name) => {
    const rows = inventory();
    expect(rows.some((row) => row.kind === kind && row.name === name)).toBe(true);
    const incomplete = rows.filter((row) => row.kind !== kind || row.name !== name);
    expect(checkImageSchemaInventory(incomplete).issues).toContainEqual({ kind, name, reason: "missing" });
    const repository = new ImageRepository({ $queryRaw: vi.fn().mockResolvedValue([{ result: incomplete }]) } as ImageQueryer);
    await expect(repository.verifySchema()).rejects.toMatchObject({ code: "IMAGE_STORAGE_UNAVAILABLE" });
  });
});

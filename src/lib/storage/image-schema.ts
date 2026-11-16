import "server-only";

import { z } from "zod";

import schemaFixture from "../../../contracts/media/v1/schema.json";

const catalogRowSchema = z.object({
  kind: z.enum(["table", "column", "enum", "index", "constraint", "function", "trigger"]),
  name: z.string().min(1),
  definition: z.record(z.string(), z.json()),
}).strict();
export const imageSchemaInventorySchema = z.array(catalogRowSchema);

const schemaContractSchema = z.object({
  contract: z.literal("narra.image.schema"),
  version: z.literal(1),
  storageRevision: z.literal(3),
  migration: z.literal("20261115180000_image_history"),
  migrationSha256: z.string().length(64).regex(/^[0-9a-f]{64}$/),
  migrations: z.array(z.object({ name: z.string().regex(/^[0-9]{14}_[a-z0-9_]+$/), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict()).min(4),
  bodyFingerprint: z.string().min(1),
  bodyLineEndings: z.literal("CRLF_TO_LF_ONLY"),
  expressionComparison: z.literal("POSTGRESQL_17_EXACT"),
  catalogQuery: z.string().startsWith("WITH "),
  objects: imageSchemaInventorySchema.min(1),
}).strict();

export const IMAGE_SCHEMA_CONTRACT = schemaFixture;
export const IMAGE_SCHEMA_CATALOG_QUERY = schemaFixture.catalogQuery;
export type ImageSchemaCatalogRow = z.infer<typeof catalogRowSchema>;
export type ImageSchemaQuery = (sql: string) => Promise<unknown>;
export type ImageSchemaIssue = {
  kind: string;
  name: string;
  reason: "missing" | "mismatch" | "duplicate" | "invalid_contract" | "invalid_catalog" | "query_failed";
};
export type ImageSchemaReport = {
  version: 1;
  storageRevision: 3;
  ready: boolean;
  code: "IMAGE_STORAGE_UNAVAILABLE" | null;
  issues: ImageSchemaIssue[];
};

function report(issues: ImageSchemaIssue[]): ImageSchemaReport {
  return { version: 1, storageRevision: 3, ready: issues.length === 0, code: issues.length === 0 ? null : "IMAGE_STORAGE_UNAVAILABLE", issues };
}

function failure(reason: ImageSchemaIssue["reason"]): ImageSchemaReport {
  return report([{ kind: "catalog", name: "images", reason }]);
}

// JSON object key order is immaterial. SQL expressions are not rewritten: the
// PG17 catalogue is the supported representation, including casts and grouping.
// An unfamiliar equivalent expression must fail closed until it is reviewed.
function stable(value: ImageSchemaCatalogRow["definition"][string]): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function loadContract() {
  const parsed = schemaContractSchema.safeParse(schemaFixture);
  if (!parsed.success) return null;
  const contract = parsed.data;
  const lastMigration = contract.migrations.at(-1);
  if (lastMigration?.name !== contract.migration || lastMigration.sha256 !== contract.migrationSha256
    || new Set(contract.migrations.map(({ name }) => name)).size !== contract.migrations.length) return null;
  const keys = contract.objects.map((row) => `${row.kind}:${row.name}`);
  if (new Set(keys).size !== keys.length) return null;
  // This query reads pg_catalog only; readiness cannot invoke mutation helpers.
  if (/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|COPY|CALL|DO)\b/i.test(contract.catalogQuery)) return null;
  if (!contract.objects.some((row) => row.kind === "function" && row.name === "image_storage_revision"
    && typeof row.definition.bodyMd5 === "string" && row.definition.bodyMd5.length === 32 && /^[0-9a-f]{32}$/.test(row.definition.bodyMd5))) return null;
  return contract;
}

export function checkImageSchemaInventory(rows: unknown): ImageSchemaReport {
  const contract = loadContract();
  if (!contract) return failure("invalid_contract");
  const parsed = imageSchemaInventorySchema.safeParse(rows);
  if (!parsed.success) return failure("invalid_catalog");
  const inventory = new Map<string, ImageSchemaCatalogRow[]>();
  for (const row of parsed.data) {
    const key = `${row.kind}:${row.name}`;
    inventory.set(key, [...(inventory.get(key) ?? []), row]);
  }
  const issues: ImageSchemaIssue[] = [];
  for (const expected of contract.objects) {
    const found = inventory.get(`${expected.kind}:${expected.name}`);
    const reason = !found ? "missing" : found.length !== 1 ? "duplicate"
      : stable(found[0].definition) !== stable(expected.definition) ? "mismatch" : null;
    if (reason) issues.push({ kind: expected.kind, name: expected.name, reason });
  }
  return report(issues);
}

export async function probeImageSchema(query: ImageSchemaQuery): Promise<ImageSchemaReport> {
  const contract = loadContract();
  if (!contract) return failure("invalid_contract");
  try {
    return checkImageSchemaInventory(await query(contract.catalogQuery));
  } catch {
    // No SQL, connection strings, actual definitions or driver messages escape.
    return failure("query_failed");
  }
}

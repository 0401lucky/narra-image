export const WORKER_ADDITIVE_MIGRATIONS = [
  "20260807130000_generation_worker_contract_v1",
  "20260807140000_generation_media_storage_meta",
] as const;

export function workerMigrationPlan(migrationNames: readonly string[], baselineMarkers: readonly string[]) {
  const names = [...migrationNames].sort();
  const firstWorker = names.indexOf(WORKER_ADDITIVE_MIGRATIONS[0]);
  if (new Set(names).size !== names.length || firstWorker < 1 || names[firstWorker + 1] !== WORKER_ADDITIVE_MIGRATIONS[1]) throw new Error("Worker additive migrations must follow the immutable legacy prefix");
  const baselineNames = names.slice(0, firstWorker);
  if (JSON.stringify([...baselineMarkers].sort()) !== JSON.stringify(baselineNames)) throw new Error("Legacy snapshot markers must match the immutable pre-worker migration prefix");
  return { baselineNames, pendingNames: names.slice(firstWorker) };
}
import { createHash } from "node:crypto";


export function workerBaselineChecksums(snapshot: string, names: readonly string[], readSql: (name: string) => Buffer) {
  const entries = [...snapshot.matchAll(/'([a-f0-9]{64})',\s*CURRENT_TIMESTAMP,\s*'([^']+)'/g)].map((match) => ({ name: match[2], checksum: match[1] })).sort((a, b) => a.name < b.name ? -1 : 1);
  if (JSON.stringify(entries.map((entry) => entry.name)) !== JSON.stringify([...names].sort())) throw new Error("Immutable snapshot checksum inventory does not match its baseline markers");
  for (const entry of entries) {
    const raw = readSql(entry.name).toString("utf8");
    const lf = raw.replaceAll("\r\n", "\n");
    // Match Prisma's LF/CRLF compatibility without rewriting published SQL or receipts.
    const accepted = [raw, lf, lf.replaceAll("\n", "\r\n")].map((sql) => createHash("sha256").update(sql).digest("hex"));
    if (!accepted.includes(entry.checksum)) throw new Error(`Immutable migration checksum mismatch: ${entry.name}`);
  }
  return entries;
}

import type { ImageStorageOverview } from "@/lib/storage/image-maintenance-types";

export type StoragePolicyDraft = {
  expectedVersion: number;
  enabled: boolean;
  quotaCleanupEnabled: boolean;
  scheduleEnabled: boolean;
  limitGb: string;
  retentionDays: string;
  intervalHours: string;
};

function unsigned(value: string): bigint | null {
  return /^(0|[1-9][0-9]*)(?![\s\S])/.test(value) && value.length <= 19 ? BigInt(value) : null;
}

export function formatStorageBytes(value: string): string {
  const bytes = unsigned(value);
  if (bytes === null) return "—";
  for (const [unit, divisor] of [["GB", 1000000000], ["MB", 1000000], ["KB", 1000]] as const) {
    if (bytes >= BigInt(divisor)) {
      const hundredths = bytes * BigInt(100) / BigInt(divisor);
      return `${hundredths / BigInt(100)}.${String(hundredths % BigInt(100)).padStart(2, "0")} ${unit}`;
    }
  }
  return `${bytes} B`;
}

export function storageBytesToGb(value: string): string {
  const bytes = unsigned(value);
  if (bytes === null) return "";
  const remainder = String(bytes % BigInt(1000000000)).padStart(9, "0").replace(/0+$/, "");
  return `${bytes / BigInt(1000000000)}${remainder ? `.${remainder}` : ""}`;
}

export function storageGbToBytes(value: string): string {
  const match = /^(0|[1-9][0-9]{0,7})(?:\.([0-9]{1,9}))?(?![\s\S])/.exec(value.trim());
  if (!match) throw new Error("容量上限请输入有效的 GB 数值，最多 9 位小数");
  return String(BigInt(match[1]) * BigInt(1000000000) + BigInt((match[2] ?? "").padEnd(9, "0")));
}

export function storagePolicyDraft(policy: ImageStorageOverview["policy"]): StoragePolicyDraft {
  return {
    expectedVersion: policy.version, enabled: policy.enabled, quotaCleanupEnabled: policy.quotaCleanupEnabled,
    scheduleEnabled: policy.scheduleEnabled, limitGb: storageBytesToGb(policy.limitBytes),
    retentionDays: String(policy.retentionDays), intervalHours: String(policy.intervalSeconds / 3600),
  };
}

export function storageTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

import { describe, expect, it } from "vitest";

import { parseEnv } from "@/lib/env";
import { getRuntimeEnvironmentVariable } from "@/lib/runtime-environment-contract";

const base = { NODE_ENV: "test", AUTH_SECRET: "unit-test-secret", DATABASE_URL: "postgresql://localhost/test" } as const;

describe("canvas runtime environment", () => {
  it("defaults off and matches the authoritative environment manifest", () => {
    const parsed = parseEnv(base);
    for (const name of ["CANVAS_ENABLED", "CANVAS_ASSET_GC_INTERVAL_SECONDS", "CANVAS_ASSET_GC_BATCH_SIZE"] as const) {
      expect(parsed[name]).toBe(getRuntimeEnvironmentVariable(name)?.default);
      expect(getRuntimeEnvironmentVariable(name)?.allowedReadPaths).toEqual(["src/lib/env.ts", "worker/internal/worker/config.go"]);
    }
    expect(parsed.CANVAS_ENABLED).toBe(false);
  });

  it("parses explicit enabling and bounded operational controls, never a grace override", () => {
    expect(parseEnv({ ...base, CANVAS_ENABLED: "YES", CANVAS_ASSET_GC_INTERVAL_SECONDS: "120", CANVAS_ASSET_GC_BATCH_SIZE: "100" })).toMatchObject({ CANVAS_ENABLED: true, CANVAS_ASSET_GC_INTERVAL_SECONDS: 120, CANVAS_ASSET_GC_BATCH_SIZE: 100 });
    expect(getRuntimeEnvironmentVariable("CANVAS_ASSET_GRACE_SECONDS")).toBeUndefined();
  });

  it.each([
    { CANVAS_ENABLED: "enabled" },
    { CANVAS_ENABLED: " " },
    { CANVAS_ASSET_GC_INTERVAL_SECONDS: "59" },
    { CANVAS_ASSET_GC_INTERVAL_SECONDS: "0" },
    { CANVAS_ASSET_GC_INTERVAL_SECONDS: "2147483648" },
    { CANVAS_ASSET_GC_INTERVAL_SECONDS: "NaN" },
    { CANVAS_ASSET_GC_BATCH_SIZE: "0" },
    { CANVAS_ASSET_GC_BATCH_SIZE: "101" },
    { CANVAS_ASSET_GC_BATCH_SIZE: "1.5" },
  ])("rejects unsafe controls, including disabled installations %#", (override) => {
    expect(() => parseEnv({ ...base, CANVAS_ENABLED: "false", ...override })).toThrow();
  });
});

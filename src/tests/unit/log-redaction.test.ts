import { describe, expect, it } from "vitest";

import redactionFixture from "../../../contracts/runtime/v1/redaction.json";
import {
  LOG_REDACTION_MARKERS,
  redactLogValue,
  stringifyLogRecord,
} from "@/lib/logging/redact";

describe("统一日志脱敏", () => {
  for (const fixture of redactionFixture.cases) {
    it(`满足共享负向样本：${fixture.name}`, () => {
      const output = stringifyLogRecord(fixture.input);

      for (const forbidden of fixture.forbiddenFragments) {
        expect(output).not.toContain(forbidden);
      }
      for (const required of fixture.requiredFragments) {
        expect(output).toContain(required);
      }
    });
  }

  it("递归清洗 Error cause 且不输出 stack", () => {
    const error = new Error(
      "database postgresql://user:p%40ss@db.internal/narra?token=secret unavailable",
      {
        cause: new Error("Bearer nested-secret"),
      },
    );

    const output = stringifyLogRecord({ cause: error });

    expect(output).toContain(LOG_REDACTION_MARKERS.databaseUrl);
    expect(output).toContain(LOG_REDACTION_MARKERS.secret);
    expect(output).not.toContain("p%40ss");
    expect(output).not.toContain("nested-secret");
    expect(output).not.toContain("stack");
  });

  it("循环对象不会导致日志序列化失败", () => {
    const input: Record<string, unknown> = { event: "cycle" };
    input.self = input;

    expect(redactLogValue(input)).toEqual({
      event: "cycle",
      self: "[Circular]",
    });
  });
});

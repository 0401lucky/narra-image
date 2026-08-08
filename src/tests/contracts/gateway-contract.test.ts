// @vitest-environment node

import gatewayEnvelopeContract from "../../../contracts/gateway/v1/envelope.json";
import envelopeScenarios from "../../../contracts/gateway/v1/scenarios/envelope.json";
import {
  GATEWAY_ENDPOINTS,
  GATEWAY_SCHEMA_VERSION,
  GATEWAY_SIGNATURE_HEADER,
} from "@/lib/generation/gateway-contract";

describe("gateway contract v1", () => {
  it("契约元信息稳定", () => {
    expect(gatewayEnvelopeContract.contract).toBe("narra.gateway");
    expect(gatewayEnvelopeContract.version).toBe(GATEWAY_SCHEMA_VERSION);
  });

  it("签名规范为 AUTH_SECRET + HMAC-SHA256 覆盖原始 body", () => {
    expect(gatewayEnvelopeContract.signature.algorithm).toBe("HMAC-SHA256");
    expect(gatewayEnvelopeContract.signature.key).toBe("AUTH_SECRET");
    expect(gatewayEnvelopeContract.signature.header).toBe(GATEWAY_SIGNATURE_HEADER);
    expect(gatewayEnvelopeContract.signature.encoding).toBe("hex");
    expect(gatewayEnvelopeContract.signature.payload).toBe("raw-request-body");
  });

  it("endpoint 枚举与 gateway-client 路由表一致", () => {
    expect(new Set(gatewayEnvelopeContract.endpoints).size)
      .toBe(gatewayEnvelopeContract.endpoints.length);
    for (const endpoint of gatewayEnvelopeContract.endpoints) {
      // generations.get 走独立的 GET 查询端点，不在 POST envelope 路由表内。
      if (endpoint === "generations.get") continue;
      expect(GATEWAY_ENDPOINTS).toContain(endpoint);
    }
    expect(GATEWAY_ENDPOINTS).not.toContain("generations.get");
  });

  it("envelope 必填字段覆盖 auth/billing/provider/payload", () => {
    const required = gatewayEnvelopeContract.required.envelope;
    expect(required).toEqual(
      expect.arrayContaining([
        "schemaVersion",
        "endpoint",
        "jobId",
        "issuedAt",
        "auth",
        "billing",
        "provider",
        "payload",
      ]),
    );
    expect(gatewayEnvelopeContract.required.auth).toEqual(
      expect.arrayContaining(["apiKeyId", "userId"]),
    );
    expect(gatewayEnvelopeContract.required.billing).toEqual(
      expect.arrayContaining(["creditsSpent", "charged"]),
    );
    expect(gatewayEnvelopeContract.required.provider).toEqual(
      expect.arrayContaining(["channelId", "channelModels", "defaultModel", "providerMode"]),
    );
    expect(gatewayEnvelopeContract.required.payload).toEqual(
      expect.arrayContaining([
        "count",
        "generationType",
        "model",
        "prompt",
        "moderation",
        "outputFormat",
        "quality",
        "size",
      ]),
    );
  });

  it("合法场景样例覆盖全部生成端点且不含敏感字段", () => {
    const valid = envelopeScenarios.valid as Record<string, Record<string, unknown>>;
    expect(Object.keys(valid).sort()).toEqual(
      ["chat.completions", "images.edits", "images.generations"],
    );
    for (const [endpoint, sample] of Object.entries(valid)) {
      expect(GATEWAY_ENDPOINTS).toContain(endpoint);
      expect(sample.schemaVersion).toBe(1);
      expect(sample.endpoint).toBe(endpoint);
      expect(sample).not.toHaveProperty("provider.apiKey");
      expect(sample).not.toHaveProperty("provider.baseUrl");
    }
  });

  it("非法场景样例覆盖签名/版本/媒体/计费边界", () => {
    const invalid = envelopeScenarios.invalid as Record<string, { reason: string }>;
    expect(Object.keys(invalid)).toContain("missingSignature");
    expect(Object.keys(invalid)).toContain("wrongVersion");
    expect(Object.keys(invalid)).toContain("badSourceUrl");
    expect(Object.keys(invalid)).toContain("negativeCredits");
  });
});

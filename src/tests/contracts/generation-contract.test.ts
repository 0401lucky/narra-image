// @vitest-environment node

import channelScenarios from "../../../contracts/generation/v1/scenarios/channels.json";
import lifecycleScenarios from "../../../contracts/generation/v1/scenarios/lifecycle.json";
import mediaScenario from "../../../contracts/generation/v1/scenarios/media.json";
import secretScenario from "../../../contracts/generation/v1/scenarios/secret.json";
import { decryptProviderSecret } from "@/lib/providers/provider-secret";
import {
  GENERATION_CONTRACT_SCHEMA,
  GENERATION_ERRORS,
  GENERATION_MODEL_CONTRACT,
  channelSupportsModel,
  generationContractWriteFields,
  isGenerationContractsV1Enabled,
  isGenerationRefundAllowed,
  resolveGenerationModelOperation,
} from "@/lib/generation/contracts";

describe("generation contract v1", () => {
  it("保留 legacy 默认值，且只有显式开关才写入 v1", () => {
    expect(GENERATION_CONTRACT_SCHEMA.legacyVersion).toBe(0);
    expect(GENERATION_CONTRACT_SCHEMA.rollout.defaultEnabled).toBe(false);
    expect(isGenerationContractsV1Enabled(undefined)).toBe(false);
    expect(generationContractWriteFields(false)).toEqual({
      contractVersion: 0,
      handoffState: null,
    });
    expect(generationContractWriteFields(true)).toEqual({
      contractVersion: 1,
      handoffState: "NOT_STARTED",
    });
  });

  it("Node 模型分流符合共享向量", () => {
    for (const vector of GENERATION_MODEL_CONTRACT.vectors) {
      expect(resolveGenerationModelOperation(vector.model)).toBe(vector.operation);
    }
  });

  it("显式渠道只接受其默认模型或模型清单", () => {
    for (const scenario of channelScenarios.scenarios) {
      if (!scenario.channel || !scenario.channel.active) {
        continue;
      }
      const supported = channelSupportsModel({
        defaultModel: scenario.channel.defaultModel,
        model: scenario.requestedModel,
        models: scenario.channel.models,
      });
      expect(supported).toBe(scenario.result.errorCode === null);
    }
  });

  it("未决 handoff 禁止普通退款", () => {
    for (const state of ["SUBMITTING", "SUBMITTED", "UNKNOWN"] as const) {
      expect(isGenerationRefundAllowed({
        contractVersion: 1,
        handoffState: state,
      })).toBe(false);
    }
    expect(isGenerationRefundAllowed({
      contractVersion: 0,
      handoffState: null,
    })).toBe(true);
    expect(isGenerationRefundAllowed({
      contractVersion: 1,
      handoffState: null,
    })).toBe(false);
    expect(lifecycleScenarios.scenarios.find((item) => item.id === "WC-B07")?.result)
      .toMatchObject({ errorCode: "HANDOFF_UNKNOWN", refund: false, retry: false });
  });

  it("错误码、图片和视频字段由共享 fixture 定义", () => {
    expect(GENERATION_ERRORS.HANDOFF_UNKNOWN).toMatchObject({
      refundable: false,
      retryable: false,
    });
    expect(GENERATION_ERRORS.GENERATION_WAIT_TIMEOUT.jobTerminal).toBe(false);
    expect(mediaScenario.image.editCount).toBe(1);
    expect(mediaScenario.video.nullableResultFields).toContain("posterUrl");
  });

  it("媒体契约定义存储形态字段与三种 URL 样例", () => {
    for (const field of ["mediaStorage", "storageKey"]) {
      expect(mediaScenario.image.resultFields).toContain(field);
      expect(mediaScenario.video.resultFields).toContain(field);
    }
    expect(mediaScenario.image.storageKinds).toEqual(
      expect.arrayContaining(["B64", "S3", "UPSTREAM"]),
    );
    expect(mediaScenario.video.storageKinds).toEqual(
      expect.arrayContaining(["B64", "S3", "UPSTREAM"]),
    );
    expect(mediaScenario.image.sampleUrls.s3).toMatch(/^https:\/\//);
    expect(mediaScenario.image.sampleUrls.b64).toMatch(/^data:image\/png;base64,/);
    expect(mediaScenario.image.sampleUrls.upstream).toMatch(/^https:\/\//);
    expect(mediaScenario.video.sampleUrls.s3).toMatch(/\.mp4$/);
  });

  it("Go/Node 使用同一固定 AES-GCM 密钥 fixture", async () => {
    await expect(
      decryptProviderSecret(secretScenario.encoded, secretScenario.secret),
    ).resolves.toBe(secretScenario.plaintext);
  });
});

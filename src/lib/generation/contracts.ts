import { z } from "zod";

import errorsFixture from "../../../contracts/generation/v1/errors.json";
import modelsFixture from "../../../contracts/generation/v1/models.json";
import schemaFixture from "../../../contracts/generation/v1/schema.json";
import statesFixture from "../../../contracts/generation/v1/states.json";

const errorDefinitionSchema = z.object({
  category: z.string().min(1),
  jobTerminal: z.boolean().optional(),
  refundable: z.boolean(),
  requiresNotSubmitted: z.boolean().optional(),
  retryable: z.boolean(),
  userMessage: z.string().min(1),
});

const errorsSchema = z.object({
  errors: z.record(z.string().min(1), errorDefinitionSchema),
  version: z.literal(1),
});

const modelsSchema = z.object({
  responsesPattern: z.string().min(1),
  vectors: z.array(z.object({
    model: z.string().min(1),
    operation: z.enum(["images", "responses"]),
  })).min(1),
  version: z.literal(1),
});

const jobStatusSchema = z.enum(["PENDING", "PROCESSING", "SUCCEEDED", "FAILED"]);
const handoffStateSchema = z.enum([
  "NOT_STARTED",
  "SUBMITTING",
  "SUBMITTED",
  "UNKNOWN",
  "RESOLVED",
]);
const attemptStatusSchema = z.enum([
  "CLAIMED",
  "SUBMITTING",
  "SUBMITTED",
  "SUCCEEDED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
  "UNKNOWN",
]);

const schemaManifestSchema = z.object({
  contract: z.literal("narra.generation"),
  legacyVersion: z.literal(0),
  rollout: z.object({
    defaultEnabled: z.literal(false),
    disabledWrite: z.object({
      contractVersion: z.literal(0),
      handoffState: z.null(),
    }),
    enabledWrite: z.object({
      contractVersion: z.literal(1),
      handoffState: z.literal("NOT_STARTED"),
    }),
    environmentFlag: z.literal("WORKER_CONTRACTS_V1_ENABLED"),
  }),
  version: z.literal(1),
});

const statesSchema = z.object({
  attemptStatuses: z.array(attemptStatusSchema).min(1),
  handoffStates: z.array(handoffStateSchema).min(1),
  handoffTransitions: z.record(handoffStateSchema, z.array(handoffStateSchema)),
  jobStatuses: z.array(jobStatusSchema).min(1),
  jobTransitions: z.record(jobStatusSchema, z.array(jobStatusSchema)),
  refundAllowedHandoffStates: z.array(handoffStateSchema.nullable()),
  refundBlockedHandoffStates: z.array(handoffStateSchema),
  unknownTerminal: z.object({
    errorCode: z.literal("HANDOFF_UNKNOWN"),
    handoffState: z.literal("UNKNOWN"),
    refund: z.literal(false),
    retry: z.literal(false),
    status: z.literal("FAILED"),
  }),
  version: z.literal(1),
});

function parseFixture<T>(
  path: string,
  schema: z.ZodType<T>,
  value: unknown,
) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `生成契约 fixture 无效（${path}）：${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

export const GENERATION_CONTRACT_SCHEMA = parseFixture(
  "contracts/generation/v1/schema.json",
  schemaManifestSchema,
  schemaFixture,
);

export const GENERATION_ERRORS = parseFixture(
  "contracts/generation/v1/errors.json",
  errorsSchema,
  errorsFixture,
).errors;

export const GENERATION_MODEL_CONTRACT = parseFixture(
  "contracts/generation/v1/models.json",
  modelsSchema,
  modelsFixture,
);

export const GENERATION_STATE_CONTRACT = parseFixture(
  "contracts/generation/v1/states.json",
  statesSchema,
  statesFixture,
);

export type GenerationErrorCode = keyof typeof errorsFixture.errors;
export type GenerationHandoffState =
  | "NOT_STARTED"
  | "SUBMITTING"
  | "SUBMITTED"
  | "UNKNOWN"
  | "RESOLVED";
export type GenerationModelOperation = "images" | "responses";

export const GENERATION_CONTRACT_VERSION = GENERATION_CONTRACT_SCHEMA.version;
export const LEGACY_GENERATION_CONTRACT_VERSION =
  GENERATION_CONTRACT_SCHEMA.legacyVersion;

const responsesModelPattern = new RegExp(
  GENERATION_MODEL_CONTRACT.responsesPattern,
  "i",
);
const blockedRefundStates = new Set(
  GENERATION_STATE_CONTRACT.refundBlockedHandoffStates,
);

export class GenerationContractError extends Error {
  readonly code: GenerationErrorCode;
  readonly status: number;

  constructor(
    code: GenerationErrorCode,
    options: { cause?: unknown; message?: string; status?: number } = {},
  ) {
    const definition = GENERATION_ERRORS[code];
    super(options.message ?? definition.userMessage, { cause: options.cause });
    this.name = "GenerationContractError";
    this.code = code;
    this.status = options.status ?? 400;
  }
}

export function getGenerationErrorDefinition(code: GenerationErrorCode) {
  return GENERATION_ERRORS[code];
}

export function isGenerationErrorCode(value: string): value is GenerationErrorCode {
  return Object.hasOwn(GENERATION_ERRORS, value);
}

export function isGenerationContractsV1Enabled(
  value: string | boolean | undefined,
) {
  if (typeof value === "boolean") return value;
  return value === "true" || value === "1" || value === "yes";
}

export function generationContractWriteFields(enabled: boolean) {
  return enabled
    ? GENERATION_CONTRACT_SCHEMA.rollout.enabledWrite
    : GENERATION_CONTRACT_SCHEMA.rollout.disabledWrite;
}

export function normalizeProviderModels(
  defaultModel: string,
  models: readonly string[],
) {
  const normalized = [defaultModel, ...models]
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set(normalized)];
}

export function channelSupportsModel(input: {
  defaultModel: string;
  model: string;
  models: readonly string[];
}) {
  const requestedModel = input.model.trim();
  return normalizeProviderModels(input.defaultModel, input.models)
    .includes(requestedModel);
}

export function resolveGenerationModelOperation(
  modelId: string,
): GenerationModelOperation {
  return responsesModelPattern.test(modelId.toLowerCase())
    ? "responses"
    : "images";
}

export function supportsResponsesImageGeneration(modelId: string) {
  return resolveGenerationModelOperation(modelId) === "responses";
}

export function isGenerationRefundAllowed(input: {
  contractVersion: number;
  handoffState: GenerationHandoffState | null | undefined;
}) {
  if (input.contractVersion < GENERATION_CONTRACT_VERSION) {
    return true;
  }
  if (!input.handoffState) {
    return false;
  }
  return !blockedRefundStates.has(input.handoffState);
}

import type { GenerationType, ProviderMode } from "@/lib/types";

type CreditInput = {
  providerMode: ProviderMode;
  builtInCreditCost: number;
  count?: number;
};

type CreditGuardInput = CreditInput & {
  credits: number;
};

function normalizeCreditCount(count?: number) {
  if (typeof count !== "number" || !Number.isFinite(count) || count < 1) {
    return 1;
  }
  return Math.trunc(count);
}

export function shouldChargeCredits(providerMode: ProviderMode) {
  return providerMode === "built_in";
}

export function calculateGenerationCost({
  providerMode,
  builtInCreditCost,
  count = 1,
}: CreditInput) {
  return shouldChargeCredits(providerMode) ? builtInCreditCost * normalizeCreditCount(count) : 0;
}

export function hasEnoughCredits({
  providerMode,
  credits,
  builtInCreditCost,
  count = 1,
}: CreditGuardInput) {
  return credits >= calculateGenerationCost({ providerMode, builtInCreditCost, count });
}

type ResolveCreditCostInput = {
  generationType: GenerationType;
  imageCreditCost: number;
  videoCreditCost: number;
};

export function isVideoGenerationType(generationType: GenerationType) {
  return generationType === "text_to_video" || generationType === "image_to_video";
}

export function resolveCreditCost({
  generationType,
  imageCreditCost,
  videoCreditCost,
}: ResolveCreditCostInput) {
  return isVideoGenerationType(generationType) ? videoCreditCost : imageCreditCost;
}

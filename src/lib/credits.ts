import type { GenerationType, ProviderMode } from "@/lib/types";

type CreditInput = {
  providerMode: ProviderMode;
  builtInCreditCost: number;
};

type CreditGuardInput = CreditInput & {
  credits: number;
};

export function shouldChargeCredits(providerMode: ProviderMode) {
  return providerMode === "built_in";
}

export function calculateGenerationCost({
  providerMode,
  builtInCreditCost,
}: CreditInput) {
  return shouldChargeCredits(providerMode) ? builtInCreditCost : 0;
}

export function hasEnoughCredits({
  providerMode,
  credits,
  builtInCreditCost,
}: CreditGuardInput) {
  return credits >= calculateGenerationCost({ providerMode, builtInCreditCost });
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

import {
  calculateImageSize,
  imageSizeLimits,
  normalizeGenerationSize,
  parseImageSize,
  type GenerationSizeToken,
  type SizeTier,
} from "@/lib/generation/sizes";

export type ResolutionOptionValue = SizeTier | "auto";
export type AspectRatioPreset =
  | "1:1"
  | "2:3"
  | "3:2"
  | "4:3"
  | "3:4"
  | "16:9"
  | "9:16"
  | "21:9"
  | "9:21"
  | "auto";

export const RESOLUTION_OPTIONS: Array<{ label: string; value: ResolutionOptionValue }> = [
  { label: "1K", value: "1K" },
  { label: "2K", value: "2K" },
  { label: "4K", value: "4K" },
  { label: "自动", value: "auto" },
];

export const ASPECT_RATIO_OPTIONS: Array<{
  label: string;
  value: AspectRatioPreset;
  boxWidth: number;
  boxHeight: number;
}> = [
  { label: "1:1", value: "1:1", boxWidth: 16, boxHeight: 16 },
  { label: "2:3", value: "2:3", boxWidth: 12, boxHeight: 18 },
  { label: "3:2", value: "3:2", boxWidth: 18, boxHeight: 12 },
  { label: "4:3", value: "4:3", boxWidth: 17, boxHeight: 13 },
  { label: "3:4", value: "3:4", boxWidth: 13, boxHeight: 17 },
  { label: "16:9", value: "16:9", boxWidth: 20, boxHeight: 11 },
  { label: "9:16", value: "9:16", boxWidth: 11, boxHeight: 20 },
  { label: "21:9", value: "21:9", boxWidth: 22, boxHeight: 9 },
  { label: "9:21", value: "9:21", boxWidth: 9, boxHeight: 22 },
  { label: "自动", value: "auto", boxWidth: 0, boxHeight: 0 },
];

const NON_AUTO_RATIOS: Array<Exclude<AspectRatioPreset, "auto">> = [
  "1:1",
  "2:3",
  "3:2",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "21:9",
  "9:21",
];

const TIER_ORDER: SizeTier[] = ["1K", "2K", "4K"];

export type SizeControlState = {
  size: GenerationSizeToken;
  resolutionTier: ResolutionOptionValue;
  aspectRatio: AspectRatioPreset | null;
  widthInput: string;
  heightInput: string;
  alignMultiple16: boolean;
};

export const DEFAULT_SIZE_CONTROL_STATE: SizeControlState = {
  size: "auto",
  resolutionTier: "auto",
  aspectRatio: "auto",
  widthInput: "",
  heightInput: "",
  alignMultiple16: true,
};

function findMatchingPreset(sizeToken: GenerationSizeToken): {
  resolutionTier: ResolutionOptionValue;
  aspectRatio: AspectRatioPreset | null;
} {
  if (sizeToken === "auto") {
    return { resolutionTier: "auto", aspectRatio: "auto" };
  }
  for (const tier of TIER_ORDER) {
    for (const ratio of NON_AUTO_RATIOS) {
      if (calculateImageSize(tier, ratio) === sizeToken) {
        return { resolutionTier: tier, aspectRatio: ratio };
      }
    }
  }
  return { resolutionTier: "auto", aspectRatio: null };
}

export function deriveSizeControlState(
  rawSize: string,
  alignMultiple16 = true,
): SizeControlState {
  const normalized = normalizeGenerationSize(rawSize) ?? "auto";
  if (normalized === "auto") {
    return {
      ...DEFAULT_SIZE_CONTROL_STATE,
      alignMultiple16,
    };
  }
  const parsed = parseImageSize(normalized);
  const matched = findMatchingPreset(normalized);
  return {
    size: normalized,
    resolutionTier: matched.resolutionTier,
    aspectRatio: matched.aspectRatio,
    widthInput: parsed ? String(parsed.width) : "",
    heightInput: parsed ? String(parsed.height) : "",
    alignMultiple16,
  };
}

export function selectResolutionTier(
  state: SizeControlState,
  tier: ResolutionOptionValue,
): SizeControlState {
  if (tier === "auto") {
    return {
      ...state,
      size: "auto",
      resolutionTier: "auto",
      aspectRatio: "auto",
      widthInput: "",
      heightInput: "",
    };
  }
  const ratio: Exclude<AspectRatioPreset, "auto"> =
    state.aspectRatio && state.aspectRatio !== "auto" ? state.aspectRatio : "1:1";
  const computed = calculateImageSize(tier, ratio) ?? "1024x1024";
  const parsed = parseImageSize(computed);
  return {
    ...state,
    size: computed,
    resolutionTier: tier,
    aspectRatio: ratio,
    widthInput: parsed ? String(parsed.width) : "1024",
    heightInput: parsed ? String(parsed.height) : "1024",
  };
}

export function selectAspectRatio(
  state: SizeControlState,
  ratio: AspectRatioPreset,
): SizeControlState {
  if (ratio === "auto") {
    return {
      ...state,
      size: "auto",
      resolutionTier: "auto",
      aspectRatio: "auto",
      widthInput: "",
      heightInput: "",
    };
  }
  const tier: SizeTier = state.resolutionTier === "auto" ? "1K" : state.resolutionTier;
  const computed = calculateImageSize(tier, ratio) ?? "1024x1024";
  const parsed = parseImageSize(computed);
  return {
    ...state,
    size: computed,
    resolutionTier: tier,
    aspectRatio: ratio,
    widthInput: parsed ? String(parsed.width) : "1024",
    heightInput: parsed ? String(parsed.height) : "1024",
  };
}

export function updateDimensionInputs(
  state: SizeControlState,
  widthInput: string,
  heightInput: string,
): SizeControlState {
  const trimmedW = widthInput.trim();
  const trimmedH = heightInput.trim();
  if (!trimmedW && !trimmedH) {
    return {
      ...state,
      size: "auto",
      resolutionTier: "auto",
      aspectRatio: "auto",
      widthInput: "",
      heightInput: "",
    };
  }
  const normalized = normalizeGenerationSize(`${trimmedW}x${trimmedH}`);
  if (normalized && normalized !== "auto") {
    const matched = findMatchingPreset(normalized);
    return {
      ...state,
      size: normalized,
      resolutionTier: matched.resolutionTier,
      aspectRatio: matched.aspectRatio,
      widthInput,
      heightInput,
    };
  }
  return {
    ...state,
    resolutionTier: "auto",
    aspectRatio: null,
    widthInput,
    heightInput,
  };
}

export function applyDimensionAlignment(state: SizeControlState): SizeControlState {
  if (!state.alignMultiple16) return state;
  if (!state.widthInput.trim() && !state.heightInput.trim()) return state;
  const normalized = normalizeGenerationSize(`${state.widthInput}x${state.heightInput}`);
  if (!normalized || normalized === "auto") return state;
  const parsed = parseImageSize(normalized);
  if (!parsed) return state;
  const matched = findMatchingPreset(normalized);
  return {
    ...state,
    size: normalized,
    resolutionTier: matched.resolutionTier,
    aspectRatio: matched.aspectRatio,
    widthInput: String(parsed.width),
    heightInput: String(parsed.height),
  };
}

export function swapDimensions(state: SizeControlState): SizeControlState {
  if (!state.widthInput.trim() && !state.heightInput.trim()) {
    return state;
  }
  return updateDimensionInputs(state, state.heightInput, state.widthInput);
}

export function toggleAlignMultiple16(
  state: SizeControlState,
  enabled: boolean,
): SizeControlState {
  const next = { ...state, alignMultiple16: enabled };
  return enabled ? applyDimensionAlignment(next) : next;
}

export function getSizeControlWarning(state: SizeControlState): string | null {
  if (!state.widthInput.trim() && !state.heightInput.trim()) {
    return null;
  }
  const w = Number(state.widthInput);
  const h = Number(state.heightInput);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return "请输入正整数宽高";
  }
  if (Math.max(w, h) > imageSizeLimits.maxEdge) {
    return `单边最大 ${imageSizeLimits.maxEdge}px，提交时将自动缩放到上限`;
  }
  if (w * h > imageSizeLimits.maxPixels) {
    return "总像素超出上限，提交时将自动缩小";
  }
  const ratio = w / h;
  if (ratio > imageSizeLimits.maxAspectRatio || ratio < 1 / imageSizeLimits.maxAspectRatio) {
    return `长宽比超过 ${imageSizeLimits.maxAspectRatio}:1，提交时将自动收敛`;
  }
  if (w % imageSizeLimits.multiple !== 0 || h % imageSizeLimits.multiple !== 0) {
    return `服务端会自动规整为 ${imageSizeLimits.multiple}px 倍数（${state.size}）`;
  }
  return null;
}

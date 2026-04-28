const SIZE_PATTERN = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/;
const RATIO_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*[:xX×]\s*(\d+(?:\.\d+)?)\s*$/;

const SIZE_MULTIPLE = 16;
const MAX_EDGE = 3840;
const MAX_ASPECT_RATIO = 3;
const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;

export type GenerationSizeToken = "auto" | `${number}x${number}`;
export type SizeTier = "1K" | "2K" | "4K";

export const imageSizeLimits = {
  maxAspectRatio: MAX_ASPECT_RATIO,
  maxEdge: MAX_EDGE,
  maxPixels: MAX_PIXELS,
  minPixels: MIN_PIXELS,
  multiple: SIZE_MULTIPLE,
} as const;

export const legacyGenerationSizeMap = {
  "参考图": "auto",
  "方形": "1024x1024",
  square: "1024x1024",
  landscape: "1536x1024",
  portrait: "1024x1536",
  "1:1": "1024x1024",
  "3:4": "1024x1360",
  "9:16": "1024x1824",
  "4:3": "1360x1024",
  "16:9": "1824x1024",
  "1024x1024": "1024x1024",
  "1024x1536": "1024x1536",
  "1536x1024": "1536x1024",
} as const satisfies Record<string, GenerationSizeToken>;

function roundToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function floorToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.floor(value / multiple) * multiple);
}

function ceilToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.ceil(value / multiple) * multiple);
}

function normalizeDimensions(width: number, height: number) {
  let normalizedWidth = roundToMultiple(width, SIZE_MULTIPLE);
  let normalizedHeight = roundToMultiple(height, SIZE_MULTIPLE);

  const scaleToFit = (scale: number) => {
    normalizedWidth = floorToMultiple(normalizedWidth * scale, SIZE_MULTIPLE);
    normalizedHeight = floorToMultiple(normalizedHeight * scale, SIZE_MULTIPLE);
  };

  const scaleToFill = (scale: number) => {
    normalizedWidth = ceilToMultiple(normalizedWidth * scale, SIZE_MULTIPLE);
    normalizedHeight = ceilToMultiple(normalizedHeight * scale, SIZE_MULTIPLE);
  };

  for (let index = 0; index < 4; index += 1) {
    const maxEdge = Math.max(normalizedWidth, normalizedHeight);
    if (maxEdge > MAX_EDGE) {
      scaleToFit(MAX_EDGE / maxEdge);
    }

    if (normalizedWidth / normalizedHeight > MAX_ASPECT_RATIO) {
      normalizedWidth = floorToMultiple(normalizedHeight * MAX_ASPECT_RATIO, SIZE_MULTIPLE);
    } else if (normalizedHeight / normalizedWidth > MAX_ASPECT_RATIO) {
      normalizedHeight = floorToMultiple(normalizedWidth * MAX_ASPECT_RATIO, SIZE_MULTIPLE);
    }

    const pixels = normalizedWidth * normalizedHeight;
    if (pixels > MAX_PIXELS) {
      scaleToFit(Math.sqrt(MAX_PIXELS / pixels));
    } else if (pixels < MIN_PIXELS) {
      scaleToFill(Math.sqrt(MIN_PIXELS / pixels));
    }
  }

  return { height: normalizedHeight, width: normalizedWidth };
}

export function parseImageSize(size: string) {
  const match = size.match(SIZE_PATTERN);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { height, width };
}

export function parseImageRatio(ratio: string) {
  const match = ratio.match(RATIO_PATTERN);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { height, width };
}

export function normalizeImageSize(size: string): GenerationSizeToken | null {
  const parsed = parseImageSize(size);
  if (!parsed) return null;

  const { height, width } = normalizeDimensions(parsed.width, parsed.height);
  return `${width}x${height}` as GenerationSizeToken;
}

export function calculateImageSize(tier: SizeTier, ratio: string): GenerationSizeToken | null {
  const parsed = parseImageRatio(ratio);
  if (!parsed) return null;

  const { height: ratioHeight, width: ratioWidth } = parsed;
  if (ratioWidth === ratioHeight) {
    const side = tier === "1K" ? 1024 : tier === "2K" ? 2048 : 3840;
    return normalizeImageSize(`${side}x${side}`);
  }

  if (tier === "1K") {
    const shortSide = 1024;
    const width =
      ratioWidth > ratioHeight
        ? roundToMultiple((shortSide * ratioWidth) / ratioHeight, SIZE_MULTIPLE)
        : shortSide;
    const height =
      ratioWidth > ratioHeight
        ? shortSide
        : roundToMultiple((shortSide * ratioHeight) / ratioWidth, SIZE_MULTIPLE);

    return normalizeImageSize(`${width}x${height}`);
  }

  const longSide = tier === "2K" ? 2048 : 3840;
  const width =
    ratioWidth > ratioHeight
      ? longSide
      : roundToMultiple((longSide * ratioWidth) / ratioHeight, SIZE_MULTIPLE);
  const height =
    ratioWidth > ratioHeight
      ? roundToMultiple((longSide * ratioHeight) / ratioWidth, SIZE_MULTIPLE)
      : longSide;

  return normalizeImageSize(`${width}x${height}`);
}

export function normalizeGenerationSize(value: string): GenerationSizeToken | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "auto") return "auto";

  const legacyValue = legacyGenerationSizeMap[trimmed as keyof typeof legacyGenerationSizeMap];
  if (legacyValue) return legacyValue;

  const normalizedSize = normalizeImageSize(trimmed);
  if (normalizedSize) return normalizedSize;

  return calculateImageSize("1K", trimmed);
}

export function getAspectRatio(size: string) {
  const normalized = normalizeGenerationSize(size);
  if (!normalized || normalized === "auto") return undefined;

  const parsed = parseImageSize(normalized);
  if (!parsed) return undefined;

  return `${parsed.width} / ${parsed.height}`;
}

export function formatImageRatio(width: number, height: number) {
  const roundedWidth = Math.round(width);
  const roundedHeight = Math.round(height);
  if (
    !Number.isFinite(roundedWidth) ||
    !Number.isFinite(roundedHeight) ||
    roundedWidth <= 0 ||
    roundedHeight <= 0
  ) {
    return "";
  }

  const gcd = (left: number, right: number): number => (right === 0 ? left : gcd(right, left % right));
  const divisor = gcd(roundedWidth, roundedHeight);
  const simplifiedWidth = roundedWidth / divisor;
  const simplifiedHeight = roundedHeight / divisor;
  const simplified = `${simplifiedWidth}:${simplifiedHeight}`;
  const commonRatios = [
    [1, 1],
    [4, 3],
    [3, 4],
    [3, 2],
    [2, 3],
    [16, 9],
    [9, 16],
    [21, 9],
    [9, 21],
  ];

  if (commonRatios.some(([widthValue, heightValue]) => widthValue === simplifiedWidth && heightValue === simplifiedHeight)) {
    return simplified;
  }

  const actualRatio = roundedWidth / roundedHeight;
  const nearest = commonRatios
    .map(([widthValue, heightValue]) => {
      const ratio = widthValue / heightValue;
      return {
        delta: Math.abs(actualRatio - ratio) / ratio,
        label: `${widthValue}:${heightValue}`,
      };
    })
    .sort((left, right) => left.delta - right.delta)[0];

  return nearest && nearest.delta <= 0.01 ? `≈${nearest.label}` : simplified;
}

export function getGenerationSizeLabel(size: string) {
  const normalized = normalizeGenerationSize(size);
  if (!normalized) return size;
  if (normalized === "auto") return "自动";

  const parsed = parseImageSize(normalized);
  if (!parsed) return normalized;

  return `${normalized} ${formatImageRatio(parsed.width, parsed.height)}`;
}

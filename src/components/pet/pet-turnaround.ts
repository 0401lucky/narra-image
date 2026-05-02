import type { PetFrame, PetId } from "@/components/pet/pet-catalog";

export type PetDirection =
  | "front"
  | "front-right"
  | "right"
  | "back-right"
  | "back"
  | "back-left"
  | "left"
  | "front-left";

export type PetTurnaroundDefinition = {
  spriteUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  scale: number;
  frames: Record<PetDirection, PetFrame>;
};

const TURNAROUND_WIDTH = 2172;
const TURNAROUND_HEIGHT = 724;
const TURNAROUND_SCALE = 0.31;

export const PET_TURNAROUNDS = {
  navy: {
    spriteUrl: "/pet/navy-turnaround.png",
    naturalWidth: TURNAROUND_WIDTH,
    naturalHeight: TURNAROUND_HEIGHT,
    scale: TURNAROUND_SCALE,
    frames: {
      front: { name: "front", x: 46, y: 165, width: 223, height: 361 },
      "front-left": { name: "front-left", x: 326, y: 166, width: 217, height: 362 },
      left: { name: "left", x: 603, y: 169, width: 211, height: 359 },
      "back-left": { name: "back-left", x: 884, y: 171, width: 202, height: 357 },
      back: { name: "back", x: 1155, y: 170, width: 203, height: 358 },
      "back-right": { name: "back-right", x: 1421, y: 171, width: 208, height: 358 },
      right: { name: "right", x: 1670, y: 169, width: 216, height: 360 },
      "front-right": { name: "front-right", x: 1920, y: 171, width: 222, height: 357 },
    },
  },
  silver: {
    spriteUrl: "/pet/silver-turnaround.png",
    naturalWidth: TURNAROUND_WIDTH,
    naturalHeight: TURNAROUND_HEIGHT,
    scale: TURNAROUND_SCALE,
    frames: {
      front: { name: "front", x: 52, y: 165, width: 220, height: 376 },
      "front-left": { name: "front-left", x: 345, y: 169, width: 198, height: 372 },
      left: { name: "left", x: 615, y: 172, width: 199, height: 369 },
      "back-left": { name: "back-left", x: 884, y: 172, width: 202, height: 368 },
      back: { name: "back", x: 1154, y: 172, width: 204, height: 368 },
      "back-right": { name: "back-right", x: 1411, y: 174, width: 209, height: 367 },
      right: { name: "right", x: 1663, y: 172, width: 211, height: 368 },
      "front-right": { name: "front-right", x: 1916, y: 172, width: 218, height: 369 },
    },
  },
  lilac: {
    spriteUrl: "/pet/lilac-turnaround.png",
    naturalWidth: TURNAROUND_WIDTH,
    naturalHeight: TURNAROUND_HEIGHT,
    scale: TURNAROUND_SCALE,
    frames: {
      front: { name: "front", x: 45, y: 163, width: 227, height: 382 },
      "front-left": { name: "front-left", x: 330, y: 164, width: 213, height: 382 },
      left: { name: "left", x: 606, y: 160, width: 201, height: 387 },
      "back-left": { name: "back-left", x: 865, y: 168, width: 212, height: 379 },
      back: { name: "back", x: 1143, y: 163, width: 215, height: 384 },
      "back-right": { name: "back-right", x: 1417, y: 175, width: 210, height: 376 },
      right: { name: "right", x: 1676, y: 170, width: 198, height: 381 },
      "front-right": { name: "front-right", x: 1912, y: 177, width: 216, height: 377 },
    },
  },
  rose: {
    spriteUrl: "/pet/rose-turnaround.png",
    naturalWidth: TURNAROUND_WIDTH,
    naturalHeight: TURNAROUND_HEIGHT,
    scale: TURNAROUND_SCALE,
    frames: {
      front: { name: "front", x: 55, y: 166, width: 217, height: 368 },
      "front-left": { name: "front-left", x: 345, y: 168, width: 198, height: 367 },
      left: { name: "left", x: 616, y: 170, width: 198, height: 364 },
      "back-left": { name: "back-left", x: 880, y: 175, width: 204, height: 361 },
      back: { name: "back", x: 1149, y: 169, width: 209, height: 367 },
      "back-right": { name: "back-right", x: 1411, y: 173, width: 202, height: 363 },
      right: { name: "right", x: 1654, y: 174, width: 198, height: 361 },
      "front-right": { name: "front-right", x: 1906, y: 176, width: 210, height: 360 },
    },
  },
  violet: {
    spriteUrl: "/pet/violet-turnaround.png",
    naturalWidth: TURNAROUND_WIDTH,
    naturalHeight: TURNAROUND_HEIGHT,
    scale: TURNAROUND_SCALE,
    frames: {
      front: { name: "front", x: 21, y: 172, width: 251, height: 351 },
      "front-left": { name: "front-left", x: 329, y: 172, width: 214, height: 352 },
      left: { name: "left", x: 543, y: 176, width: 271, height: 350 },
      "back-left": { name: "back-left", x: 874, y: 175, width: 212, height: 351 },
      back: { name: "back", x: 1138, y: 175, width: 220, height: 352 },
      "back-right": { name: "back-right", x: 1400, y: 176, width: 211, height: 354 },
      right: { name: "right", x: 1650, y: 178, width: 207, height: 351 },
      "front-right": { name: "front-right", x: 1914, y: 176, width: 237, height: 355 },
    },
  },
  cocoa: {
    spriteUrl: "/pet/cocoa-turnaround.png",
    naturalWidth: TURNAROUND_WIDTH,
    naturalHeight: TURNAROUND_HEIGHT,
    scale: TURNAROUND_SCALE,
    frames: {
      front: { name: "front", x: 46, y: 171, width: 226, height: 363 },
      "front-left": { name: "front-left", x: 340, y: 175, width: 203, height: 360 },
      left: { name: "left", x: 615, y: 169, width: 199, height: 366 },
      "back-left": { name: "back-left", x: 880, y: 170, width: 206, height: 364 },
      back: { name: "back", x: 1141, y: 172, width: 214, height: 362 },
      "back-right": { name: "back-right", x: 1412, y: 170, width: 216, height: 365 },
      right: { name: "right", x: 1669, y: 169, width: 211, height: 366 },
      "front-right": { name: "front-right", x: 1922, y: 171, width: 216, height: 364 },
    },
  },
  mono: {
    spriteUrl: "/pet/mono-turnaround.png",
    naturalWidth: TURNAROUND_WIDTH,
    naturalHeight: TURNAROUND_HEIGHT,
    scale: TURNAROUND_SCALE,
    frames: {
      front: { name: "front", x: 56, y: 165, width: 205, height: 363 },
      "front-left": { name: "front-left", x: 336, y: 172, width: 205, height: 359 },
      left: { name: "left", x: 617, y: 172, width: 193, height: 358 },
      "back-left": { name: "back-left", x: 879, y: 174, width: 193, height: 356 },
      back: { name: "back", x: 1154, y: 175, width: 194, height: 355 },
      "back-right": { name: "back-right", x: 1417, y: 180, width: 192, height: 350 },
      right: { name: "right", x: 1672, y: 179, width: 192, height: 353 },
      "front-right": { name: "front-right", x: 1922, y: 180, width: 203, height: 352 },
    },
  },
} as const satisfies Partial<Record<PetId, PetTurnaroundDefinition>>;

export function getPetTurnaround(
  petId: string | null | undefined,
): PetTurnaroundDefinition | null {
  return PET_TURNAROUNDS[petId as PetId] ?? null;
}

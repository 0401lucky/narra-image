import type { CanvasGenerationParametersV1, CanvasRunTransientFieldsV1 } from "@/lib/canvas/contracts";

import type { GenerationItem } from "../types";

export type CanvasJobOrigin = Readonly<{
  ownerId: string;
  canvasId: string;
  nodeId: string;
  runId: string;
}>;

export type CanvasJobsPort = {
  register: (origin: CanvasJobOrigin, job: GenerationItem) => GenerationItem;
  read: (jobId: string) => GenerationItem | null;
  subscribe: (listener: (origin: CanvasJobOrigin, job: GenerationItem) => void) => () => void;
};

export type CanvasTransientLease = {
  fields: CanvasRunTransientFieldsV1;
  release: () => void;
};

export type CanvasTransientLeaseInput = {
  origin: CanvasJobOrigin;
  parameters: CanvasGenerationParametersV1;
  reason: "run" | "transport-retry";
  signal: AbortSignal;
};

export type AcquireCanvasTransientLease = (input: CanvasTransientLeaseInput) => Promise<CanvasTransientLease | null>;

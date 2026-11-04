import type { Edge, Node } from "@xyflow/react";

import type {
  CanvasEdgeV1,
  CanvasGenerationNodeV1,
  CanvasLocalReferenceNodeV1,
  CanvasPromptNodeV1,
  CanvasResultNodeV1,
  CanvasRuntimeImageDtoV1,
} from "@/lib/canvas/contracts";

import type { ChannelInfo } from "../types";
import type { CanvasController } from "./controller";
import type { CanvasControllerSnapshot, CanvasReferenceView, CanvasRunView } from "./controller-types";
import type { CanvasPreviewLease } from "./reference-runtime";
import type { CanvasEditorPort } from "./editor-state";

export type CanvasNodeTarget = { canvasId: string; nodeId: string };
export type CanvasNodeMeasurements = ReadonlyMap<string, { width: number; height: number }>;
export type CanvasViewMode = "creation" | "graph";
export type CanvasTool = "select" | "pan";

// Display URLs and preview leases are runtime values, never scene fields.
export type CanvasImageTarget = CanvasNodeTarget & { url: string } & (
  | { kind: "reference"; assetId?: string }
  | { kind: "result"; imageId: string; jobId: string; actualWidth?: number | null; actualHeight?: number | null; actualSize?: string | null }
);

export type CanvasStageProps = {
  snapshot: CanvasControllerSnapshot;
  controller: CanvasController | null;
  editor?: CanvasEditorPort;
  touchPresentation?: boolean;
  channels: readonly ChannelInfo[];
  onViewImage: (target: CanvasImageTarget) => void;
  onDownloadImage: (target: CanvasImageTarget) => void;
  onOpenProviderSettings: (target: CanvasNodeTarget) => void;
  onReturnToChat: () => void;
};

export type CanvasNodeActions = {
  updatePrompt: (nodeId: string, text: string) => boolean;
  replaceReference: (nodeId: string, file: File) => void;
  acquirePreview: (nodeId: string) => CanvasPreviewLease | null;
  removeNode: (nodeId: string) => void;
  inspectNode: (nodeId: string) => void;
  runNode: (nodeId: string) => void;
  retryTransport: (runId: string) => void;
  recoverRuns: () => void;
  refreshRuntime: () => void;
  viewImage: CanvasStageProps["onViewImage"];
  downloadImage: CanvasStageProps["onDownloadImage"];
  reportError: (error: unknown) => void;
};

type CanvasNodeData<T> = {
  canvasId: string;
  node: T;
  readOnly: boolean;
  previewOnly?: boolean;
  editorOpen?: boolean;
  graphView?: boolean;
  editorReplacesCard?: boolean;
  actions: CanvasNodeActions;
};
export type CanvasPromptFlowNode = Node<CanvasNodeData<CanvasPromptNodeV1>, "prompt">;
export type CanvasReferenceFlowNode = Node<CanvasNodeData<CanvasLocalReferenceNodeV1> & { reference: CanvasReferenceView | null }, "reference">;
export type CanvasGenerationFlowNode = Node<CanvasNodeData<CanvasGenerationNodeV1> & { referenceCount: number; hasPrompt: boolean; prompt: CanvasPromptNodeV1 | null; sharedPromptCount: number; run: CanvasRunView | null }, "generation">;
export type CanvasResultFlowNode = Node<CanvasNodeData<CanvasResultNodeV1> & { image: CanvasRuntimeImageDtoV1 | null }, "result">;
export type CanvasFlowNode = CanvasPromptFlowNode | CanvasReferenceFlowNode | CanvasGenerationFlowNode | CanvasResultFlowNode;
export type CanvasFlowEdge = Edge<{ edge: CanvasEdgeV1 }>;

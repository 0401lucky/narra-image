export type GenerationStatusFilter =
  | ""
  | "ALL"
  | "SUCCEEDED"
  | "ACTIVE"
  | "FAILED"
  | "COORDINATION";

export type GenerationTypeFilter =
  | ""
  | "TEXT_TO_IMAGE"
  | "IMAGE_TO_IMAGE"
  | "TEXT_TO_VIDEO"
  | "IMAGE_TO_VIDEO";

export type GenerationSourceFilter = "" | "WEB" | "API";
export type GenerationModeFilter = "" | "BUILT_IN" | "CUSTOM";

export function buildGenerationsFilterUrl(params: {
  mode?: string;
  page?: number;
  q?: string;
  source?: string;
  status?: string;
  type?: string;
  view: "card" | "list";
}) {
  const sp = new URLSearchParams();
  sp.set("view", params.view);
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  if (params.q?.trim()) sp.set("q", params.q.trim());
  if (params.status) sp.set("status", params.status);
  if (params.type) sp.set("type", params.type);
  if (params.source) sp.set("source", params.source);
  if (params.mode) sp.set("mode", params.mode);
  return `/admin/generations?${sp.toString()}`;
}

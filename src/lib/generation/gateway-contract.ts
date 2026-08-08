/**
 * Go 内部生成网关的共享常量（无副作用，供 gateway-client 与契约测试共同消费）。
 * 契约事实来源仍是 contracts/gateway/v1/envelope.json。
 */
export const GATEWAY_SCHEMA_VERSION = 1;
export const GATEWAY_SIGNATURE_HEADER = "X-Gateway-Signature";
export const GATEWAY_API_KEY_HEADER = "X-Gateway-Api-Key";

export type GatewayEndpoint =
  | "images.generations"
  | "images.edits"
  | "responses"
  | "chat.completions";

export const GATEWAY_ENDPOINT_PATHS: Record<GatewayEndpoint, string> = {
  "images.generations": "/internal/gateway/v1/images/generations",
  "images.edits": "/internal/gateway/v1/images/edits",
  responses: "/internal/gateway/v1/responses",
  "chat.completions": "/internal/gateway/v1/chat/completions",
};

export const GATEWAY_ENDPOINTS = Object.keys(
  GATEWAY_ENDPOINT_PATHS,
) as GatewayEndpoint[];

/** 与 contracts/gateway/v1/envelope.json limits.sourceImageUrlsMax 一致。 */
export const GATEWAY_MAX_SOURCE_IMAGES = 10;

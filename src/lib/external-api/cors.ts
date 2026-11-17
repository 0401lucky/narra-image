const EXTERNAL_API_ALIASES = new Set([
  "/models",
  "/images/generations",
  "/images/edits",
  "/chat/completions",
  "/chat/completion",
  "/responses",
]);

export function isExternalApiPath(pathname: string) {
  const path = pathname.replace(/\/+$/, "");
  return path === "/v1" || path.startsWith("/v1/") || EXTERNAL_API_ALIASES.has(path);
}

export function externalApiCorsHeaders(request: Request) {
  // Public API callers supply their own Bearer key; cookie credentials are not enabled.
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      request.headers.get("Access-Control-Request-Headers")?.trim() || "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Access-Control-Request-Headers",
  });
}

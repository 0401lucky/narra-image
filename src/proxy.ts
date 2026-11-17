import { NextResponse, type NextRequest } from "next/server";

import { getEnv } from "@/lib/env";
import { externalApiCorsHeaders, isExternalApiPath } from "@/lib/external-api/cors";
import { managedImageOptimizerRewrite } from "@/lib/storage/image-optimizer";

export function proxy(request: NextRequest) {
  if (isExternalApiPath(request.nextUrl.pathname)) {
    const response = request.method === "OPTIONS"
      ? new NextResponse(null, { status: 204 })
      : NextResponse.next();
    externalApiCorsHeaders(request).forEach((value, name) => {
      response.headers.set(name, value);
    });
    return response;
  }

  const environment = getEnv();
  const rewritten = environment.IMAGE_STORAGE_MANAGED_ENABLED
    ? managedImageOptimizerRewrite(request.url, environment.APP_URL) : null;
  return rewritten ? NextResponse.rewrite(rewritten) : NextResponse.next();
}

export const config = {
  matcher: [
    "/_next/image",
    "/v1/:path*",
    "/models",
    "/images/generations",
    "/images/edits",
    "/chat/completions",
    "/chat/completion",
    "/responses",
  ],
};

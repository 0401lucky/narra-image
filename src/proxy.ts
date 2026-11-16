import { NextResponse, type NextRequest } from "next/server";

import { getEnv } from "@/lib/env";
import { managedImageOptimizerRewrite } from "@/lib/storage/image-optimizer";

export function proxy(request: NextRequest) {
  const environment = getEnv();
  const rewritten = environment.IMAGE_STORAGE_MANAGED_ENABLED
    ? managedImageOptimizerRewrite(request.url, environment.APP_URL) : null;
  return rewritten ? NextResponse.rewrite(rewritten) : NextResponse.next();
}

export const config = { matcher: ["/_next/image"] };

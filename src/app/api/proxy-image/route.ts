import { getCurrentSession } from "@/lib/server/current-user";
import { getErrorMessage } from "@/lib/server/http";
import { assertPublicHttpUrl } from "@/lib/server/safe-remote-url";

const PROXY_FETCH_TIMEOUT_MS = 15_000;

/**
 * GET /api/proxy-image?url=...
 * Server-side proxy to fetch images from external storage (S3/R2)
 * avoiding CORS restrictions when the client needs to read image data.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return new Response("请先登录", { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get("url");

    if (!imageUrl) {
      return new Response("Missing url parameter", { status: 400 });
    }

    const target = await assertPublicHttpUrl(imageUrl);

    const upstream = await fetch(target, {
      signal: AbortSignal.timeout(PROXY_FETCH_TIMEOUT_MS),
      // 重定向可指向内网，绕过上面的地址校验，直接拒绝
      redirect: "error",
    });

    if (!upstream.ok || !upstream.body) {
      return new Response("Failed to fetch image", { status: upstream.status });
    }

    const contentType = upstream.headers.get("content-type") || "image/png";
    const contentLength = upstream.headers.get("content-length");
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=86400, immutable",
    };
    if (contentLength) {
      headers["Content-Length"] = contentLength;
    }

    return new Response(upstream.body, { headers });
  } catch (error) {
    return new Response(getErrorMessage(error), { status: 403 });
  }
}

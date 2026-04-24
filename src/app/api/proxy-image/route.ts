import { requireCurrentUserRecord } from "@/lib/server/current-user";
import { getErrorMessage } from "@/lib/server/http";

/**
 * GET /api/proxy-image?url=...
 * Server-side proxy to fetch images from external storage (S3/R2)
 * avoiding CORS restrictions when the client needs to read image data.
 */
export async function GET(request: Request) {
  try {
    await requireCurrentUserRecord();

    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get("url");

    if (!imageUrl) {
      return new Response("Missing url parameter", { status: 400 });
    }

    const upstream = await fetch(imageUrl);

    if (!upstream.ok) {
      return new Response("Failed to fetch image", { status: upstream.status });
    }

    const contentType = upstream.headers.get("content-type") || "image/png";
    const buffer = await upstream.arrayBuffer();

    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    return new Response(getErrorMessage(error), { status: 403 });
  }
}

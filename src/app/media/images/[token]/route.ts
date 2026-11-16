import { ImageRepository } from "@/lib/storage/image-repository";
import { ImageStorageError } from "@/lib/storage/image-contract";
import { headManagedImage, openManagedImage } from "@/lib/storage/managed-image-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function serveImage(request: Request, context: { params: Promise<{ token: string }> }, head: boolean): Promise<Response> {
  const { token } = await context.params;
  if (token.length !== 64 || !/^[0-9a-f]{64}$/.test(token)) return new Response(null, { status: 404 });
  try {
    const image = await new ImageRepository().getByToken(token);
    if (!image) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    if (image.asset.state === "DELETED" || image.asset.state === "DELETING") return new Response(null, { status: 410, headers: { "Cache-Control": "no-store" } });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    if (image.asset.state !== "AVAILABLE" || !image.object || !image.location) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    const headers = new Headers({
      "Content-Type": image.asset.mimeType, "Content-Length": image.asset.byteLength,
      "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=300, must-revalidate",
      ETag: `"${image.asset.sha256}"`,
    });
    if (request.headers.get("if-none-match") === headers.get("etag")) {
      await headManagedImage(image, signal);
      headers.delete("Content-Length");
      return new Response(null, { status: 304, headers });
    }
    if (head) { await headManagedImage(image, signal); return new Response(null, { status: 200, headers }); }
    return new Response(await openManagedImage(image, signal), { status: 200, headers });
  } catch (error) {
    const status = error instanceof ImageStorageError && error.code === "IMAGE_UNAVAILABLE" ? 404 : 503;
    return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export function GET(request: Request, context: { params: Promise<{ token: string }> }) { return serveImage(request, context, false); }
export function HEAD(request: Request, context: { params: Promise<{ token: string }> }) { return serveImage(request, context, true); }

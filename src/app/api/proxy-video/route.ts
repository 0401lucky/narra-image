import { getCurrentSession } from "@/lib/server/current-user";
import { getErrorMessage } from "@/lib/server/http";
import { fetchPublicHttpUrl } from "@/lib/server/safe-remote-url";

const PROXY_FETCH_TIMEOUT_MS = 15 * 60 * 1000;
const PROXY_VIDEO_MAX_BYTES = 512 * 1024 * 1024;
const MP4_HEADER_BYTES = 12;

function isMp4(bytes: Uint8Array) {
  return bytes.length >= MP4_HEADER_BYTES
    && bytes[4] === 0x66
    && bytes[5] === 0x74
    && bytes[6] === 0x79
    && bytes[7] === 0x70;
}

async function readPrefix(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < MP4_HEADER_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }

  const prefix = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    prefix.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { chunks, prefix, total };
}

function restoreLimitedStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  initialChunks: Uint8Array[],
  initialSize: number,
) {
  let total = initialSize;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      initialChunks.forEach((chunk) => controller.enqueue(chunk));
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }

      total += value.byteLength;
      if (total > PROXY_VIDEO_MAX_BYTES) {
        await reader.cancel();
        controller.error(new Error("视频文件过大"));
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return new Response("请先登录", { status: 403 });
    }

    const videoUrl = new URL(request.url).searchParams.get("url");
    if (!videoUrl) {
      return new Response("Missing url parameter", { status: 400 });
    }

    const upstream = await fetchPublicHttpUrl(videoUrl, {
      headers: { Accept: "video/mp4" },
      signal: AbortSignal.timeout(PROXY_FETCH_TIMEOUT_MS),
    });
    if (!upstream.ok || !upstream.body) {
      return new Response("Failed to fetch video", { status: upstream.status });
    }

    const contentLength = Number(upstream.headers.get("content-length") || "0");
    if (contentLength > PROXY_VIDEO_MAX_BYTES) {
      await upstream.body.cancel();
      return new Response("Video is too large", { status: 413 });
    }

    const reader = upstream.body.getReader();
    const { chunks, prefix, total } = await readPrefix(reader);
    if (!isMp4(prefix)) {
      await reader.cancel();
      return new Response("Unsupported video content", { status: 415 });
    }
    if (total > PROXY_VIDEO_MAX_BYTES) {
      await reader.cancel();
      return new Response("Video is too large", { status: 413 });
    }

    const headers: Record<string, string> = {
      "Cache-Control": "private, max-age=86400, immutable",
      "Content-Disposition": "attachment; filename=narra-video.mp4",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": "video/mp4",
      "X-Content-Type-Options": "nosniff",
    };
    if (contentLength > 0) {
      headers["Content-Length"] = String(contentLength);
    }

    return new Response(restoreLimitedStream(reader, chunks, total), { headers });
  } catch (error) {
    return new Response(getErrorMessage(error), { status: 403 });
  }
}

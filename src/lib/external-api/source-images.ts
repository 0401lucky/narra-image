import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_EXTERNAL_IMAGE_BYTES = 10 * 1024 * 1024;
const EXTERNAL_IMAGE_TIMEOUT_MS = 10_000;
const MAX_EXTERNAL_IMAGE_REDIRECTS = 3;
const ALLOWED_EXTERNAL_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isBlockedIpv4(address: string) {
  const octets = address.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return true;
  }

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function ipv4ToHextets(address: string) {
  const octets = address.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return null;
  }

  return [
    ((octets[0] << 8) | octets[1]).toString(16),
    ((octets[2] << 8) | octets[3]).toString(16),
  ];
}

function parseIpv6(address: string) {
  const zoneIndex = address.indexOf("%");
  const withoutZone = zoneIndex >= 0 ? address.slice(0, zoneIndex) : address;
  let normalized = withoutZone.toLowerCase();

  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4Part = normalized.slice(lastColon + 1);
    const hextets = ipv4ToHextets(ipv4Part);
    if (!hextets) return null;
    normalized = `${normalized.slice(0, lastColon)}:${hextets.join(":")}`;
  }

  const pieces = normalized.split("::");
  if (pieces.length > 2) return null;

  const left = pieces[0] ? pieces[0].split(":").filter(Boolean) : [];
  const right = pieces[1] ? pieces[1].split(":").filter(Boolean) : [];
  const missing = pieces.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0) return null;

  const parts = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ];
  if (parts.length !== 8) return null;

  let value = BigInt(0);
  for (const part of parts) {
    const parsed = Number.parseInt(part, 16);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffff) {
      return null;
    }
    value = (value << BigInt(16)) + BigInt(parsed);
  }

  return value;
}

function matchesIpv6Prefix(value: bigint, prefix: string, bits: number) {
  const parsedPrefix = parseIpv6(prefix);
  if (parsedPrefix == null) return false;
  const shift = BigInt(128 - bits);
  return (value >> shift) === (parsedPrefix >> shift);
}

function isBlockedIpv6(address: string) {
  const value = parseIpv6(address);
  if (value == null) return true;

  if (value === BigInt(0) || value === BigInt(1)) return true;
  if (matchesIpv6Prefix(value, "::ffff:0:0", 96)) {
    const ipv4Number = Number(value & BigInt(0xffffffff));
    const mapped = [
      (ipv4Number >>> 24) & 255,
      (ipv4Number >>> 16) & 255,
      (ipv4Number >>> 8) & 255,
      ipv4Number & 255,
    ].join(".");
    return isBlockedIpv4(mapped);
  }

  return (
    matchesIpv6Prefix(value, "64:ff9b:1::", 48) ||
    matchesIpv6Prefix(value, "100::", 64) ||
    matchesIpv6Prefix(value, "2001:10::", 28) ||
    matchesIpv6Prefix(value, "2001:db8::", 32) ||
    matchesIpv6Prefix(value, "2002::", 16) ||
    matchesIpv6Prefix(value, "fc00::", 7) ||
    matchesIpv6Prefix(value, "fe80::", 10) ||
    matchesIpv6Prefix(value, "ff00::", 8)
  );
}

function isBlockedIpAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

async function assertSafeExternalImageUrl(parsed: URL) {
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("参考图 URL 仅支持 http/https");
  }

  if (parsed.username || parsed.password) {
    throw new Error("参考图 URL 不允许携带用户名或密码");
  }

  const hostname = parsed.hostname.toLowerCase();
  const hostForIp =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  if (hostForIp === "localhost" || hostForIp.endsWith(".localhost")) {
    throw new Error("参考图 URL 不允许指向本地地址");
  }

  if (isIP(hostForIp)) {
    if (isBlockedIpAddress(hostForIp)) {
      throw new Error("参考图 URL 不允许指向内网或保留地址");
    }
    return;
  }

  const addresses = await lookup(hostForIp, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error("参考图 URL 域名无法解析");
  }

  if (addresses.some((item) => isBlockedIpAddress(item.address))) {
    throw new Error("参考图 URL 不允许解析到内网或保留地址");
  }
}

async function fetchExternalImage(parsed: URL) {
  let current = parsed;
  for (let redirectCount = 0; redirectCount <= MAX_EXTERNAL_IMAGE_REDIRECTS; redirectCount += 1) {
    await assertSafeExternalImageUrl(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXTERNAL_IMAGE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current, {
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("参考图下载重定向无效");
      }
      current = new URL(location, current);
      continue;
    }

    return response;
  }

  throw new Error("参考图下载重定向次数过多");
}

function getImageFileExtension(contentType: string) {
  if (contentType === "image/jpeg") return "jpg";
  return contentType.split("/")[1] || "png";
}

export async function downloadExternalImage(url: string, index = 0) {
  const { resolveManagedImageUrl, readManagedImage } = await import("@/lib/storage/managed-image-storage");
  const image = await resolveManagedImageUrl(url);
  if (image) {
    if (BigInt(image.asset.byteLength) > BigInt(MAX_EXTERNAL_IMAGE_BYTES)) throw new Error("参考图不能超过 10MB");
    if (!ALLOWED_EXTERNAL_IMAGE_TYPES.has(image.asset.mimeType)) throw new Error("参考图 URL 必须返回 png、jpeg、webp 或 gif 图片");
    return { data: await readManagedImage(image, AbortSignal.timeout(EXTERNAL_IMAGE_TIMEOUT_MS)),
      fileName: `source-${index + 1}.${getImageFileExtension(image.asset.mimeType)}`, mimeType: image.asset.mimeType };
  }
  const parsed = new URL(url);
  const response = await fetchExternalImage(parsed);

  if (!response.ok) {
    throw new Error("参考图下载失败");
  }

  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_EXTERNAL_IMAGE_TYPES.has(contentType)) {
    throw new Error("参考图 URL 必须返回 png、jpeg、webp 或 gif 图片");
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_EXTERNAL_IMAGE_BYTES) {
    throw new Error("参考图不能超过 10MB");
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_EXTERNAL_IMAGE_BYTES) {
    throw new Error("参考图不能超过 10MB");
  }

  const extension = getImageFileExtension(contentType);
  return {
    data: Buffer.from(arrayBuffer),
    fileName: `source-${index + 1}.${extension}`,
    mimeType: contentType,
  };
}

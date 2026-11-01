import "server-only";

import type { ImageDimensions } from "@/lib/generation/image-dimensions";
import { CANVAS_LIMITS, CanvasContractError } from "./contracts";

function invalid(): never { throw new CanvasContractError("CANVAS_INVALID_INPUT"); }

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function pngCrc(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function verifyPng(bytes: Buffer): ImageDimensions {
  let offset = 8;
  let dimensions: ImageDimensions | undefined;
  let palette = false;
  let image = false;
  let imageEnded = false;
  let imageBytes = 0;
  let color = -1;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) invalid();
    // Buffer's ASCII decoder masks high bits; keep identifiers lossless.
    const kind = bytes.toString("latin1", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(kind) || pngCrc(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) invalid();
    const data = bytes.subarray(offset + 8, end - 4);
    if (!dimensions && kind !== "IHDR") invalid();
    if (kind === "IHDR") {
      if (dimensions || length !== 13) invalid();
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      color = data[9];
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (width < 1 || height < 1 || width > 0x7fffffff || height > 0x7fffffff || !depths[color]?.includes(data[8]) || data[10] !== 0 || data[11] !== 0 || data[12] > 1) invalid();
      dimensions = { width, height };
    } else if (kind === "PLTE") {
      if (palette || image || length < 3 || length > 768 || length % 3 !== 0 || color === 0 || color === 4) invalid();
      palette = true;
    } else if (kind === "IDAT") {
      if (imageEnded || (color === 3 && !palette)) invalid();
      image = true;
      imageBytes += length;
    } else if (kind === "IEND") {
      if (length !== 0 || !image || imageBytes < 6 || end !== bytes.length || !dimensions) invalid();
      return dimensions;
    } else {
      if (image) imageEnded = true;
      if (kind[0] === kind[0].toUpperCase()) invalid();
    }
    offset = end;
  }
  invalid();
}

function verifyJpeg(bytes: Buffer): ImageDimensions {
  let offset = 2;
  let dimensions: ImageDimensions | undefined;
  let scan = false;
  let entropyBytes = 0;
  const components = new Set<number>();
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) invalid();
    while (bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) invalid();
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!dimensions || !scan || entropyBytes === 0 || offset !== bytes.length) invalid();
      return dimensions;
    }
    if (marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) invalid();
    if (marker === 1) continue;
    if (offset + 2 > bytes.length) invalid();
    const length = bytes.readUInt16BE(offset);
    const end = offset + length;
    if (length < 2 || end > bytes.length) invalid();
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      if (dimensions || length < 11) invalid();
      const count = bytes[offset + 7];
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (count < 1 || count > 4 || length !== 8 + 3 * count || ![8, 12, 16].includes(bytes[offset + 2]) || height === 0 || width === 0) invalid();
      for (let index = 0; index < count; index += 1) {
        const component = bytes[offset + 8 + 3 * index];
        if (components.has(component)) invalid();
        components.add(component);
      }
      dimensions = { width, height };
    }
    offset = end;
    if (marker === 0xda) {
      const start = end - length;
      const count = bytes[start + 2];
      if (!dimensions || count < 1 || count > components.size || length !== 6 + 2 * count) invalid();
      const selected = new Set<number>();
      for (let index = 0; index < count; index += 1) {
        const component = bytes[start + 3 + 2 * index];
        if (!components.has(component) || selected.has(component)) invalid();
        selected.add(component);
      }
      scan = true;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { entropyBytes += 1; offset += 1; continue; }
        let next = offset + 1;
        while (bytes[next] === 0xff) next += 1;
        if (next >= bytes.length) invalid();
        if (bytes[next] === 0 || (bytes[next] >= 0xd0 && bytes[next] <= 0xd7)) { entropyBytes += 1; offset = next + 1; continue; }
        break;
      }
    }
  }
  invalid();
}

function verifyWebpChunks(bytes: Buffer, start: number, end: number, frame = false): { images: number; dimensions: ImageDimensions } {
  let offset = start;
  let images = 0;
  let dimensions: ImageDimensions | undefined;
  let extended = false;
  let animated = false;
  let animationHeader = false;
  while (offset + 8 <= end) {
    const kind = bytes.toString("latin1", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const content = offset + 8;
    const next = content + size + (size & 1);
    if (next > end || ((size & 1) && bytes[content + size] !== 0)) invalid();
    if (kind === "VP8X") {
      if (frame || offset !== start || size !== 10 || (bytes[content] & 0xc1) !== 0 || bytes.subarray(content + 1, content + 4).some((byte) => byte !== 0)) invalid();
      extended = true;
      animated = (bytes[content] & 2) !== 0;
      dimensions = { width: bytes.readUIntLE(content + 4, 3) + 1, height: bytes.readUIntLE(content + 7, 3) + 1 };
    } else if (kind === "VP8 " || kind === "VP8L") {
      if (animated || images !== 0) invalid();
      if (kind === "VP8 ") {
        if (size <= 10 || (bytes[content] & 1) !== 0 || !bytes.subarray(content + 3, content + 6).equals(Buffer.from([0x9d, 1, 0x2a])) || (bytes.readUInt16LE(content + 6) & 0x3fff) === 0 || (bytes.readUInt16LE(content + 8) & 0x3fff) === 0) invalid();
        const partition = bytes.readUIntLE(content, 3) >>> 5;
        if (partition > size - 10) invalid();
        dimensions ??= { width: bytes.readUInt16LE(content + 6) & 0x3fff, height: bytes.readUInt16LE(content + 8) & 0x3fff };
      } else {
        if (size <= 5 || bytes[content] !== 0x2f || (bytes[content + 4] & 0xe0) !== 0) invalid();
        const bits = bytes.readUInt32LE(content + 1);
        dimensions ??= { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      images += 1;
    } else if (kind === "ANIM") {
      if (frame || !animated || animationHeader || size !== 6 || images) invalid();
      animationHeader = true;
    } else if (kind === "ANMF") {
      if (frame || !animated || !animationHeader || size < 24 || (bytes[content + 15] & 0xfc) !== 0) invalid();
      if (verifyWebpChunks(bytes, content + 16, content + size, true).images !== 1) invalid();
      images += 1;
    } else if (kind === "ALPH") {
      if ((!frame && !extended) || images || size < 1) invalid();
    } else if (frame || !extended || !["ICCP", "EXIF", "XMP "].includes(kind)) invalid();
    offset = next;
  }
  if (offset !== end || images === 0 || !dimensions) invalid();
  return { images, dimensions };
}

// Walk the complete container, not just a MIME label or dimension header. This
// checks framing/CRCs and derives dimensions from the same verified segments;
// it does not allocate decoded pixels or impose the legacy header reader's limits.
export function verifyCanvasImage(bytes: Buffer, declaredType: string): ImageDimensions {
  if (bytes.length < 1 || bytes.length > CANVAS_LIMITS.importBytes) throw new CanvasContractError("CANVAS_LIMIT_EXCEEDED");
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (declaredType !== "image/png") invalid();
    return verifyPng(bytes);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    if (declaredType !== "image/jpeg") invalid();
    return verifyJpeg(bytes);
  } else if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    if (declaredType !== "image/webp" || bytes.readUInt32LE(4) !== bytes.length - 8) invalid();
    return verifyWebpChunks(bytes, 12, bytes.length).dimensions;
  } else invalid();
}

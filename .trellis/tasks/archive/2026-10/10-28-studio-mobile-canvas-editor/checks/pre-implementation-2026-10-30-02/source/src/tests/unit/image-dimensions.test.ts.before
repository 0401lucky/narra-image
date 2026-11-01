import { describe, expect, it } from "vitest";

import { readImageDimensions } from "@/lib/generation/image-dimensions";

function makePng(width: number, height: number) {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR chunk: length(4) + "IHDR" + data(13) + crc(4)
  const ihdrType = Buffer.from("IHDR");
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data.writeUInt8(8, 8);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(13, 0);
  const crc = Buffer.alloc(4);
  return Buffer.concat([header, length, ihdrType, data, crc]);
}

function makeJpeg(width: number, height: number) {
  // SOI + APP0 marker + SOF0 segment with width/height + EOI
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof0Header = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]);
  const dims = Buffer.alloc(4);
  dims.writeUInt16BE(height, 0);
  dims.writeUInt16BE(width, 2);
  const tail = Buffer.from([0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([soi, app0, sof0Header, dims, tail, eoi]);
}

function makeWebpVp8x(width: number, height: number) {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(22, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  buffer[20] = 0;
  buffer[21] = 0;
  buffer[22] = 0;
  buffer[23] = 0;
  const widthMinusOne = width - 1;
  buffer[24] = widthMinusOne & 0xff;
  buffer[25] = (widthMinusOne >> 8) & 0xff;
  buffer[26] = (widthMinusOne >> 16) & 0xff;
  const heightMinusOne = height - 1;
  buffer[27] = heightMinusOne & 0xff;
  buffer[28] = (heightMinusOne >> 8) & 0xff;
  buffer[29] = (heightMinusOne >> 16) & 0xff;
  return buffer;
}

function makeGif(width: number, height: number) {
  const buffer = Buffer.alloc(13);
  buffer.write("GIF89a", 0, "ascii");
  buffer.writeUInt16LE(width, 6);
  buffer.writeUInt16LE(height, 8);
  return buffer;
}

describe("readImageDimensions", () => {
  it("从 PNG 头部读出宽高", () => {
    expect(readImageDimensions(makePng(3840, 2160))).toEqual({
      height: 2160,
      width: 3840,
    });
  });

  it("从 JPEG SOF0 段读出宽高", () => {
    expect(readImageDimensions(makeJpeg(2048, 1536))).toEqual({
      height: 1536,
      width: 2048,
    });
  });

  it("从 WebP VP8X 段读出宽高", () => {
    expect(readImageDimensions(makeWebpVp8x(1920, 1080))).toEqual({
      height: 1080,
      width: 1920,
    });
  });

  it("从 GIF 头部读出宽高", () => {
    expect(readImageDimensions(makeGif(800, 600))).toEqual({
      height: 600,
      width: 800,
    });
  });

  it("无法识别时返回 null", () => {
    expect(readImageDimensions(Buffer.from("not an image"))).toBeNull();
  });
});

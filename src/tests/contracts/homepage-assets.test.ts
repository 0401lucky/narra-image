// @vitest-environment node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { HERO_SCENES } from "@/components/marketing/homepage/constants";
import { readImageDimensions } from "@/lib/generation/image-dimensions";

const assetPrefix = "/marketing/home/";
const fontFamilies = ["NarraHomeCormorant", "NarraHomeNotoSerifSC", "NarraHomeJakarta"];
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pngEnd = Buffer.from("0000000049454e44ae426082", "hex");

function readHomeAsset(url: string): Buffer {
  if (!/^\/marketing\/home\/(?:fonts\/)?[a-zA-Z0-9-]+\.(?:png|woff2|txt)$/.test(url)) {
    throw new Error(`Expected a local homepage asset path: ${url}`);
  }
  const workspace = realpathSync(process.cwd());
  const expectedRoot = path.resolve(workspace, "public/marketing/home");
  const root = realpathSync(expectedRoot);
  if (path.relative(expectedRoot, root) !== "") {
    throw new Error("Homepage public asset root must not redirect outside its workspace path");
  }
  const target = realpathSync(path.resolve(root, url.slice(assetPrefix.length)));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(`Homepage asset escaped its public root: ${url}`);
  }
  const stat = statSync(target);
  if (!stat.isFile() || stat.size === 0 || stat.size > 32 * 1024 * 1024) {
    throw new Error(`Expected a nonempty bounded homepage asset file: ${url}`);
  }
  return readFileSync(target);
}

function readFontFaces() {
  const css = readFileSync(path.resolve("src/components/marketing/homepage/fonts.css"), "utf8");
  const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((match) => match[1]);
  return { css, faces };
}

function includesCodePoint(face: string, point: number): boolean {
  const range = /unicode-range:\s*([^;]+);/.exec(face)?.[1] ?? "";
  return range.split(",").some((part) => {
    const match = /^\s*U\+([0-9A-F]+)(?:-([0-9A-F]+))?\s*$/i.exec(part);
    if (!match) return false;
    const start = parseInt(match[1], 16);
    const end = parseInt(match[2] ?? match[1], 16);
    return point >= start && point <= end;
  });
}

describe("fixed homepage illustration delivery", () => {
  it.each(HERO_SCENES)("ships the real local PNG for $id at its declared dimensions", (scene) => {
    const bytes = readHomeAsset(scene.image);
    expect(bytes.subarray(0, 8)).toEqual(pngSignature);
    expect(bytes.toString("ascii", 12, 16)).toBe("IHDR");
    expect(bytes.readUInt32BE(8)).toBe(13);
    expect(bytes.subarray(-12)).toEqual(pngEnd);
    expect(readImageDimensions(bytes)).toEqual({ width: scene.width, height: scene.height });
    expect(scene.width * 3).toBe(scene.height * 4);
    expect(scene.width).toBeGreaterThanOrEqual(1200);
    expect(scene.height).toBeGreaterThanOrEqual(900);
  });

  it("delivers three distinct versioned illustrations instead of one reused asset", () => {
    expect(HERO_SCENES.map((scene) => scene.id)).toEqual(["film", "storybook", "oriental"]);
    expect(HERO_SCENES.every((scene) => /-v\d+\.png$/.test(scene.image))).toBe(true);
    expect(new Set(HERO_SCENES.map((scene) => scene.image)).size).toBe(3);
    const digests = HERO_SCENES.map((scene) => createHash("sha256").update(readHomeAsset(scene.image)).digest("hex"));
    expect(new Set(digests).size).toBe(3);
  });

  it("does not publish the rejected rainy-lane candidate", () => {
    expect(existsSync(path.resolve("public/marketing/home/jiangnan-rain-v1.png"))).toBe(false);
  });

  it.each([
    "https://example.invalid/bookshop.png",
    "/marketing/home/../private.png",
    "/marketing/home/%2e%2e/private.png",
    "/marketing/home/bookshop-light-v1.png?key=not-a-real-key",
  ])("refuses out-of-scope asset reads: %s", (url) => {
    expect(() => readHomeAsset(url)).toThrow("Expected a local homepage asset path");
  });
});

describe("self-hosted homepage font delivery", () => {
  it("retains all three unique aliases, original face declarations, swap and Unicode shards", () => {
    const { css, faces } = readFontFaces();
    expect(css).not.toMatch(/@import|https?:\/\//i);
    expect(faces).toHaveLength(344);
    const counts: Record<string, number> = {};
    for (const face of faces) {
      const family = /font-family:\s*['"]([^'"]+)['"];/.exec(face)?.[1] ?? "";
      expect(fontFamilies).toContain(family);
      counts[family] = (counts[family] ?? 0) + 1;
      expect(face).toMatch(/font-style:\s*(?:normal|italic);/);
      expect(face).toMatch(/font-weight:\s*(?:400|500|600|700);/);
      expect(face).toMatch(/font-display:\s*swap;/);
      expect(face).toMatch(/unicode-range:\s*U\+/);
      expect(face).toMatch(/src:\s*url\(\/marketing\/home\/fonts\/[a-z0-9-]+\.woff2\)\s+format\(['"]woff2['"]\);/);
    }
    expect(counts).toEqual({ NarraHomeCormorant: 25, NarraHomeNotoSerifSC: 303, NarraHomeJakarta: 16 });
    const chineseFaces = faces.filter((face) => face.includes("'NarraHomeNotoSerifSC'"));
    for (const point of [0x53d9, 0x4e8b, 0x6027]) {
      expect(chineseFaces.some((face) => includesCodePoint(face, point))).toBe(true);
    }
  });

  it("resolves every declared URL to a complete local WOFF2 file", () => {
    const { css } = readFontFaces();
    const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1]);
    const uniqueUrls = new Set(urls);
    expect(urls).toHaveLength(344);
    expect(uniqueUrls.size).toBe(115);
    for (const url of uniqueUrls) {
      const bytes = readHomeAsset(url);
      expect(bytes.length, url).toBeGreaterThanOrEqual(48);
      expect(bytes.toString("ascii", 0, 4), url).toBe("wOF2");
      expect(bytes.readUInt32BE(8), url).toBe(bytes.length);
      expect(bytes.readUInt16BE(12), url).toBeGreaterThan(0);
    }
  });

  it.each(["cormorant-garamond", "noto-serif-sc", "plus-jakarta-sans"])("redistributes the full OFL notice for %s", (family) => {
    const notice = readHomeAsset(`${assetPrefix}fonts/${family}-OFL.txt`).toString("utf8");
    expect(notice).toMatch(/Copyright/i);
    expect(notice).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(notice).toContain("PERMISSION & CONDITIONS");
    expect(notice).toContain("TERMINATION");
    expect(notice).toContain("DISCLAIMER");
  });
});

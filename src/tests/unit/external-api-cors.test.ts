// @vitest-environment node

import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetEnv } = vi.hoisted(() => ({ mockGetEnv: vi.fn() }));

vi.mock("@/lib/env", () => ({ getEnv: mockGetEnv }));

import { isExternalApiPath } from "@/lib/external-api/cors";
import { config, proxy } from "@/proxy";

const origin = "https://canvas.example.test";
const publicPaths = [
  "/v1/models",
  "/v1/images/generations",
  "/v1/images/edits",
  "/v1/chat/completions",
  "/v1/chat/completion",
  "/v1/responses",
  "/v1/generations/job_1",
  "/models",
  "/images/generations",
  "/images/edits",
  "/chat/completions",
  "/chat/completion",
  "/responses",
];

beforeEach(() => {
  mockGetEnv.mockReset();
  mockGetEnv.mockImplementation(() => {
    throw new Error("公开 API 预检不能依赖运行环境或鉴权");
  });
});

describe("公开 API 跨域访问", () => {
  it.each(publicPaths)("%s 放行无 API Key 的浏览器预检", async (path) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path })).toBe(true);

    const response = proxy(new NextRequest(`https://api.example.test${path}`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": path.includes("models") ? "GET" : "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    }));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("authorization,content-type");
    expect(response.headers.get("Access-Control-Allow-Methods")?.split(/,\s*/))
      .toEqual(["GET", "HEAD", "POST", "OPTIONS"]);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("允许 SDK 的附加请求头，并标记预检响应的缓存差异", () => {
    const requestedHeaders = "authorization,content-type,openai-project,x-stainless-lang";
    const response = proxy(new NextRequest("https://api.example.test/v1/models", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": requestedHeaders,
      },
    }));

    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(requestedHeaders);
    expect(response.headers.get("Vary")).toContain("Access-Control-Request-Headers");
    expect(Number(response.headers.get("Access-Control-Max-Age"))).toBeGreaterThan(0);
  });

  it.each(["GET", "HEAD", "POST"])("%s 继续交给原路由处理，并附加响应跨域头", (method) => {
    const request = new NextRequest("https://api.example.test/v1/models", {
      method,
      headers: {
        Origin: origin,
        Authorization: "Bearer narra_sk_test",
        Cookie: "session=private-session",
      },
    });
    const response = proxy(request);

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(response.headers.get("Authorization")).toBeNull();
    expect(response.headers.get("Cookie")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(request.headers.get("Authorization")).toBe("Bearer narra_sk_test");
  });

  it.each([
    "/api/me",
    "/api/auth/login",
    "/api/admin/users",
    "/api/generate",
    "/api-keys",
    "/admin",
    "/works",
    "/v10/models",
    "/v1-admin",
    "/images/private",
  ])("%s 保留网站接口的跨域边界", (path) => {
    expect(isExternalApiPath(path)).toBe(false);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path })).toBe(false);
  });
});

describe("图片优化代理回归", () => {
  const token = "a".repeat(64);
  const publicImage = `https://api.example.test/media/images/${token}`;
  const request = () => new NextRequest(
    `http://next:3000/_next/image?url=${encodeURIComponent(publicImage)}&w=384&q=90`,
  );

  it("受管理图片继续使用内部地址，保留尺寸和质量参数", () => {
    mockGetEnv.mockReturnValue({ IMAGE_STORAGE_MANAGED_ENABLED: true, APP_URL: "https://api.example.test" });
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/_next/image" })).toBe(true);

    const response = proxy(request());
    const rewritten = new URL(response.headers.get("x-middleware-rewrite")!);
    expect(rewritten.searchParams.get("url")).toBe(`/media/images/${token}`);
    expect(rewritten.searchParams.get("w")).toBe("384");
    expect(rewritten.searchParams.get("q")).toBe("90");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("未启用受管理存储时继续使用原图片处理路径", () => {
    mockGetEnv.mockReturnValue({ IMAGE_STORAGE_MANAGED_ENABLED: false, APP_URL: "https://api.example.test" });
    const response = proxy(request());
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

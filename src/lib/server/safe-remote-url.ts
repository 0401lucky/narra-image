import "server-only";

import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

// 服务端请求不允许访问的地址段：私网、环回、链路本地、文档、基准测试、
// 组播、保留和可封装 IPv4 的隧道地址，避免它们绕过 SSRF 检查。
const BLOCKED_RANGES = new BlockList();
BLOCKED_RANGES.addSubnet("0.0.0.0", 8, "ipv4");
BLOCKED_RANGES.addSubnet("10.0.0.0", 8, "ipv4");
BLOCKED_RANGES.addSubnet("100.64.0.0", 10, "ipv4");
BLOCKED_RANGES.addSubnet("127.0.0.0", 8, "ipv4");
BLOCKED_RANGES.addSubnet("169.254.0.0", 16, "ipv4");
BLOCKED_RANGES.addSubnet("172.16.0.0", 12, "ipv4");
BLOCKED_RANGES.addSubnet("192.0.0.0", 24, "ipv4");
BLOCKED_RANGES.addSubnet("192.0.2.0", 24, "ipv4");
BLOCKED_RANGES.addSubnet("192.88.99.0", 24, "ipv4");
BLOCKED_RANGES.addSubnet("192.168.0.0", 16, "ipv4");
BLOCKED_RANGES.addSubnet("198.18.0.0", 15, "ipv4");
BLOCKED_RANGES.addSubnet("198.51.100.0", 24, "ipv4");
BLOCKED_RANGES.addSubnet("203.0.113.0", 24, "ipv4");
BLOCKED_RANGES.addSubnet("224.0.0.0", 4, "ipv4");
BLOCKED_RANGES.addSubnet("240.0.0.0", 4, "ipv4");
BLOCKED_RANGES.addAddress("::", "ipv6");
BLOCKED_RANGES.addAddress("::1", "ipv6");
BLOCKED_RANGES.addSubnet("64:ff9b::", 96, "ipv6");
BLOCKED_RANGES.addSubnet("64:ff9b:1::", 48, "ipv6");
BLOCKED_RANGES.addSubnet("100::", 64, "ipv6");
BLOCKED_RANGES.addSubnet("2001::", 23, "ipv6");
BLOCKED_RANGES.addSubnet("2001:db8::", 32, "ipv6");
BLOCKED_RANGES.addSubnet("2002::", 16, "ipv6");
BLOCKED_RANGES.addSubnet("3fff::", 20, "ipv6");
BLOCKED_RANGES.addSubnet("fc00::", 7, "ipv6");
BLOCKED_RANGES.addSubnet("fe80::", 10, "ipv6");
BLOCKED_RANGES.addSubnet("ff00::", 8, "ipv6");

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) {
    return true; // 非法地址一律视为不安全
  }

  // BlockList 会自动把 IPv4-mapped IPv6（点分或十六进制书写）匹配到 IPv4 规则
  return BLOCKED_RANGES.check(address, family === 6 ? "ipv6" : "ipv4");
}

function isLocalHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || normalized.endsWith(".home.arpa");
}

export type SafeRemoteUrlOptions = {
  /** 测试注入用；默认走 DNS 解析返回全部地址 */
  lookupAddresses?: (hostname: string) => Promise<string[]>;
};

async function defaultLookupAddresses(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
}

async function resolvePublicHttpUrl(
  raw: string,
  options: SafeRemoteUrlOptions = {},
) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("图片地址无效");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("仅支持 http/https 图片地址");
  }

  if (url.username || url.password) {
    throw new Error("图片地址不允许携带凭据");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname || isLocalHostname(hostname)) {
    throw new Error("不允许访问内网地址");
  }

  let addresses: string[];
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = await (options.lookupAddresses ?? defaultLookupAddresses)(hostname);
    } catch {
      throw new Error("图片地址解析失败");
    }
  }

  if (addresses.length === 0 || addresses.some((address) => isPrivateAddress(address))) {
    throw new Error("不允许访问内网地址");
  }

  return { addresses, hostname, url };
}

/**
 * 校验 URL 是否为可安全代理的公网 http(s) 地址（防 SSRF）：
 * 仅允许 http/https、禁止内嵌凭据，域名解析后任一结果命中私网段即拒绝。
 */
export async function assertPublicHttpUrl(
  raw: string,
  options: SafeRemoteUrlOptions = {},
): Promise<URL> {
  return (await resolvePublicHttpUrl(raw, options)).url;
}

export type PublicHttpFetchOptions = SafeRemoteUrlOptions & {
  headers?: HeadersInit;
  signal?: AbortSignal;
};

/**
 * 使用已经校验过的公网 IP 建立连接，避免校验后再次 DNS 解析造成重绑定。
 * 当前安全代理场景只需要 GET，并且明确拒绝所有重定向。
 */
export async function fetchPublicHttpUrl(
  raw: string,
  options: PublicHttpFetchOptions = {},
): Promise<Response> {
  const { addresses, hostname, url } = await resolvePublicHttpUrl(raw, options);
  const headers = new Headers(options.headers);
  headers.set("Host", url.host);

  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)({
      headers: Object.fromEntries(headers.entries()),
      hostname: addresses[0],
      method: "GET",
      path: `${url.pathname}${url.search}`,
      port: url.port || undefined,
      servername: isIP(hostname) ? undefined : hostname,
      signal: options.signal,
    }, (upstream) => {
      const status = upstream.statusCode ?? 502;
      if (status >= 300 && status < 400) {
        upstream.resume();
        reject(new Error("远程地址不允许重定向"));
        return;
      }

      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(upstream.headers)) {
        if (Array.isArray(value)) {
          value.forEach((item) => responseHeaders.append(name, item));
        } else if (value !== undefined) {
          responseHeaders.set(name, value);
        }
      }

      const body = status === 204 || status === 205
        ? null
        : Readable.toWeb(upstream) as ReadableStream<Uint8Array>;
      resolve(new Response(body, { headers: responseHeaders, status }));
    });

    request.on("error", reject);
    request.end();
  });
}

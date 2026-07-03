import "server-only";

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

// 服务端代理不允许访问的地址段：私网、环回、链路本地（含云元数据 169.254.169.254）、
// CGNAT、未指定地址，以及 IPv6 的对应段。
const PRIVATE_RANGES = new BlockList();
PRIVATE_RANGES.addSubnet("0.0.0.0", 8, "ipv4");
PRIVATE_RANGES.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE_RANGES.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE_RANGES.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE_RANGES.addSubnet("169.254.0.0", 16, "ipv4");
PRIVATE_RANGES.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE_RANGES.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE_RANGES.addAddress("::", "ipv6");
PRIVATE_RANGES.addAddress("::1", "ipv6");
PRIVATE_RANGES.addSubnet("fc00::", 7, "ipv6");
PRIVATE_RANGES.addSubnet("fe80::", 10, "ipv6");

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) {
    return true; // 非法地址一律视为不安全
  }

  // BlockList 会自动把 IPv4-mapped IPv6（点分或十六进制书写）匹配到 IPv4 规则
  return PRIVATE_RANGES.check(address, family === 6 ? "ipv6" : "ipv4");
}

export type SafeRemoteUrlOptions = {
  /** 测试注入用；默认走 DNS 解析返回全部地址 */
  lookupAddresses?: (hostname: string) => Promise<string[]>;
};

async function defaultLookupAddresses(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
}

/**
 * 校验 URL 是否为可安全代理的公网 http(s) 地址（防 SSRF）：
 * 仅允许 http/https、禁止内嵌凭据，域名解析后任一结果命中私网段即拒绝。
 */
export async function assertPublicHttpUrl(
  raw: string,
  options: SafeRemoteUrlOptions = {},
): Promise<URL> {
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

  // IPv6 字面量在 URL.hostname 里带方括号
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

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

  return url;
}

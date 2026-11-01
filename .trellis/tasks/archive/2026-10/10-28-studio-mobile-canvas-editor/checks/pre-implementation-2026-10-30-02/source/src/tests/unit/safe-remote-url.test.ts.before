import {
  assertPublicHttpUrl,
  fetchPublicHttpUrl,
  isPrivateAddress,
} from "@/lib/server/safe-remote-url";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
  ])("拦截非公网 IPv4：%s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "93.184.216.34"])(
    "放行公网 IPv4：%s",
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );

  it.each([
    "::1",
    "0:0:0:0:0:0:0:1", // 全写环回，不能只做字符串比较
    "::",
    "fe80::1",
    "FE80::abcd",
    "fd00::1",
    "fc00::1234",
    "::ffff:127.0.0.1", // IPv4-mapped 点分书写
    "::ffff:7f00:1", // IPv4-mapped 十六进制书写
    "64:ff9b::a00:1", // NAT64 可映射到私网 IPv4
    "100::1",
    "2001::1",
    "2001:db8::1",
    "2002:a00:1::1", // 6to4 可封装私网 IPv4
    "3fff::1",
    "ff02::1",
  ])("拦截非公网 IPv6：%s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888"])(
    "放行公网 IPv6：%s",
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );

  it("非法地址一律视为不安全", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
  });
});

describe("fetchPublicHttpUrl", () => {
  it("连接前拒绝解析到私网的地址", async () => {
    await expect(
      fetchPublicHttpUrl("http://rebind.example.com/image.png", {
        lookupAddresses: async () => ["127.0.0.1"],
      }),
    ).rejects.toThrow("不允许访问内网地址");
  });
});

describe("assertPublicHttpUrl", () => {
  const publicLookup = async () => ["93.184.216.34"];

  it("放行解析到公网地址的 https URL", async () => {
    const url = await assertPublicHttpUrl("https://storage.example.com/a.png", {
      lookupAddresses: publicLookup,
    });
    expect(url.hostname).toBe("storage.example.com");
  });

  it("拒绝非 http/https 协议", async () => {
    await expect(
      assertPublicHttpUrl("file:///etc/passwd", { lookupAddresses: publicLookup }),
    ).rejects.toThrow("仅支持 http/https");
  });

  it("拒绝携带凭据的 URL", async () => {
    await expect(
      assertPublicHttpUrl("https://user:pass@example.com/a.png", {
        lookupAddresses: publicLookup,
      }),
    ).rejects.toThrow("不允许携带凭据");
  });

  it("拒绝私网 IP 字面量", async () => {
    await expect(
      assertPublicHttpUrl("http://127.0.0.1:8080/admin", { lookupAddresses: publicLookup }),
    ).rejects.toThrow("不允许访问内网地址");
    await expect(
      assertPublicHttpUrl("http://169.254.169.254/latest/meta-data/", {
        lookupAddresses: publicLookup,
      }),
    ).rejects.toThrow("不允许访问内网地址");
    await expect(
      assertPublicHttpUrl("http://[::1]/", { lookupAddresses: publicLookup }),
    ).rejects.toThrow("不允许访问内网地址");
  });

  it("拒绝解析到私网地址的域名", async () => {
    await expect(
      assertPublicHttpUrl("https://internal.corp/x.png", {
        lookupAddresses: async () => ["10.0.0.5"],
      }),
    ).rejects.toThrow("不允许访问内网地址");
  });

  it.each(["localhost", "service.local", "api.internal", "router.home.arpa"])(
    "拒绝本地域名：%s",
    async (hostname) => {
      await expect(
        assertPublicHttpUrl(`http://${hostname}/x.png`, {
          lookupAddresses: publicLookup,
        }),
      ).rejects.toThrow("不允许访问内网地址");
    },
  );

  it("域名解析结果只要有一个私网地址就拒绝", async () => {
    await expect(
      assertPublicHttpUrl("https://tricky.example.com/x.png", {
        lookupAddresses: async () => ["93.184.216.34", "192.168.0.10"],
      }),
    ).rejects.toThrow("不允许访问内网地址");
  });

  it("解析失败时给出明确错误", async () => {
    await expect(
      assertPublicHttpUrl("https://no-such-host.example/x.png", {
        lookupAddresses: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    ).rejects.toThrow("图片地址解析失败");
  });

  it("拒绝无法解析出任何地址的域名", async () => {
    await expect(
      assertPublicHttpUrl("https://empty.example/x.png", {
        lookupAddresses: async () => [],
      }),
    ).rejects.toThrow("不允许访问内网地址");
  });
});

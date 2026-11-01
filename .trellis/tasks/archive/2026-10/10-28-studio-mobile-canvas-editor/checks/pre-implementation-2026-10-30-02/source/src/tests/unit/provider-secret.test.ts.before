import {
  decryptProviderSecret,
  encryptProviderSecret,
} from "@/lib/providers/provider-secret";

describe("自填渠道密钥加解密", () => {
  it("能正确加密并解密 apiKey", async () => {
    const encrypted = await encryptProviderSecret(
      "custom-key",
      "my-auth-secret",
    );

    const decrypted = await decryptProviderSecret(
      encrypted,
      "my-auth-secret",
    );

    expect(decrypted).toBe("custom-key");
  });
});

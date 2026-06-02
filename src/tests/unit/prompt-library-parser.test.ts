import { parseRemotePrompts } from "@/lib/prompts/parser";

describe("提示词库 GitHub 解析器", () => {
  it("解析中文 Markdown 案例并提取标题、提示词、标签和预览图", async () => {
    const items = await parseRemotePrompts(
      {
        parser: "awesome-gpt-image",
        rawBaseUrl: "https://raw.githubusercontent.com/example/repo/main",
        slug: "awesome-gpt-image",
      },
      async () => `
## 🧃 产品/海报

### [蓝莓苏打海报](https://example.com/case)

![](assets/blueberry.jpg)

**提示词:**

\`\`\`
复古蓝莓薰衣草苏打海报，手帐拼贴，柔和自然光。
\`\`\`
`,
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      coverUrl: "https://raw.githubusercontent.com/example/repo/main/assets/blueberry.jpg",
      prompt: "复古蓝莓薰衣草苏打海报，手帐拼贴，柔和自然光。",
      tags: ["产品", "海报"],
      title: "蓝莓苏打海报",
    });
  });

  it("解析 JSON 数据源并标记需要参考图的提示词", async () => {
    const items = await parseRemotePrompts(
      {
        parser: "davidwu-gpt-image2-prompts",
        rawBaseUrl: "https://raw.githubusercontent.com/example/json-prompts/main",
        slug: "davidwu-gpt-image2-prompts",
      },
      async () => JSON.stringify([
        {
          author: "OpenLab",
          category: "Poster",
          category_cn: "海报",
          id: 7,
          image: "images/poster.png",
          needs_ref: true,
          note: "适合商业视觉",
          prompt: "高级香氛海报，中心构图，微距产品摄影。",
          source: "github",
          title_cn: "香氛海报",
          title_en: "Fragrance poster",
        },
      ]),
    );

    expect(items[0]).toMatchObject({
      coverUrl: "https://raw.githubusercontent.com/example/json-prompts/main/images/poster.png",
      remoteId: "davidwu-gpt-image2-prompts-007",
      tags: ["海报", "poster", "openlab", "github", "需要参考图"],
      title: "香氛海报",
    });
    expect(items[0]?.preview).toContain("Fragrance poster");
  });
});

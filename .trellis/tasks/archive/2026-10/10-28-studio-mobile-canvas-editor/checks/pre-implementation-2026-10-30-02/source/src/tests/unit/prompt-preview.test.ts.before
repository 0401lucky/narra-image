import { buildPromptClipboardText, buildPromptPreview } from "@/lib/prompt-preview";

describe("提示词摘要", () => {
  it("长提示词会被压缩成首屏可读摘要", () => {
    const prompt =
      "场景：背景为色调偏中性且模糊的昏暗房间，人物是年轻的韩系美女，冷白色的皮肤，头发半遮面，穿着浅色上衣，手机闪光灯自拍效果，眼下和下巴有深色阴影，整体是柔光人像与杂志封面风格。";

    expect(buildPromptPreview(prompt, 40)).toBe(
      "场景：背景为色调偏中性且模糊的昏暗房间，人物是年轻的韩系美女，冷白色的皮肤，头发..."
    );
  });

  it("复制内容会把主提示词和负向提示词一起整理好", () => {
    expect(buildPromptClipboardText("主提示词内容", "不要过曝")).toBe(
      "主提示词:\n主提示词内容\n\n负向提示词:\n不要过曝"
    );
  });
});

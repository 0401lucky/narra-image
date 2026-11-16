import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GenerationBubble } from "@/components/create/parts/generation-bubble";

import { conversationGeneration } from "./helpers/conversation-fixtures";

describe("conversation image cleanup", () => {
  it.each(["cleaned", "unavailable"] as const)("keeps a %s result and its prompt while blocking file actions", async (availability) => {
    const user = userEvent.setup();
    const generation = conversationGeneration("retained_job", "conversation_a", {
      prompt: "保留原始提示词", durationMs: 5000,
      images: [{ id: "retained_image", url: "https://media.invalid/retained.png", availability, actualWidth: 1024, actualHeight: 1024, actualSize: "1024x1024" }],
    });
    const callbacks = { onZoom: vi.fn(), onDownload: vi.fn(), onUseForEdit: vi.fn(), onReuseConfig: vi.fn(), onRetry: vi.fn() };
    render(<GenerationBubble generation={generation} {...callbacks} />);

    expect(screen.getByText(availability === "cleaned" ? "图片已清理" : "图片暂不可用")).toBeInTheDocument();
    expect(screen.getByText(generation.prompt)).toBeInTheDocument();
    expect(screen.getByText("结果 1")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText(/生成失败/)).not.toBeInTheDocument();
    for (const name of ["加入编辑", "放大查看", "下载保存"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      await user.click(button);
    }
    await user.click(screen.getByRole("button", { name: "复用配置" }));
    expect(callbacks.onReuseConfig).toHaveBeenCalledWith(generation);
    expect(callbacks.onZoom).not.toHaveBeenCalled();
    expect(callbacks.onDownload).not.toHaveBeenCalled();
    expect(callbacks.onUseForEdit).not.toHaveBeenCalled();
    expect(callbacks.onRetry).not.toHaveBeenCalled();
    expect(generation).toMatchObject({ status: "succeeded", creditsSpent: 5, prompt: "保留原始提示词" });
  });
});

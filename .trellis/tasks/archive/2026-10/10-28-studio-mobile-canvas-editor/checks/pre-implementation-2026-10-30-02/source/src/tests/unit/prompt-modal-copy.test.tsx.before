import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PromptModal } from "@/components/works/prompt-modal";

function setClipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
    writable: true,
  });
}

describe("提示词弹窗", () => {
  it("支持复制完整提示词", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);

    setClipboard(writeText);

    render(
      <PromptModal
        negativePrompt="不要过曝"
        onClose={vi.fn()}
        prompt="主提示词内容"
      />,
    );

    await user.click(screen.getByRole("button", { name: "复制提示词" }));

    expect(writeText).toHaveBeenCalledWith(
      "主提示词:\n主提示词内容\n\n负向提示词:\n不要过曝",
    );
    expect(await screen.findByText("提示词已复制")).toBeInTheDocument();
  });
});

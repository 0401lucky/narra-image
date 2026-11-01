import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkShareButton } from "@/components/works/work-share-button";

function setNavigatorShare(share?: ((data?: ShareData) => Promise<void>) | undefined) {
  Object.defineProperty(window.navigator, "share", {
    configurable: true,
    value: share,
    writable: true,
  });
}

function setClipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
    writable: true,
  });
}

describe("作品分享按钮", () => {
  it("支持原生分享时优先调用 navigator.share", async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);

    setNavigatorShare(share);
    setClipboard(writeText);

    render(<WorkShareButton url="https://example.com/works/work_1" />);

    await user.click(screen.getByRole("button", { name: "分享作品" }));

    expect(share).toHaveBeenCalledWith({
      text: "来看看这张作品",
      title: "Narra Image 作品",
      url: "https://example.com/works/work_1",
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("原生分享失败时回退为复制链接", async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockRejectedValue(new Error("share failed"));
    const writeText = vi.fn().mockResolvedValue(undefined);

    setNavigatorShare(share);
    setClipboard(writeText);

    render(<WorkShareButton url="https://example.com/works/work_2" />);

    await user.click(screen.getByRole("button", { name: "分享作品" }));

    expect(writeText).toHaveBeenCalledWith("https://example.com/works/work_2");
    expect(await screen.findByText("链接已复制，可直接发送给朋友")).toBeInTheDocument();
  });
});

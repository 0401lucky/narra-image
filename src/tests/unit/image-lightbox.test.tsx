import { render, screen } from "@testing-library/react";

import { ImageLightbox } from "@/components/works/image-lightbox";
import { getThumbUrl } from "@/lib/image-url";

describe("作品图片弹窗", () => {
  it("使用站内优化地址展示远程原图，避免浏览器直连原图失败", () => {
    render(
      <ImageLightbox
        onClose={vi.fn()}
        src="http://image.example.com/work.png"
      />,
    );

    expect(screen.getByAltText("作品大图")).toHaveAttribute(
      "src",
      getThumbUrl("http://image.example.com/work.png", 1920, 90),
    );
  });
});

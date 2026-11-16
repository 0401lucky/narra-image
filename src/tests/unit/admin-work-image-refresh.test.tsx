import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("motion/react", () => ({ motion: { div: ({ children }: { children?: ReactNode }) => <div>{children}</div> } }));

import { AdminWorksBoard } from "@/components/admin/admin-works-board";
import { serializeAdminWork } from "@/lib/prisma-mappers";
import { createPrivacyWork } from "./helpers/work-privacy-fixtures";

describe("admin image viewer follows current media presentation", () => {
  it("refreshes an already-open viewer when an available historical image gains a managed URL", async () => {
    const user = userEvent.setup();
    const original = serializeAdminWork(createPrivacyWork());
    const publicUrl = `https://app.history.invalid/media/images/${"b".repeat(64)}`;
    const { rerender } = render(<AdminWorksBoard works={[original]} />);
    await user.click(screen.getByRole("button", { name: "作品缩略图" }));
    await screen.findByRole("img", { name: "作品大图" });
    rerender(<AdminWorksBoard works={[{ ...original, url: publicUrl }]} />);
    for (const image of screen.getAllByRole("img")) {
      expect(new URL(image.getAttribute("src")!, "https://admin.unit.invalid").searchParams.get("url")).toBe(publicUrl);
    }
    expect(original.url).not.toBe(publicUrl);
  });

  it.each(["cleaned", "removed"])("does not keep an old viewer after the image is %s", async (change) => {
    const user = userEvent.setup();
    const original = serializeAdminWork(createPrivacyWork());
    const { rerender } = render(<AdminWorksBoard works={[original]} />);
    await user.click(screen.getByRole("button", { name: "作品缩略图" }));
    await screen.findByRole("img", { name: "作品大图" });
    rerender(<AdminWorksBoard works={change === "removed" ? [] : [{ ...original, availability: "cleaned", url: "" }]} />);
    expect(screen.queryByRole("img", { name: "作品大图" })).not.toBeInTheDocument();
  });
});

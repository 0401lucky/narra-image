import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { LoginCoverForm } from "@/components/admin/login-cover-form";

const rawUrl = "https://old-r2.unit.invalid/cover.png";
const publicUrl = `https://app.unit.invalid/media/images/${"b".repeat(64)}`;
afterEach(() => { vi.unstubAllGlobals(); });

describe("cover editing preserves the configured source", () => {
  it("previews the managed URL and saves the original configured value", async () => {
    const request = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", request);
    render(<LoginCoverForm initialConfig={{ mode: "custom", customUrl: rawUrl }} resolvedCustomUrl={publicUrl} />);
    expect(screen.getByRole("textbox")).toHaveValue(rawUrl);
    expect(screen.getByRole("img", { name: "封面预览" })).toHaveAttribute("src", publicUrl);
    await userEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/admin/login-cover", expect.objectContaining({
      body: JSON.stringify({ mode: "custom", customUrl: rawUrl }),
    })));
  });

  it("does not preview an unavailable saved image and still permits an explicit replacement", async () => {
    render(<LoginCoverForm initialConfig={{ mode: "custom", customUrl: rawUrl }} resolvedCustomUrl={null} />);
    expect(screen.queryByRole("img", { name: "封面预览" })).toBeNull();
    const user = userEvent.setup();
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "https://external.unit.invalid/replacement.png");
    expect(screen.getByRole("img", { name: "封面预览" })).toHaveAttribute("src", "https://external.unit.invalid/replacement.png");
  });
});

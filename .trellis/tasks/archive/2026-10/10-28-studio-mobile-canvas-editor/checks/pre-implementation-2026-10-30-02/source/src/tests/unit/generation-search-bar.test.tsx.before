import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GenerationSearchBar } from "@/components/admin/generation-search-bar";

const { mockPush } = vi.hoisted(() => ({
  mockPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

describe("后台生成记录搜索栏", () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it("提交搜索时保留当前视图并重置到第一页", async () => {
    const user = userEvent.setup();
    render(<GenerationSearchBar initialValue="" view="list" />);

    await user.type(
      screen.getByPlaceholderText("搜索用户昵称、邮箱、任务 ID、提示词或模型…"),
      "alice@example.com",
    );
    await user.click(screen.getByRole("button", { name: "搜索" }));

    expect(mockPush).toHaveBeenCalledWith(
      "/admin/generations?view=list&q=alice%40example.com",
    );
  });

  it("清空搜索时保留当前视图", async () => {
    const user = userEvent.setup();
    render(<GenerationSearchBar initialValue="alice" view="card" />);

    await user.click(screen.getByRole("button", { name: "清空搜索" }));

    expect(mockPush).toHaveBeenCalledWith("/admin/generations?view=card");
  });
});

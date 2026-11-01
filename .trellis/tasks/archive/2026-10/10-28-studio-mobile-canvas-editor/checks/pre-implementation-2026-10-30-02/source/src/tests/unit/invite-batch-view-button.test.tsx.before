import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InviteBatchViewButton } from "@/components/admin/admin-actions";

const { mockRefresh } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

describe("邀请码批次详情弹窗", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockRefresh.mockReset();
  });

  it("兼容后台 jsonOk 返回的 data.codes，并按可用/已发放/已使用分组", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          codes: [
            {
              claimedAt: null,
              code: "OPEN-001",
              id: "invite_1",
              usedAt: null,
              usedBy: null,
            },
            {
              claimedAt: "2026-05-24T01:00:00.000Z",
              code: "CLAIMED-002",
              id: "invite_2",
              usedAt: null,
              usedBy: null,
            },
            {
              claimedAt: "2026-05-24T01:00:00.000Z",
              code: "USED-003",
              id: "invite_3",
              usedAt: "2026-05-24T02:00:00.000Z",
              usedBy: { email: "user@example.com" },
            },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<InviteBatchViewButton batchId="batch_1" title="Ld士多" />);
    await userEvent.click(screen.getByRole("button", { name: "查看" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/invites/batches/batch_1", {
      credentials: "same-origin",
    });
    expect(await screen.findByText("OPEN-001")).toBeInTheDocument();
    expect(screen.getByText("CLAIMED-002")).toBeInTheDocument();
    expect(screen.getByText("USED-003")).toBeInTheDocument();
    expect(screen.getByText("可用邀请码 (1)")).toBeInTheDocument();
    expect(screen.getByText("已发放 / 已使用邀请码 (2)")).toBeInTheDocument();
    expect(screen.getByText("等待注册")).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
  });

  it("接口失败时展示后端返回的具体错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "批次不存在" }, { status: 404 })),
    );

    render(<InviteBatchViewButton batchId="missing_batch" title="失效批次" />);
    await userEvent.click(screen.getByRole("button", { name: "查看" }));

    expect(await screen.findByText("批次不存在")).toBeInTheDocument();
  });
});

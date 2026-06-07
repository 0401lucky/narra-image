import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

import { ChannelManager } from "@/components/admin/channel-manager";

describe("ChannelManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          data: {
            models: [{ id: "qwen-image", imageLikely: true }],
          },
        }),
        ok: true,
      })),
    );
  });

  it("编辑渠道时用弹窗展示，并用已保存渠道 id 拉取模型", async () => {
    const user = userEvent.setup();

    render(
      <ChannelManager
        initialChannels={[
          {
            apiKeyConfigured: true,
            baseUrl: "https://provider.example.com/v1",
            creditCost: 5,
            defaultModel: "qwen-image",
            id: "channel_1",
            isActive: true,
            models: ["qwen-image"],
            name: "主渠道",
            slug: "main-channel",
            sortOrder: 0,
            videoCreditCost: 20,
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "编辑 主渠道" }));

    const dialog = screen.getByRole("dialog", { name: "编辑渠道: 主渠道" });
    expect(dialog.parentElement?.parentElement).toBe(document.body);

    await user.click(screen.getByRole("button", { name: "拉取" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/provider-models/probe",
        expect.objectContaining({
          body: JSON.stringify({
            apiKey: null,
            baseUrl: "https://provider.example.com/v1",
            channelId: "channel_1",
          }),
        }),
      );
    });
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const { mockPush } = vi.hoisted(() => ({
  mockPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/moderation",
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}));

import { AdminFrame } from "@/components/admin/admin-frame";
import {
  ADMIN_NAV_GROUPS,
  isAdminNavItemActive,
  resolveAdminBreadcrumb,
} from "@/components/admin/constants";
import { useAdminToast } from "@/components/admin/hooks/use-admin-toast";
import { AdminCommandPalette } from "@/components/admin/ui/admin-command-palette";
import { AdminConfirmDialog } from "@/components/admin/ui/admin-modal";
import { AdminSwitch } from "@/components/admin/ui/admin-switch";
import { AdminTabs } from "@/components/admin/ui/admin-tabs";
import { AdminToastProvider } from "@/components/admin/ui/admin-toast-provider";

function ToastTriggerHarness() {
  const toast = useAdminToast();
  return (
    <button
      type="button"
      onClick={() => toast.success("配置已保存", "新的限制已生效")}
    >
      触发通知
    </button>
  );
}

describe("后台基础 UI 原语与路由契约", () => {
  it("准确解析全部关键后台路由的多级面包屑（修复 /admin/moderation 与设置子页）", () => {
    expect(resolveAdminBreadcrumb("/admin").title).toBe("控制台概览");
    expect(resolveAdminBreadcrumb("/admin/moderation")).toMatchObject({
      sectionCode: "MODERATION",
      title: "内容风控与拦截记录",
    });
    expect(resolveAdminBreadcrumb("/admin/settings/moderation")).toMatchObject({
      sectionCode: "MODERATION / RULES",
      title: "内容审核规则与词库",
    });
    expect(resolveAdminBreadcrumb("/admin/settings/storage").items.map((i) => i.label)).toEqual([
      "管理台",
      "系统设置",
      "图片存储",
    ]);
    expect(resolveAdminBreadcrumb("/admin/api").title).toBe("开放 API 密钥与速率限制");
  });

  it("区分独立提升的生图渠道与其余系统设置子页的高亮归属", () => {
    const allItems = ADMIN_NAV_GROUPS.flatMap((g) => g.items);
    const channelItem = allItems.find((i) => i.href === "/admin/settings/channels")!;
    const settingsItem = allItems.find((i) => i.href === "/admin/settings")!;
    const moderationItem = allItems.find((i) => i.href === "/admin/moderation")!;

    expect(isAdminNavItemActive(channelItem, "/admin/settings/channels")).toBe(true);
    expect(isAdminNavItemActive(settingsItem, "/admin/settings/channels")).toBe(false);
    expect(isAdminNavItemActive(settingsItem, "/admin/settings/storage")).toBe(true);
    expect(isAdminNavItemActive(moderationItem, "/admin/settings/moderation")).toBe(true);
  });

  it("通过 Portal 挂载确认弹窗并支持 Escape 关闭", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(
      <div style={{ backdropFilter: "blur(20px)" }}>
        <AdminConfirmDialog
          open
          onClose={onClose}
          onConfirm={onConfirm}
          title="危险操作确认"
          description="确认后不可撤销"
          confirmLabel="确认执行"
        />
      </div>,
    );

    const dialog = screen.getByRole("dialog", { name: "危险操作确认" });
    expect(dialog.parentElement?.parentElement).toBe(document.body);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "确认执行" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("支持标准 role=switch 开关切换与全局 Toast 通知", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(
      <AdminToastProvider>
        <AdminSwitch
          label="自动审核开关"
          checked={false}
          onCheckedChange={onCheckedChange}
        />
        <ToastTriggerHarness />
      </AdminToastProvider>,
    );

    await user.click(screen.getByRole("switch", { name: "自动审核开关" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole("button", { name: "触发通知" }));
    expect(await screen.findByText("配置已保存")).toBeInTheDocument();
    expect(screen.getByText("新的限制已生效")).toBeInTheDocument();
  });

  it("支持快捷指令面板关键词检索并回车跳转", async () => {
    const user = userEvent.setup();
    mockPush.mockReset();
    const onOpenChange = vi.fn();

    render(<AdminCommandPalette open onOpenChange={onOpenChange} />);

    const input = await screen.findByPlaceholderText(/输入模块名称或关键词快速跳转/);
    await user.type(input, "渠道{Enter}");

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/admin/settings/channels");
    });
  });

  it("采用温暖浅色侧边栏与白底浮起滑块 Segmented Control", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();

    render(
      <AdminFrame
        currentUser={{ avatarUrl: null, id: "admin_u12345678", nickname: "lucky" }}
      >
        <AdminTabs
          ariaLabel="趋势指标切换"
          layoutId="test-trend-tabs"
          value="generations"
          onChange={onTabChange}
          options={[
            { label: "生成任务量", value: "generations" },
            { label: "积分消耗量", value: "credits" },
          ]}
        />
      </AdminFrame>,
    );

    const activeNav = screen.getByRole("link", { name: "内容风控" });
    expect(activeNav).toHaveAttribute("aria-current", "page");

    const activeTab = screen.getByRole("tab", { name: "生成任务量" });
    expect(activeTab).toHaveAttribute("aria-selected", "true");
    expect(activeTab.className).toContain("text-[#292524]");

    await user.click(screen.getByRole("tab", { name: "积分消耗量" }));
    expect(onTabChange).toHaveBeenCalledWith("credits");
  });
});

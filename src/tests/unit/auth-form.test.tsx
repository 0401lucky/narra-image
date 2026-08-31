import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AuthForm } from "@/components/marketing/auth-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe("注册表单", () => {
  it("支持预填邀请码，方便公开领取后直接注册", () => {
    render(<AuthForm mode="register" initialInviteCode="ABCD1234" />);

    expect(screen.getByDisplayValue("ABCD1234")).toBeInTheDocument();
  });

  it("注册模式展示第三方登录入口，授权链接携带邀请码", () => {
    render(
      <AuthForm
        mode="register"
        initialInviteCode="ABCD1234"
        oauthProviders={[{ displayName: "LinuxDo", type: "linuxdo" }]}
      />,
    );

    expect(screen.getByText("或使用第三方登录")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /使用 LinuxDo 登录/ });
    expect(link).toHaveAttribute(
      "href",
      "/api/auth/oauth/linuxdo?inviteCode=ABCD1234",
    );
  });

  it("登录模式更新折叠邀请码后授权链接同步携带", async () => {
    const user = userEvent.setup();
    render(
      <AuthForm
        mode="login"
        oauthProviders={[{ displayName: "LinuxDo", type: "linuxdo" }]}
      />,
    );

    await user.click(screen.getByText(/需要邀请码？/));
    const input = screen.getByPlaceholderText("请输入邀请码");
    await user.type(input, "invite-1");

    const link = screen.getByRole("link", { name: /使用 LinuxDo 登录/ });
    expect(link).toHaveAttribute(
      "href",
      "/api/auth/oauth/linuxdo?inviteCode=invite-1",
    );
  });
});

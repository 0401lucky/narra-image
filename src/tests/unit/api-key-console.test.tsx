import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiKeyConsole } from "@/components/api/api-key-console";

describe("API 控制台", () => {
  it("调用示例使用 OpenAI 兼容 Base URL", () => {
    render(
      <ApiKeyConsole
        apiBaseUrl="https://narra.example.com"
        apiConfig={{
          isEnabled: true,
          requestsPerDay: 500,
          requestsPerMinute: 20,
        }}
        apiKeys={[]}
      />,
    );

    expect(screen.getByText("https://narra.example.com/v1")).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/narra\.example\.com\/v1\/images\/generations/))
      .toBeInTheDocument();
    expect(screen.getByText(/https:\/\/narra\.example\.com\/v1\/images\/edits/))
      .toBeInTheDocument();
    expect(screen.getByText(/https:\/\/narra\.example\.com\/v1\/responses/))
      .toBeInTheDocument();
    expect(screen.getByText(/"tools":\[\{"type":"image_generation"\}\]/))
      .toBeInTheDocument();
    expect(screen.getByText(/https:\/\/narra\.example\.com\/v1\/chat\/completions/))
      .toBeInTheDocument();
    expect(screen.getByText("文生图")).toBeInTheDocument();
    expect(screen.getByText("图生图")).toBeInTheDocument();
    expect(screen.getByText("Responses")).toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.queryByText(/your-domain/)).not.toBeInTheDocument();
  });

  it("调用示例提供可复制内容", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <ApiKeyConsole
        apiBaseUrl="https://narra.example.com"
        apiConfig={{
          isEnabled: true,
          requestsPerDay: 500,
          requestsPerMinute: 20,
        }}
        apiKeys={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "复制地址" }));
    expect(writeText).toHaveBeenCalledWith("https://narra.example.com/v1");

    await user.click(screen.getAllByRole("button", { name: "复制" })[2]);
    expect(writeText).toHaveBeenLastCalledWith(
      expect.stringContaining("https://narra.example.com/v1/responses"),
    );
  });
});

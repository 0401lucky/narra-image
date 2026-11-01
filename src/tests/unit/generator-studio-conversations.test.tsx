import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";

import { GeneratorStudio } from "@/components/create/generator-studio";
import type { ConversationGenerationsPage } from "@/lib/conversations/contracts";
import { conversationGeneration as generation, conversationPage as page } from "./helpers/conversation-fixtures";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type PendingRequest = { url: string; options?: RequestInit; reply: ReturnType<typeof deferred<Response>> };
let requests: PendingRequest[];
let preferences: Map<string, string>;
const ownerId = "owner_fixture";
const summary = (id: string, title: string, generationCount: number) => ({ id, title, generationCount, generationIds: [], createdAt: "2026-10-01T00:00:00.000Z" });
const baseProps: ComponentProps<typeof GeneratorStudio> = {
  ownerId,
  currentUser: { credits: 500, role: "user" },
  checkInSummary: { checkedInToday: false, checkInReward: 50 },
  initialConversations: [summary("conversation_a", "Recent chat", 150), summary("conversation_b", "Old chat", 50_000)],
  initialGenerationPage: page([generation("recent_a")], "older_a"),
};

function navigation() {
  return screen.getByRole("complementary", { name: "对话导航" });
}

async function finish(index: number, data: ConversationGenerationsPage, status = 200) {
  await act(async () => { requests[index].reply.resolve(new Response(JSON.stringify({ data }), { status })); });
}

beforeEach(() => {
  requests = [];
  preferences = new Map();
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => preferences.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { preferences.set(key, value); }),
    removeItem: vi.fn((key: string) => { preferences.delete(key); }),
  });
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "DELETE" && url.startsWith("/api/me/conversations/")) return Promise.resolve(new Response(JSON.stringify({ data: { ok: true } })));
    if (options?.method === "PATCH") return Promise.resolve(new Response(JSON.stringify({ data: {} })));
    const request = { url, options, reply: deferred<Response>() };
    requests.push(request);
    return request.reply.promise;
  }));
  router.refresh.mockClear();
});

afterEach(() => vi.unstubAllGlobals());

describe("studio conversation page integration", () => {
  it("shows metadata totals rather than treating loaded IDs as the whole history", async () => {
    const user = userEvent.setup();
    render(<GeneratorStudio {...baseProps} />);
    expect(screen.getByText("prompt recent_a")).toBeInTheDocument();
    expect(within(navigation()).getByText(/50000 轮/)).toBeInTheDocument();
    expect(within(navigation()).getByText(/150 轮/)).toBeInTheDocument();
    expect(requests).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "加载更早记录" }));
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/me/conversations/conversation_a/generations?cursor=older_a");
    expect(screen.getByRole("button", { name: "正在加载更早记录..." })).toBeDisabled();
    await finish(0, page([generation("older_a")]));
    expect(screen.getByText("prompt older_a")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "加载更早记录" })).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it("retries an older-page error at its captured cursor rather than loading page one again", async () => {
    const user = userEvent.setup();
    render(<GeneratorStudio {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "加载更早记录" }));
    await finish(0, page(), 503);
    expect(screen.getByRole("alert")).toHaveTextContent("会话加载失败");
    expect(screen.getByText("prompt recent_a")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试加载" }));
    expect(requests[1].url).toBe("/api/me/conversations/conversation_a/generations?cursor=older_a");
    await finish(1, page([generation("recovered_older")], "still_older"));
    expect(screen.getByText("prompt recovered_older")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(requests).toHaveLength(2);
  });

  it("restores the owner's older selection without seeding the first conversation's page into it", async () => {
    preferences.set(`narra_active_conversation_id:${ownerId}`, "conversation_b");
    render(<GeneratorStudio {...baseProps} />);
    expect(screen.queryByText("prompt recent_a")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("正在加载会话");
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/me/conversations/conversation_b/generations");
    await finish(0, page([generation("older_selected", "conversation_b")], "older_b", "conversation_b"));
    expect(screen.getByText("prompt older_selected")).toBeInTheDocument();
    expect(screen.queryByText("prompt recent_a")).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it("does not read another owner's or the retired unqualified active preference", () => {
    preferences.set("narra_active_conversation_id", "conversation_b");
    preferences.set("narra_active_conversation_id:owner_other", "conversation_b");
    render(<GeneratorStudio {...baseProps} />);
    expect(screen.getByText("prompt recent_a")).toBeInTheDocument();
    expect(requests).toHaveLength(0);
    expect(preferences.get(`narra_active_conversation_id:${ownerId}`)).toBe("conversation_a");
    expect(localStorage.getItem).not.toHaveBeenCalledWith("narra_active_conversation_id");
  });

  it.each(["new", "delete"])("ignores an old page and refreshed props after %s", async (operation) => {
    const user = userEvent.setup();
    const { rerender } = render(<GeneratorStudio {...baseProps} />);
    await user.click(within(navigation()).getByText("Old chat"));
    expect(requests).toHaveLength(1);
    if (operation === "new") await user.click(within(navigation()).getByRole("button", { name: /新建对话/ }));
    else await user.click(within(navigation()).getByRole("button", { name: "删除会话 Old chat" }));
    expect(requests[0].options?.signal?.aborted).toBe(true);
    await finish(0, page([generation("late_b", "conversation_b")], null, "conversation_b"));
    rerender(<GeneratorStudio {...baseProps} initialConversations={[...baseProps.initialConversations!]} initialGenerationPage={page([generation("refreshed_a")])} />);
    expect(screen.getByText("你好，你想创作什么？")).toBeInTheDocument();
    expect(screen.queryByText("prompt late_b")).toBeNull();
    expect(screen.queryByText("prompt refreshed_a")).toBeNull();
    expect(screen.queryByText("prompt recent_a")).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it("displays and retries selected conversation errors without falling back to the initial/global page", async () => {
    const user = userEvent.setup();
    render(<GeneratorStudio {...baseProps} initialGenerations={[generation("orphan", "unused", { conversationId: null })]} />);
    await user.click(within(navigation()).getByText("Old chat"));
    await finish(0, page([], null, "conversation_b"), 503);
    expect(screen.getByRole("alert")).toHaveTextContent("会话加载失败");
    expect(screen.queryByText("prompt recent_a")).toBeNull();
    expect(screen.queryByText("prompt orphan")).toBeNull();
    await user.click(screen.getByRole("button", { name: "重试加载" }));
    expect(requests[1].url).toBe("/api/me/conversations/conversation_b/generations");
    await finish(1, page([generation("recovered_b", "conversation_b")], null, "conversation_b"));
    expect(screen.getByText("prompt recovered_b")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("rejects malformed nested media before rendering bubbles and recovers through the scoped retry", async () => {
    const user = userEvent.setup();
    render(<GeneratorStudio {...baseProps} />);
    await user.click(within(navigation()).getByText("Old chat"));
    await act(async () => { requests[0].reply.resolve(new Response(JSON.stringify({ data: {
      conversationId: "conversation_b", nextCursor: null,
      generations: [{ ...generation("invalid_media", "conversation_b"), images: [null] }],
    } }))); });
    expect(screen.getByRole("alert")).toHaveTextContent("会话内容格式不正确，请重试");
    expect(screen.queryByText("prompt invalid_media")).toBeNull();
    expect(screen.queryByText("prompt recent_a")).toBeNull();
    await user.click(screen.getByRole("button", { name: "重试加载" }));
    await finish(1, page([generation("valid_media", "conversation_b", { images: [{
      id: "image", url: "https://example.test/scoped.png", actualWidth: null, actualHeight: null, actualSize: null,
    }] })], null, "conversation_b"));
    expect(screen.getByAltText("生成结果")).toHaveAttribute("src", expect.stringContaining("scoped.png"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("routes a late accepted job to its captured existing conversation, not the selected one", async () => {
    const user = userEvent.setup();
    render(<GeneratorStudio {...baseProps} initialConversations={[summary("conversation_a", "Recent chat", 1), summary("conversation_b", "Old chat", 0)]} />);
    await user.type(screen.getByPlaceholderText("输入提示词生成图片，或直接粘贴图片进入图生图..."), "Captured A request");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(requests[0]?.url).toBe("/api/generate"));
    expect(JSON.parse(String(requests[0].options?.body)).conversationId).toBe("conversation_a");
    await user.click(within(navigation()).getByText("Old chat"));
    await act(async () => { requests[0].reply.resolve(new Response(JSON.stringify({ data: { generation: generation("accepted_a") } }))); });
    expect(screen.queryByText("prompt accepted_a")).toBeNull();
    expect(screen.queryByText("prompt recent_a")).toBeNull();
    await user.click(within(navigation()).getByText("Recent chat"));
    expect(screen.getByText("prompt accepted_a")).toBeInTheDocument();
    expect(screen.getByText("prompt recent_a")).toBeInTheDocument();
    expect(within(navigation()).getByText(/2 轮/)).toBeInTheDocument();
    expect(requests).toHaveLength(1);
  });
});

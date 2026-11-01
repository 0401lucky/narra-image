import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, Ref } from "react";

import { GeneratorStudio } from "@/components/create/generator-studio";
import { POLL_DELAYS_MS } from "@/components/create/constants";
import { conversationGeneration as generation, conversationPage as page } from "./helpers/conversation-fixtures";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const challenge = vi.hoisted(() => ({ reset: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/auth/turnstile-widget", async () => {
  const { useImperativeHandle } = await import("react");
  return {
    TurnstileWidget: ({ onVerify, ref }: { onVerify: (token: string) => void; ref: Ref<{ reset: () => void }> }) => {
      useImperativeHandle(ref, () => ({ reset: challenge.reset }), []);
      return <><button type="button" onClick={() => onVerify("first-token")}>Verify first</button><button type="button" onClick={() => onVerify("next-token")}>Verify next</button></>;
    },
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type PendingRequest = { url: string; options?: RequestInit; reply: ReturnType<typeof deferred<Response>> };
type StudioProps = ComponentProps<typeof GeneratorStudio>;
const summary = (id: string, title: string, generationCount = 0) => ({ id, title, generationCount, generationIds: [], createdAt: "2026-10-01T00:00:00.000Z" });
const baseProps: StudioProps = {
  ownerId: "owner_a", currentUser: { credits: 500, role: "user" },
  checkInSummary: { checkInReward: 50, checkedInToday: false },
  initialConversations: [summary("conversation_a", "Chat A"), summary("conversation_b", "Chat B")],
  initialGenerationPage: page(),
};
let requests: PendingRequest[];
let preferences: Map<string, string>;
let resolveConversationDeletes: boolean;

function composer() {
  return screen.getByPlaceholderText(/输入提示词生成图片|描述你希望如何修改这些参考图/) as HTMLTextAreaElement;
}
function navigation() { return screen.getByRole("complementary", { name: "对话导航" }); }
function writePrompt(value: string) { fireEvent.change(composer(), { target: { value } }); }
function send() { fireEvent.click(screen.getByRole("button", { name: "发送" })); }
function newChat() { fireEvent.click(within(navigation()).getByRole("button", { name: /新建对话/ })); }
function selectChat(title: string) { fireEvent.click(within(navigation()).getByText(title)); }
function dropFiles(...names: string[]) {
  fireEvent.drop(composer().closest(".composer-silk")!, {
    dataTransfer: { files: names.map((name) => new File([name], name, { type: "image/png" })), types: ["Files"] },
  });
}
function findRequest(url: string, method = "POST") {
  const request = requests.find((item) => item.url === url && (item.options?.method ?? "GET") === method);
  if (!request) throw new Error(`Missing ${method} ${url}`);
  return request;
}
const generates = () => requests.filter((item) => item.url === "/api/generate");
async function reply(request: PendingRequest, body: unknown, status = 200) {
  await act(async () => { request.reply.resolve(new Response(JSON.stringify(body), { status })); });
}
const created = (id = "created_chat") => ({ data: { conversation: { ...summary(id, "Captured create"), updatedAt: "2026-10-01T00:00:00.000Z" } } });

beforeEach(() => {
  requests = [];
  preferences = new Map();
  resolveConversationDeletes = true;
  router.refresh.mockClear();
  challenge.reset.mockClear();
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => preferences.get(key) ?? null,
    setItem: (key: string, value: string) => preferences.set(key, value),
    removeItem: (key: string) => preferences.delete(key),
  });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((file: File) => `blob:${file.name}`) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    const request = { url, options, reply: deferred<Response>() };
    requests.push(request);
    if (options?.method === "PATCH" || (resolveConversationDeletes && options?.method === "DELETE" && url.startsWith("/api/me/conversations/"))) {
      request.reply.resolve(new Response("{}"));
    }
    return request.reply.promise;
  }));
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("studio captured chat command ownership", () => {
  it.each(["new", "switch", "delete", "owner"])("never appends/selects/submits a delayed provisional create after %s", async (operation) => {
    const { rerender } = render(<GeneratorStudio {...baseProps} />);
    newChat();
    writePrompt("Captured old draft");
    dropFiles("old.png");
    send();
    const create = findRequest("/api/me/conversations");
    if (operation === "new") newChat();
    if (operation === "switch") selectChat("Chat B");
    if (operation === "delete") fireEvent.click(screen.getByRole("button", { name: "删除会话 Chat B" }));
    if (operation === "owner") rerender(<GeneratorStudio {...baseProps} ownerId="owner_b" />);
    writePrompt("Latest live draft");
    await reply(create, created());
    expect(create.options?.signal?.aborted).toBe(true);
    expect(generates()).toEqual([]);
    expect(composer()).toHaveValue("Latest live draft");
    expect(within(navigation()).queryByText("Captured create")).toBeNull();
    expect(screen.queryByAltText("Reference")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:old.png");
  });

  it("can submit the new draft while an obsolete create is still unresolved", async () => {
    render(<GeneratorStudio {...baseProps} />);
    newChat(); writePrompt("Obsolete command"); send();
    const obsolete = findRequest("/api/me/conversations");
    newChat(); writePrompt("Current command"); send();
    const current = requests.filter((item) => item.url === "/api/me/conversations")[1];
    await reply(current, created("current_chat"));
    expect(generates()).toHaveLength(1);
    expect(JSON.parse(String(generates()[0].options?.body))).toMatchObject({ conversationId: "current_chat", prompt: "Current command" });
    await reply(obsolete, created("obsolete_chat"));
    expect(generates()).toHaveLength(1);
    expect(preferences.get("narra_active_conversation_id:owner_a")).toBe("current_chat");
  });

  it("does not restore old reference inputs over edits made while conversation creation fails", async () => {
    render(<GeneratorStudio {...baseProps} />);
    newChat(); writePrompt("Old prompt"); dropFiles("old-a.png", "old-b.png"); send();
    writePrompt("Replacement draft"); dropFiles("new.png");
    await reply(findRequest("/api/me/conversations"), { error: "Failed create" }, 503);
    expect(composer()).toHaveValue("Replacement draft");
    expect(screen.getAllByAltText("Reference").map((image) => image.getAttribute("src"))).toEqual(["blob:new.png"]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(generates()).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:old-a.png");
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:new.png");
  });

  it("restores the draft without generating when a new-session response has a non-renderable title", async () => {
    render(<GeneratorStudio {...baseProps} />);
    newChat(); writePrompt("Preserved create input"); dropFiles("original.png"); send();
    await reply(findRequest("/api/me/conversations"), { data: { conversation: {
      ...created().data.conversation, title: { unexpected: "object" },
    } } });
    expect(composer()).toHaveValue("Preserved create input");
    expect(screen.getByAltText("Reference")).toHaveAttribute("src", "blob:original.png");
    expect(screen.getByRole("alert")).toHaveTextContent("创建会话失败");
    expect(generates()).toEqual([]);
    expect(within(navigation()).queryByText("Captured create")).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:original.png");
  });

  it.each(["typed-then-cleared", "switched-back"])("rejects a late generation error after the draft was %s", async (operation) => {
    render(<GeneratorStudio {...baseProps} />);
    writePrompt("Submitted old prompt"); send();
    if (operation === "typed-then-cleared") { writePrompt("New prompt"); writePrompt(""); }
    else { selectChat("Chat B"); selectChat("Chat A"); }
    await reply(findRequest("/api/generate"), { error: "Old generation failure" }, 503);
    expect(composer()).toHaveValue("");
    expect(screen.queryByText("Old generation failure")).toBeNull();
    expect(screen.queryByText("Submitted old prompt")).toBeNull();
  });

  it("freezes reference order, options and CAPTCHA before creating a conversation while preserving newer inputs", async () => {
    render(<GeneratorStudio {...baseProps} turnstile={{ isEnabled: true, siteKey: "test-site", protectGenerate: true }} />);
    newChat(); writePrompt("Frozen image edit"); dropFiles("first.png", "second.png");
    fireEvent.click(screen.getByRole("button", { name: "参考图 2 前移" }));
    fireEvent.change(screen.getByRole("combobox", { name: "尺寸" }), { target: { value: "1024x1024" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify first" }));
    send();
    writePrompt("Next image edit"); dropFiles("next.png");
    fireEvent.change(screen.getByRole("combobox", { name: "尺寸" }), { target: { value: "2048x2048" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify next" }));
    await reply(findRequest("/api/me/conversations"), created());
    const body = generates()[0].options?.body as FormData;
    expect(body.get("conversationId")).toBe("created_chat");
    expect(body.get("prompt")).toBe("Frozen image edit");
    expect(body.get("size")).toBe("1024x1024");
    expect(body.get("turnstileToken")).toBe("first-token");
    expect(body.getAll("referenceImages").map((value) => (value as File).name)).toEqual(["second.png", "first.png"]);
    await reply(generates()[0], { data: { generation: generation("accepted", "created_chat") } });
    expect(composer()).toHaveValue("Next image edit");
    expect(screen.getByAltText("Reference")).toHaveAttribute("src", "blob:next.png");
    expect(screen.getByRole("combobox", { name: "尺寸" })).toHaveValue("2048x2048");
    expect(challenge.reset).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "发送" })).not.toBeDisabled();
    send();
    expect((generates()[1].options?.body as FormData).get("turnstileToken")).toBe("next-token");
  });

  it("prevents button/Enter double-submission even after typing a second prompt during the pending command", async () => {
    render(<GeneratorStudio {...baseProps} />);
    writePrompt("First command"); send();
    writePrompt("Second draft");
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    fireEvent.keyDown(composer(), { key: "Enter" });
    fireEvent.keyDown(composer(), { key: "Enter" });
    send();
    expect(generates()).toHaveLength(1);
    await reply(generates()[0], { data: { generation: generation("first_ack") } });
    expect(composer()).toHaveValue("Second draft");
    send();
    expect(generates()).toHaveLength(2);
    expect(JSON.parse(String(generates()[1].options?.body)).prompt).toBe("Second draft");
  });

  it("keeps malformed generation acknowledgements out of the mounted cache and restores the current input", async () => {
    vi.useFakeTimers();
    render(<GeneratorStudio {...baseProps} />);
    writePrompt("Recoverable submitted prompt"); send();
    await reply(generates()[0], { data: { generation: { ...generation("invalid_ack"), images: [null] } } });
    expect(composer()).toHaveValue("Recoverable submitted prompt");
    expect(screen.getByRole("alert")).toHaveTextContent("服务端返回的生成内容不正确");
    expect(screen.queryByText("prompt invalid_ack")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(requests).toHaveLength(1);
  });

  it("resets drafts/previews/provider runtime and drops late commands on the actual A-B-A owner cycle", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<GeneratorStudio {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "高级设置" }));
    await user.click(screen.getAllByRole("button", { name: "自填 API" })[0]);
    fireEvent.change(screen.getAllByLabelText("第三方 API Key")[0], { target: { value: "fixture-only-key" } });
    await user.click(screen.getAllByRole("button", { name: "拉取模型" })[0]);
    const probe = findRequest("/api/provider-models/probe");
    writePrompt("Owner A request"); dropFiles("owner-a.png"); send();
    const submitted = findRequest("/api/generate");
    rerender(<GeneratorStudio {...baseProps} ownerId="owner_b" />);
    expect(composer()).toHaveValue("");
    expect(screen.queryByAltText("Reference")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:owner-a.png");
    expect(probe.options?.signal?.aborted).toBe(true);
    expect(submitted.options?.signal?.aborted).toBe(true);
    rerender(<GeneratorStudio {...baseProps} />);
    writePrompt("Fresh owner A draft");
    await reply(submitted, { data: { generation: generation("obsolete_ack") } });
    await reply(probe, { data: { models: ["obsolete-model"] } });
    expect(composer()).toHaveValue("Fresh owner A draft");
    expect(screen.queryByText("prompt obsolete_ack")).toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "高级设置" }));
    await user.click(screen.getAllByRole("button", { name: "自填 API" })[0]);
    expect(screen.getAllByLabelText("第三方 API Key")[0]).toHaveValue("");
    expect(screen.getAllByLabelText("第三方模型")[0]).toHaveValue("gpt-image-2");
    expect(screen.queryByText("已拉取 1 个模型")).toBeNull();
  });

  it("keeps local prompt, references, selection and provider input on same-owner fresh props", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<GeneratorStudio {...baseProps} />);
    selectChat("Chat B"); writePrompt("Local draft"); dropFiles("local.png");
    await user.click(screen.getByRole("button", { name: "高级设置" }));
    await user.click(screen.getAllByRole("button", { name: "自填 API" })[0]);
    fireEvent.change(screen.getAllByLabelText("第三方 API Key")[0], { target: { value: "local-fixture-key" } });
    rerender(<GeneratorStudio {...baseProps} currentUser={{ credits: 999, role: "user" }} initialPrompt="Stale server prompt" initialConversations={[...baseProps.initialConversations!]} initialGenerationPage={page([generation("stale_job")])} />);
    expect(composer()).toHaveValue("Local draft");
    expect(screen.getByAltText("Reference")).toHaveAttribute("src", "blob:local.png");
    expect(screen.getAllByLabelText("第三方 API Key")[0]).toHaveValue("local-fixture-key");
    expect(preferences.get("narra_active_conversation_id:owner_a")).toBe("conversation_b");
    expect(screen.queryByText("prompt stale_job")).toBeNull();
    expect(requests).toEqual([]);
  });

  it("keeps a known A job polling while B is selected and never regresses terminal data from fresh props", async () => {
    vi.useFakeTimers();
    const pending = generation("pending_a", "conversation_a", { status: "pending" });
    const props = { ...baseProps, initialConversations: [summary("conversation_a", "Chat A", 1), summary("conversation_b", "Chat B")], initialGenerationPage: page([pending]) };
    const { rerender } = render(<GeneratorStudio {...props} />);
    selectChat("Chat B"); writePrompt("B stays local");
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_DELAYS_MS[0]); });
    const poll = findRequest("/api/me/generations/pending_a", "GET");
    await reply(poll, { data: { generation: generation("pending_a", "conversation_a", { prompt: "Canonical terminal A" }) } });
    expect(composer()).toHaveValue("B stays local");
    expect(screen.queryByText("Canonical terminal A")).toBeNull();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    rerender(<GeneratorStudio {...props} initialGenerationPage={page([{ ...pending }])} />);
    expect(composer()).toHaveValue("B stays local");
    selectChat("Chat A");
    expect(screen.getByText("Canonical terminal A")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消生成" })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(requests.filter((item) => item.url === poll.url)).toHaveLength(1);
  });

  it("converges the visible cache and poll registry when terminal time is behind the pending timestamp", async () => {
    vi.useFakeTimers();
    const pending = generation("clock_skew", "conversation_a", { status: "pending", updatedAt: "2026-10-03T00:00:00.000Z" });
    render(<GeneratorStudio {...baseProps} initialGenerationPage={page([pending])} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_DELAYS_MS[0]); });
    await reply(findRequest("/api/me/generations/clock_skew", "GET"), { data: { generation: generation("clock_skew", "conversation_a", {
      updatedAt: "2026-10-02T00:00:00.000Z", prompt: "Terminal without a render loop",
    }) } });
    expect(screen.getByText("Terminal without a render loop")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消生成" })).toBeNull();
    expect(router.refresh).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(requests).toHaveLength(1);
  });

  it("rejects a mismatched cancellation reply and keeps the original job subscribed", async () => {
    vi.useFakeTimers();
    const pending = generation("cancel_target", "conversation_a", { status: "pending" });
    render(<GeneratorStudio {...baseProps} initialGenerationPage={page([pending])} />);
    fireEvent.click(screen.getByRole("button", { name: "取消生成" }));
    await reply(findRequest("/api/me/generations/cancel_target", "DELETE"), { data: { generation: generation("wrong_target") } });
    expect(screen.getByRole("alert")).toHaveTextContent("服务端返回的任务状态不正确");
    expect(screen.getByRole("button", { name: "取消生成" })).toBeInTheDocument();
    expect(screen.queryByText("prompt wrong_target")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_DELAYS_MS[0]); });
    await reply(findRequest("/api/me/generations/cancel_target", "GET"), { data: { generation: generation("cancel_target", "conversation_a", { status: "failed" }) } });
    expect(screen.queryByRole("button", { name: "取消生成" })).toBeNull();
  });

  it("retains polling of an accepted deleted-origin job without restoring its organization or cancelling it", async () => {
    vi.useFakeTimers();
    render(<GeneratorStudio {...baseProps} />);
    writePrompt("Removed source request"); send();
    fireEvent.click(screen.getByRole("button", { name: "删除会话 Chat A" }));
    await reply(generates()[0], { data: { generation: generation("detached", "conversation_a", { status: "pending" }) } });
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_DELAYS_MS[0]); });
    await reply(findRequest("/api/me/generations/detached", "GET"), { data: { generation: generation("detached", "conversation_a", { prompt: "Detached terminal" }) } });
    expect(screen.queryByText("Detached terminal")).toBeNull();
    expect(within(navigation()).queryByText("Chat A")).toBeNull();
    expect(screen.getByText("你好，你想创作什么？")).toBeInTheDocument();
    expect(requests.filter((item) => item.url.includes("/generations/") && item.options?.method === "DELETE")).toEqual([]);
    expect(generates()).toHaveLength(1);
  });

  it.each([
    ["append", false], ["replace", false], ["append", true], ["replace", true],
  ] as const)("reconciles a buffered %s ACK only if pending deletion fails (deleted=%s)", async (operation, deleted) => {
    vi.useFakeTimers();
    resolveConversationDeletes = false;
    const previous = generation("previous", "conversation_a", { status: operation === "replace" ? "failed" : "pending" });
    render(<GeneratorStudio {...baseProps} initialGenerationPage={page([previous])} initialConversations={[
      summary("conversation_a", "Chat A", 1), summary("conversation_b", "Chat B"),
    ]} />);
    if (operation === "replace") fireEvent.click(screen.getByRole("button", { name: "重试" }));
    else { writePrompt("Accepted while deleting"); send(); }
    fireEvent.click(screen.getByRole("button", { name: "删除会话 Chat A" }));
    const deletion = findRequest("/api/me/conversations/conversation_a", "DELETE");
    writePrompt("New draft stays selected");
    await reply(generates()[0], { data: { generation: generation("buffered", "conversation_a", { status: "pending" }) } });
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_DELAYS_MS[0]); });
    const completed = generation("buffered", "conversation_a", { images: [{
      id: "buffered_image", url: "https://example.test/buffered.png", actualWidth: 1, actualHeight: 1, actualSize: "1x1",
    }] });
    await reply(findRequest("/api/me/generations/buffered", "GET"), { data: { generation: completed } });
    if (operation === "append") {
      await reply(findRequest("/api/me/generations/previous", "GET"), { data: { generation: generation("previous", "conversation_a", { images: [{
        id: "previous_image", url: "https://example.test/previous.png", actualWidth: 1, actualHeight: 1, actualSize: "1x1",
      }] }) } });
    }
    expect(screen.queryByText("prompt buffered")).toBeNull();
    expect(screen.queryByAltText("生成结果")).toBeNull();
    await reply(deletion, deleted ? { data: { ok: true } } : { error: "Temporary failure" }, deleted ? 200 : 503);
    expect(composer()).toHaveValue("New draft stays selected");
    expect(screen.queryByText("prompt buffered")).toBeNull();
    if (deleted) {
      expect(within(navigation()).queryByText("Chat A")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    } else {
      expect(screen.getByRole("alert")).toHaveTextContent("删除会话失败");
      selectChat("Chat A");
      expect(screen.getByText("prompt buffered")).toBeInTheDocument();
      const images = screen.getAllByAltText("生成结果");
      expect(images).toHaveLength(operation === "append" ? 2 : 1);
      expect(images.some((image) => image.getAttribute("src")?.includes("buffered.png"))).toBe(true);
      expect(screen.queryByRole("button", { name: "取消生成" })).toBeNull();
      expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
      expect(within(navigation()).getByText(new RegExp(`${operation === "append" ? 2 : 1} 轮`))).toBeInTheDocument();
      expect(screen.queryByText("prompt previous") !== null).toBe(operation === "append");
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(generates()).toHaveLength(1);
    expect(requests.filter((item) => item.url.includes("/generations/") && item.options?.method === "DELETE")).toEqual([]);
    expect(requests.filter((item) => item.url.includes("/conversations/") && item.options?.method !== "DELETE")).toEqual([]);
  });

  it("reopens an owner with a fresh canonical cache and ignores its previous mount's late poll", async () => {
    vi.useFakeTimers();
    const pending = generation("same_job", "conversation_a", { status: "pending" });
    const props = { ...baseProps, initialGenerationPage: page([pending]) };
    const { rerender } = render(<GeneratorStudio {...props} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_DELAYS_MS[0]); });
    const oldPoll = findRequest("/api/me/generations/same_job", "GET");
    rerender(<GeneratorStudio {...baseProps} ownerId="owner_b" />);
    expect(oldPoll.options?.signal?.aborted).toBe(true);
    expect(screen.queryByText("prompt same_job")).toBeNull();
    rerender(<GeneratorStudio {...props} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_DELAYS_MS[0]); });
    const currentPoll = requests.filter((item) => item.url === oldPoll.url)[1];
    await reply(oldPoll, { data: { generation: generation("same_job", "conversation_a", { prompt: "Old owner cache" }) } });
    expect(screen.queryByText("Old owner cache")).toBeNull();
    expect(screen.getByRole("button", { name: "取消生成" })).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
    await reply(currentPoll, { data: { generation: generation("same_job", "conversation_a", { prompt: "Current owner cache" }) } });
    expect(screen.getByText("Current owner cache")).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([200, 503])("ignores old cancellation and conversation-delete replies after owner A-B-A (delete status %s)", async (status) => {
    resolveConversationDeletes = false;
    const pending = generation("old_command", "conversation_a", { status: "pending" });
    const props = { ...baseProps, initialGenerationPage: page([pending]) };
    const { rerender } = render(<GeneratorStudio {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "取消生成" }));
    const cancel = findRequest("/api/me/generations/old_command", "DELETE");
    fireEvent.click(screen.getByRole("button", { name: "删除会话 Chat A" }));
    const deletion = findRequest("/api/me/conversations/conversation_a", "DELETE");
    rerender(<GeneratorStudio {...baseProps} ownerId="owner_b" />);
    rerender(<GeneratorStudio {...props} />);
    writePrompt("Fresh account draft");
    await reply(cancel, { data: { generation: generation("old_command", "conversation_a", { status: "failed" }) } });
    await reply(deletion, {}, status);
    expect(cancel.options?.signal?.aborted).toBe(true);
    expect(deletion.options?.signal?.aborted).toBe(true);
    expect(composer()).toHaveValue("Fresh account draft");
    expect(screen.getByRole("button", { name: "取消生成" })).toBeInTheDocument();
    expect(within(navigation()).getByText("Chat A")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(generates()).toEqual([]);
  });

  it("aborts a download on owner change without a late anchor click or fallback window", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const image = generation("image", "conversation_a", { images: [{ id: "image", url: "https://example.test/owned.png", actualWidth: 1, actualHeight: 1, actualSize: "1x1" }] });
    const { rerender } = render(<GeneratorStudio {...baseProps} initialGenerationPage={page([image])} />);
    fireEvent.click(screen.getByTitle("下载保存"));
    const download = requests[0];
    rerender(<GeneratorStudio {...baseProps} ownerId="owner_b" />);
    await reply(download, { error: "Late failure" }, 503);
    expect(download.options?.signal?.aborted).toBe(true);
    expect(click).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByAltText("生成结果")).toBeNull());
  });
});

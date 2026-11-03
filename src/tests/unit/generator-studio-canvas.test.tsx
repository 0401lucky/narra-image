import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import type { ComponentProps, Ref } from "react";

import type { CanvasController } from "@/components/create/canvas/controller";
import type { CanvasStageProps } from "@/components/create/parts/canvas-stage";
import type { CanvasGenerateRequestV1 } from "@/lib/canvas/contracts";
import { CANVAS_RUN_REQUEST_HEADERS } from "@/lib/canvas/contracts";

const controls = vi.hoisted(() => ({
  stage: null as CanvasStageProps | null, failStage: false, stageFailureName: "Error", openStore: vi.fn(),
  token: "fixture-token", challengeResets: vi.fn(), challengeCallbacks: [] as Array<(token: string) => void>,
  challengeExpires: [] as Array<() => void>,
}));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/create/canvas/draft-store", () => ({ openCanvasDraftStore: controls.openStore }));
vi.mock("@/components/create/parts/canvas-stage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/create/parts/canvas-stage")>();
  return { ...original, CanvasStage: (props: CanvasStageProps) => {
    controls.stage = props;
    if (controls.failStage) throw Object.assign(new Error("fixture renderer failure"), { name: controls.stageFailureName });
    return <original.CanvasStage {...props} />;
  } };
});
vi.mock("@/components/auth/turnstile-widget", async () => {
  const { useEffect, useImperativeHandle } = await import("react");
  return { TurnstileWidget: ({ onVerify, onExpire, ref }: { onVerify: (token: string) => void; onExpire: () => void; ref: Ref<{ reset: () => void }> }) => {
    useImperativeHandle(ref, () => ({ reset: controls.challengeResets }), []);
    useEffect(() => { controls.challengeCallbacks.push(onVerify); }, [onVerify]);
    useEffect(() => { controls.challengeExpires.push(onExpire); }, [onExpire]);
    return <button type="button" onClick={() => onVerify(controls.token)}>完成测试验证</button>;
  } };
});

import { GeneratorStudio } from "@/components/create/generator-studio";
import { canvasDate, canvasJob, canvasUuid, completedJob, createFakeCanvasApi, createFakeCanvasStore, deferred } from "./helpers/canvas-controller-fixtures";
import { canvasStageChannels, installCanvasDom } from "./helpers/canvas-renderer-fixtures";

type StudioProps = ComponentProps<typeof GeneratorStudio>;
type RequestRecord = { path: string; method: string; init: RequestInit; body: Record<string, unknown> | null };
const baseProps: StudioProps = {
  ownerId: "owner-a", canvasEnabled: true, currentUser: { credits: 500, role: "user" },
  checkInSummary: { checkInReward: 50, checkedInToday: false }, channels: canvasStageChannels,
};
const challengeConfig = { isEnabled: true, siteKey: "canvas-fixture-site", protectGenerate: true };
const savedProvider = { id: "saved-provider", baseUrl: "https://saved.invalid/v1", label: "Saved channel", model: "saved-model", models: ["saved-model"], updatedAt: canvasDate };
let requests: RequestRecord[];
let store: ReturnType<typeof createFakeCanvasStore>;
let servers: Map<string, ReturnType<typeof createFakeCanvasApi>>;
let serverOwner: string;
let preferences: Map<string, string>;
let generationGate: ReturnType<typeof deferred<Response>> | null;
let downloadGate: ReturnType<typeof deferred<Response>> | null;
let restoreGeometry: () => void;
let desktop: { matches: boolean; listeners: Set<() => void> };
let objectUrls: ReturnType<typeof vi.fn<(blob: Blob) => string>>;
let revokeUrls: ReturnType<typeof vi.fn<(url: string) => void>>;

function server() {
  let api = servers.get(serverOwner);
  if (!api) { api = createFakeCanvasApi(); servers.set(serverOwner, api); }
  return api;
}
function response(data: unknown, status = 200) { return new Response(JSON.stringify({ data }), { status, headers: { "content-type": "application/json" } }); }
function sends() { return requests.filter((request) => request.path === "/api/generate"); }
function canvasSend(index = 0) { return sends()[index].body as CanvasGenerateRequestV1; }
function composer() { return screen.getByPlaceholderText(/输入提示词生成图片|描述你希望如何修改这些参考图/) as HTMLTextAreaElement; }
function switchMode(name: "对话" | "画布") { fireEvent.click(within(screen.getByRole("group", { name: "创作模式" })).getByRole("button", { name })); }
async function openCanvas() {
  switchMode("画布");
  await screen.findByRole("region", { name: "画布工作区" });
  await waitFor(() => expect(controls.stage?.snapshot.ready).toBe(true));
  return controls.stage!.controller!;
}
async function graph(controller: CanvasController) {
  let canvasId = "";
  let promptId = "";
  let nodeId = "";
  await act(async () => {
    canvasId = await controller.newCanvas();
    promptId = controller.addPrompt(canvasId, { x: -100, y: 0 }, "Canvas original prompt");
    nodeId = controller.addGeneration(canvasId, { x: 260, y: 0 });
    controller.connect(canvasId, promptId, nodeId);
  });
  return { canvasId, promptId, nodeId };
}
async function run() {
  const button = await screen.findByRole("button", { name: "运行此节点" });
  await act(async () => { fireEvent.click(button); await new Promise((resolve) => setTimeout(resolve, 35)); });
}
function modal() { return screen.getByRole("dialog", { name: "确认本次画布运行" }); }
function verify(token: string) { controls.token = token; fireEvent.click(screen.getByRole("button", { name: "完成测试验证" })); }

beforeEach(() => {
  requests = [];
  preferences = new Map();
  store = createFakeCanvasStore();
  servers = new Map();
  serverOwner = "owner-a";
  generationGate = null;
  downloadGate = null;
  controls.stage = null;
  controls.failStage = false;
  controls.stageFailureName = "Error";
  controls.challengeCallbacks = [];
  controls.challengeExpires = [];
  controls.challengeResets.mockClear();
  controls.openStore.mockReset().mockResolvedValue(store.port);
  router.refresh.mockClear();
  restoreGeometry = installCanvasDom();
  desktop = { matches: true, listeners: new Set() };
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    media: query, get matches() { return query === "(min-width: 768px)" ? desktop.matches : query.includes("pointer: coarse") ? !desktop.matches : false; }, onchange: null,
    addEventListener: (_: string, callback: () => void) => desktop.listeners.add(callback),
    removeEventListener: (_: string, callback: () => void) => desktop.listeners.delete(callback),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => true,
  })));
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => preferences.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => preferences.set(key, value)),
    removeItem: vi.fn((key: string) => preferences.delete(key)),
  });
  let previewId = 0;
  objectUrls = vi.fn(() => `blob:studio-canvas-${++previewId}`);
  revokeUrls = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: objectUrls });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeUrls });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    requests.push({ path, method, init, body });
    const api = server();
    const signal = init.signal ?? new AbortController().signal;
    if (path === "/api/me/canvases") {
      return method === "GET" ? response(await api.port.list(null, signal)) : response({ canvas: await api.port.create(String(body!.id), String(body!.title), signal) });
    }
    if (path === "/api/me/canvas-runtime/resolve") return response(await api.port.resolve(body as Parameters<typeof api.port.resolve>[0], signal));
    if (path.startsWith("/api/me/canvas-runs/")) {
      const runId = path.split("/").at(-1)!;
      const lookup = api.runs.get(runId);
      return lookup ? response(lookup) : new Response(JSON.stringify({ code: "CANVAS_RUN_NOT_FOUND" }), { status: 404 });
    }
    if (path.startsWith("/api/me/generations/")) {
      const jobId = path.split("/").at(-1)!;
      const run = [...api.runs.values()].find((item) => item.state === "COMMITTED" && item.jobId === jobId);
      return response({ generation: run?.state === "COMMITTED" ? run.generation : null });
    }
    if (path.startsWith("/api/me/canvases/")) {
      const id = path.split("/")[4];
      if (method === "GET") return response(await api.port.read(id, signal));
      if (method === "DELETE") return response(await api.port.delete(id, Number(body!.expectedRevision), signal));
      if (method === "PUT") return response(await api.port.save(id, body as Parameters<typeof api.port.save>[1], signal));
    }
    if (path === "/api/generate") {
      if (generationGate) return generationGate.promise;
      if (body?.canvasRun) {
        const wire = (body as CanvasGenerateRequestV1).canvasRun;
        const job = completedJob(`canvas-job-${sends().length}`, wire.parameters.count);
        job.prompt = wire.input.prompt.text;
        const origin = { canvasId: wire.canvasId, nodeId: wire.nodeId, runId: wire.runId };
        api.runs.set(wire.runId, { state: "COMMITTED", origin, jobId: job.id, generation: job, unavailable: null });
        return response({ generation: job, canvasRun: { ...origin, jobId: job.id } });
      }
      return response({ generation: { ...completedJob("chat-job"), prompt: body?.prompt, conversationId: body?.conversationId } });
    }
    if (path === "/api/me/conversations") return response({ conversation: { id: "new-chat", title: body?.title ?? "新对话", generationIds: [], createdAt: canvasDate, updatedAt: canvasDate } });
    if (path.startsWith("/api/me/conversations/") && method === "PATCH") return response({});
    if (path.startsWith("blob:") && downloadGate) return downloadGate.promise;
    if (path.startsWith("/api/proxy-image") || path.startsWith("blob:")) return new Response(new Blob(["image"], { type: "image/png" }), { headers: { "content-type": "image/png" } });
    throw new Error(`Unexpected fixture request: ${method} ${path}`);
  }));
});

afterEach(() => {
  cleanup();
  generationGate?.resolve(response({}));
  downloadGate?.resolve(new Response(new Blob(["image"], { type: "image/png" }), { headers: { "content-type": "image/png" } }));
  restoreGeometry();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("mounted studio canvas integration", () => {
  it("keeps old callers in chat and never initializes canvas storage or transport while disabled", async () => {
    preferences.set("narra_studio_mode_v1:owner-a", "canvas");
    render(<GeneratorStudio {...baseProps} canvasEnabled={undefined} initialPrompt="Chat seed" />);
    await act(async () => { await Promise.resolve(); });
    expect(composer()).toHaveValue("Chat seed");
    expect(screen.queryByRole("group", { name: "创作模式" })).not.toBeInTheDocument();
    expect(controls.openStore).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it("switches real lazy panes without importing drafts, and keeps empty New/catalog defaults and selection across refresh", async () => {
    const view = render(<GeneratorStudio {...baseProps} initialPrompt="URL seeds only chat" />);
    fireEvent.drop(composer().closest(".composer-silk")!, { dataTransfer: { files: [new File(["chat"], "chat.png", { type: "image/png" })], types: ["Files"] } });
    fireEvent.change(composer(), { target: { value: "Unsent chat and its reference" } });
    fireEvent.change(screen.getByLabelText("尺寸"), { target: { value: "1536x1024" } });
    const controller = await openCanvas();
    expect(screen.queryByAltText("Reference")).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "对话导航" })).not.toBeInTheDocument();
    expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "新建空白画布" }));
    await screen.findByText("从一个想法开始");
    const first = controller.getSnapshot().activeCanvasId!;
    expect(controller.getSnapshot().active!.scene).toMatchObject({ nodes: [], edges: [], runBindings: [] });
    fireEvent.click(screen.getByRole("button", { name: "创作第一张图片" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "节点提示词" }), { target: { value: "Canvas draft only" } });
    const generation = controller.getSnapshot().active!.scene.nodes.find((node) => node.kind === "generation")!;
    expect(generation.parameters).toMatchObject({ model: "image-account-default", providerMode: "built_in", channelId: "channel-account", size: "auto", count: 1 });
    act(() => controller.selectNode(first, generation.id));
    switchMode("对话");
    expect(composer()).toHaveValue("Unsent chat and its reference");
    expect(screen.getByAltText("Reference")).toBeInTheDocument();
    view.rerender(<GeneratorStudio {...baseProps} initialPrompt="New server value" channels={[...canvasStageChannels]} initialConversations={[]} />);
    await openCanvas();
    expect(controls.stage!.controller).toBe(controller);
    expect(controller.getSnapshot().active!.selectedNodeId).toBe(generation.id);
    expect(screen.getByRole("textbox", { name: "节点提示词" })).toHaveValue("Canvas draft only");
    await userEvent.click(screen.getByRole("button", { name: "新建空白画布" }));
    await waitFor(() => expect(controller.getSnapshot().activeCanvasId).not.toBe(first));
    expect(controller.getSnapshot().active!.scene.nodes).toEqual([]);
    await act(() => controller.selectCanvas(first));
    expect(screen.getByRole("textbox", { name: "节点提示词" })).toHaveValue("Canvas draft only");
    expect(sends()).toEqual([]);
    expect(requests.some((request) => request.path === "/api/me/conversations")).toBe(false);
  });

  it("reads owner-qualified mode/media preferences only after mount, not in SSR", async () => {
    preferences.set("narra_studio_mode_v1:owner-a", "canvas");
    const markup = renderToString(<GeneratorStudio {...baseProps} initialPrompt="SSR chat" />);
    expect(markup).toContain("SSR chat");
    expect(markup).not.toContain("画布工作区");
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(window.matchMedia).not.toHaveBeenCalled();
    expect(controls.openStore).not.toHaveBeenCalled();
    render(<GeneratorStudio {...baseProps} initialPrompt="SSR chat" />);
    await screen.findByRole("region", { name: "画布工作区" });
    expect(localStorage.getItem).toHaveBeenCalledWith("narra_studio_mode_v1:owner-a");
    expect(sends()).toEqual([]);
  });

  it("enables phone canvas after mount independently of width, and keeps phone chat creation and the same controller on rotation", async () => {
    desktop.matches = false;
    vi.stubGlobal("innerWidth", 390);
    server().seed(canvasUuid(10));
    render(<GeneratorStudio {...baseProps} />);
    const controller = await openCanvas();
    await waitFor(() => expect(controller.getSnapshot().active).not.toBeNull());
    expect(controller.getSnapshot().readOnly).toBe(false);
    for (const name of ["新建空白画布", "保存到账户", "提示词", "生成节点"]) expect(screen.getByRole("button", { name })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "提示词" }));
    fireEvent.click(await screen.findByRole("button", { name: "编辑所选节点" }));
    fireEvent.change(screen.getByRole("textbox", { name: "节点提示词" }), { target: { value: "Phone canvas draft" } });
    expect(sends()).toEqual([]);
    const revision = controller.getSnapshot().active!.document.editRevision;
    act(() => controller.setViewport(canvasUuid(10), { x: -100, y: -50, zoom: 0.5 }));
    expect(controller.getSnapshot().active!.document.editRevision).toBe(revision + 1);
    switchMode("对话");
    fireEvent.change(composer(), { target: { value: "Phone chat still creates images" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0].body).toMatchObject({ prompt: "Phone chat still creates images", conversationId: "new-chat" });
    expect(sends()[0].body).not.toHaveProperty("canvasRun");
    await openCanvas();
    act(() => { desktop.matches = true; desktop.listeners.forEach((notify) => notify()); });
    expect(screen.getByRole("button", { name: "新建空白画布" })).toBeEnabled();
    expect(controller.getSnapshot().activeCanvasId).toBe(canvasUuid(10));
    expect(controls.stage!.controller).toBe(controller);
    expect(controller.getSnapshot().readOnly).toBe(false);
    expect(controller.getSnapshot().active!.scene.nodes[0]).toMatchObject({ text: "Phone canvas draft" });
  });

  it("does not share mode, local scenes or active selections across the owner A-B-A cycle", async () => {
    const view = render(<GeneratorStudio {...baseProps} />);
    const firstController = await openCanvas();
    const first = await graph(firstController);
    await act(() => firstController.flushLocal());
    serverOwner = "owner-b";
    view.rerender(<GeneratorStudio {...baseProps} ownerId="owner-b" initialPrompt="Owner B chat" />);
    expect(composer()).toHaveValue("Owner B chat");
    const secondController = await openCanvas();
    expect(secondController).not.toBe(firstController);
    expect(secondController.getSnapshot().documents).toEqual([]);
    expect(secondController.getSnapshot().activeCanvasId).toBeNull();
    switchMode("对话");
    serverOwner = "owner-a";
    view.rerender(<GeneratorStudio {...baseProps} />);
    await screen.findByRole("region", { name: "画布工作区" });
    await screen.findByRole("textbox", { name: "节点提示词" });
    expect(controls.stage!.controller!.getSnapshot().activeCanvasId).toBe(first.canvasId);
    expect(preferences.get("narra_studio_mode_v1:owner-a")).toBe("canvas");
    expect(preferences.get("narra_studio_mode_v1:owner-b")).toBe("conversation");
    expect(sends()).toEqual([]);
  });

  it("keeps unfinished phone fields above the real lazy pane, and blocks account Save on the original canvas after mode/selection changes", async () => {
    desktop.matches = false;
    render(<GeneratorStudio {...baseProps} initialPrompt="Unsent chat survives mobile editing" />);
    const controller = await openCanvas();
    const first = await graph(controller);
    fireEvent.change(screen.getByLabelText("选择画布节点"), { target: { value: first.nodeId } });
    fireEvent.click(screen.getByRole("button", { name: "编辑所选节点" }));
    const seed = await screen.findByLabelText("节点随机种子（可选）");
    act(() => seed.focus());
    fireEvent.input(seed, { target: { value: "-" } });
    await userEvent.click(screen.getByRole("button", { name: "关闭节点设置" }));
    switchMode("对话");
    expect(composer()).toHaveValue("Unsent chat survives mobile editing");
    await openCanvas();
    fireEvent.change(screen.getByLabelText("选择画布节点"), { target: { value: first.promptId } });
    let secondId = "";
    await act(async () => { secondId = await controller.newCanvas("Independent other canvas"); });
    fireEvent.click(screen.getByRole("button", { name: "保存到账户" }));
    await waitFor(() => expect(requests.filter((request) => request.method === "PUT")).toHaveLength(1));
    expect(requests.find((request) => request.method === "PUT")!.path).toContain(secondId);
    await act(() => controller.selectCanvas(first.canvasId));
    fireEvent.click(screen.getByRole("button", { name: "保存到账户" }));
    const restored = await screen.findByLabelText("节点随机种子（可选）");
    expect(restored).toHaveValue("-");
    expect(restored).toHaveFocus();
    expect(restored).toHaveAttribute("aria-invalid", "true");
    expect(requests.filter((request) => request.method === "PUT")).toHaveLength(1);
    expect(sends()).toEqual([]);
    expect(controls.stage!.controller).toBe(controller);
    fireEvent.input(restored, { target: { value: "29" } });
    fireEvent.click(screen.getByRole("button", { name: "保存到账户" }));
    await waitFor(() => expect(requests.filter((request) => request.method === "PUT")).toHaveLength(2));
    expect(server().documents.get(first.canvasId)?.scene?.nodes.find((node) => node.id === first.nodeId)).toMatchObject({ parameters: { seed: 29 } });
  });

  it("does not revoke a captured phone challenge when responsive layout or keyboard bounds change", async () => {
    desktop.matches = false;
    render(<GeneratorStudio {...baseProps} turnstile={challengeConfig} />);
    const controller = await openCanvas();
    const first = await graph(controller);
    fireEvent.change(screen.getByLabelText("选择画布节点"), { target: { value: first.nodeId } });
    fireEvent.click(screen.getByRole("button", { name: "编辑所选节点" }));
    await run();
    const dialog = modal();
    verify("phone-layout-token");
    const resets = controls.challengeResets.mock.calls.length;
    act(() => { desktop.matches = true; desktop.listeners.forEach((notify) => notify()); fireEvent(window, new Event("resize")); });
    act(() => { desktop.matches = false; desktop.listeners.forEach((notify) => notify()); fireEvent(window, new Event("orientationchange")); });
    expect(modal()).toBe(dialog);
    expect(controller.getSnapshot().readOnly).toBe(false);
    expect(controls.stage!.controller).toBe(controller);
    expect(controls.challengeResets).toHaveBeenCalledTimes(resets);
    expect(sends()).toEqual([]);
    await userEvent.click(within(dialog).getByRole("button", { name: "确认运行" }));
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(canvasSend().canvasRun).toMatchObject({ canvasId: first.canvasId, nodeId: first.nodeId });
    expect(sends()[0].body).toMatchObject({ turnstileToken: "phone-layout-token" });
  });

  it("uses saved custom providers through the server and sends one encoded node run without chat fields", async () => {
    render(<GeneratorStudio {...baseProps} savedProvider={savedProvider} initialPrompt="Unsent chat" />);
    const controller = await openCanvas();
    const target = await graph(controller);
    act(() => controller.updateParameters(target.canvasId, target.nodeId, { providerMode: "custom", channelId: null, model: "canvas-custom-model" }));
    await run();
    await screen.findByAltText("画布生成结果");
    expect(sends()).toHaveLength(1);
    expect(sends()[0].init.headers).toEqual(CANVAS_RUN_REQUEST_HEADERS);
    expect(canvasSend()).toMatchObject({ canvasRun: { canvasId: target.canvasId, nodeId: target.nodeId, input: { prompt: { sourceNodeId: target.promptId, text: "Canvas original prompt" }, references: [] }, parameters: { model: "canvas-custom-model", providerMode: "custom", generationType: "text_to_image" } } });
    for (const key of ["customProvider", "turnstileToken", "conversationId", "replaceGenerationId", "prompt"]) expect(canvasSend()).not.toHaveProperty(key);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => { switchMode("对话"); await Promise.resolve(); });
    expect(composer()).toHaveValue("Unsent chat");
    expect(screen.queryByAltText("生成图片")).not.toBeInTheDocument();
  });

  it("keeps custom credentials and frozen origin/model independent from chat and later canvas selection", async () => {
    render(<GeneratorStudio {...baseProps} initialPrompt="Keep chat draft" />);
    fireEvent.click(screen.getByRole("button", { name: "高级设置" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "自填 API" }))[0]);
    fireEvent.change(screen.getAllByLabelText("第三方 API Key")[0], { target: { value: "chat-key-not-for-canvas" } });
    const controller = await openCanvas();
    expect(screen.queryByLabelText("第三方 API Key")).not.toBeInTheDocument();
    const first = await graph(controller);
    act(() => controller.updateParameters(first.canvasId, first.nodeId, { providerMode: "custom", channelId: null, model: "captured-canvas-model" }));
    await run();
    await screen.findByRole("dialog", { name: "确认本次画布运行" });
    expect(within(modal()).getByLabelText("画布 API Key")).toHaveValue("");
    expect(sends()).toEqual([]);
    act(() => controller.updateParameters(first.canvasId, first.nodeId, { model: "later-edited-model" }));
    const next = await graph(controller);
    expect(modal()).toHaveTextContent(first.canvasId);
    expect(modal()).toHaveTextContent(first.nodeId);
    expect(modal()).toHaveTextContent("captured-canvas-model");
    fireEvent.change(within(modal()).getByLabelText("画布 Base URL"), { target: { value: "https://canvas-provider.invalid/v1" } });
    fireEvent.change(within(modal()).getByLabelText("画布 API Key"), { target: { value: "canvas-runtime-key" } });
    fireEvent.click(within(modal()).getByRole("button", { name: "确认运行" }));
    await waitFor(() => expect(sends()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(canvasSend()).toMatchObject({ canvasRun: { canvasId: first.canvasId, nodeId: first.nodeId, parameters: { model: "captured-canvas-model" } }, customProvider: { apiKey: "canvas-runtime-key", baseUrl: "https://canvas-provider.invalid/v1", model: "captured-canvas-model", remember: false } });
    expect(controller.getSnapshot().activeCanvasId).toBe(next.canvasId);
    expect(controller.getSnapshot().active!.scene.nodes.filter((node) => node.kind === "result")).toEqual([]);
    await act(() => controller.selectCanvas(first.canvasId));
    expect(await screen.findByAltText("画布生成结果")).toBeInTheDocument();
    await act(() => controller.flushLocal());
    expect(JSON.stringify([...store.rows.values()])).not.toMatch(/canvas-runtime-key|chat-key-not-for-canvas/);
    switchMode("对话");
    expect(composer()).toHaveValue("Keep chat draft");
    expect((await screen.findAllByLabelText("第三方 API Key"))[0]).toHaveValue("chat-key-not-for-canvas");
  });

  it("uses a separate per-run challenge, aborts deleted-node dialogs and ignores their late tokens", async () => {
    render(<GeneratorStudio {...baseProps} turnstile={challengeConfig} />);
    verify("chat-only-token");
    const controller = await openCanvas();
    const target = await graph(controller);
    await run();
    await screen.findByRole("dialog", { name: "确认本次画布运行" });
    expect(within(modal()).getByRole("button", { name: "确认运行" })).toBeDisabled();
    expect(sends()).toEqual([]);
    const oldVerify = controls.challengeCallbacks.at(-1)!;
    act(() => controller.removeNode(target.canvasId, target.nodeId));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(controls.challengeResets).toHaveBeenCalled();
    let nextNode = "";
    act(() => {
      nextNode = controller.addGeneration(target.canvasId, { x: 600, y: 0 });
      controller.connect(target.canvasId, target.promptId, nextNode);
    });
    await run();
    await screen.findByRole("dialog", { name: "确认本次画布运行" });
    act(() => oldVerify("obsolete-canvas-token"));
    expect(within(modal()).getByRole("button", { name: "确认运行" })).toBeDisabled();
    verify("new-canvas-token");
    fireEvent.click(within(modal()).getByRole("button", { name: "确认运行" }));
    await waitFor(() => expect(sends()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(canvasSend()).toMatchObject({ canvasRun: { nodeId: nextNode }, turnstileToken: "new-canvas-token" });
    expect(JSON.stringify([...store.rows.values()])).not.toMatch(/chat-only-token|new-canvas-token|obsolete-canvas-token/);
  });

  it("routes the stage's provider-settings action to its captured node without changing chat or submitting", async () => {
    render(<GeneratorStudio {...baseProps} initialPrompt="Chat remains built in" />);
    const controller = await openCanvas();
    const first = await graph(controller);
    act(() => {
      controller.updateParameters(first.canvasId, first.nodeId, { providerMode: "custom", channelId: null, model: "configured-model" });
      controller.selectNode(first.canvasId, first.nodeId);
    });
    fireEvent.click(await screen.findByRole("button", { name: "配置此节点的 API 凭据" }));
    const dialog = await screen.findByRole("dialog", { name: "画布渠道设置" });
    expect(dialog).toHaveTextContent(first.nodeId);
    fireEvent.change(within(dialog).getByLabelText("画布 API Key"), { target: { value: "node-settings-key" } });
    const second = await graph(controller);
    fireEvent.click(within(dialog).getByRole("button", { name: "仅在本页使用" }));
    expect(sends()).toEqual([]);
    expect(controller.getSnapshot().activeCanvasId).toBe(second.canvasId);
    await act(() => controller.selectCanvas(first.canvasId));
    await run();
    await screen.findByAltText("画布生成结果");
    expect(canvasSend()).toMatchObject({ canvasRun: { canvasId: first.canvasId, nodeId: first.nodeId }, customProvider: { apiKey: "node-settings-key", remember: false } });
    await act(async () => { switchMode("对话"); await Promise.resolve(); });
    expect(composer()).toHaveValue("Chat remains built in");
    expect(screen.queryByText(/自填 API ·/)).not.toBeInTheDocument();
    expect(JSON.stringify([...store.rows.values()])).not.toContain("node-settings-key");
  });

  it("requires a fresh widget token on canvas return and rejects callbacks from the unmounted widget", async () => {
    render(<GeneratorStudio {...baseProps} turnstile={challengeConfig} />);
    const controller = await openCanvas();
    await graph(controller);
    await run();
    await screen.findByRole("dialog", { name: "确认本次画布运行" });
    const oldVerify = controls.challengeCallbacks.at(-1)!;
    const oldExpire = controls.challengeExpires.at(-1)!;
    verify("unsubmitted-before-switch");
    expect(within(modal()).getByRole("button", { name: "确认运行" })).toBeEnabled();
    switchMode("对话");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await openCanvas();
    expect(within(modal()).getByRole("button", { name: "确认运行" })).toBeDisabled();
    act(() => oldVerify("late-from-unmounted-widget"));
    expect(within(modal()).getByRole("button", { name: "确认运行" })).toBeDisabled();
    verify("fresh-widget-token");
    act(() => oldExpire());
    expect(within(modal()).getByRole("button", { name: "确认运行" })).toBeEnabled();
    fireEvent.click(within(modal()).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sends()).toEqual([]);
  });

  it("attaches a delayed canvas acceptance while its renderer is unmounted, not to the visible chat", async () => {
    generationGate = deferred<Response>();
    render(<GeneratorStudio {...baseProps} initialPrompt="Separate chat draft" />);
    const controller = await openCanvas();
    const target = await graph(controller);
    await run();
    await waitFor(() => expect(sends()).toHaveLength(1));
    const origin = canvasSend().canvasRun;
    switchMode("对话");
    fireEvent.change(composer(), { target: { value: "Newer chat draft" } });
    const job = completedJob("late-canvas-job");
    await act(async () => {
      generationGate!.resolve(response({ generation: job, canvasRun: { canvasId: origin.canvasId, nodeId: origin.nodeId, runId: origin.runId, jobId: job.id } }));
    });
    expect(composer()).toHaveValue("Newer chat draft");
    expect(screen.queryByAltText("画布生成结果")).not.toBeInTheDocument();
    expect(controller.getSnapshot().active!.scene.runBindings).toMatchObject([{ nodeId: target.nodeId, jobId: job.id, outputsHandled: true }]);
    expect(sends()[0].init.signal!.aborted).toBe(false);
    await openCanvas();
    expect(await screen.findByAltText("画布生成结果")).toBeInTheDocument();
    expect(sends()).toHaveLength(1);
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);
  });

  it("refreshes account balance once at canvas acceptance and terminal transition without resetting either draft", async () => {
    generationGate = deferred<Response>();
    const view = render(<GeneratorStudio {...baseProps} initialPrompt="Chat balance draft" />);
    const controller = await openCanvas();
    const target = await graph(controller);
    await run();
    await waitFor(() => expect(sends()).toHaveLength(1));
    const wire = canvasSend().canvasRun;
    const origin = { canvasId: wire.canvasId, nodeId: wire.nodeId, runId: wire.runId };
    const job = canvasJob("canvas-balance-job");
    server().runs.set(wire.runId, { state: "COMMITTED", origin, jobId: job.id, generation: job, unavailable: null });
    await act(async () => generationGate!.resolve(response({ generation: job, canvasRun: { ...origin, jobId: job.id } })));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    view.rerender(<GeneratorStudio {...baseProps} currentUser={{ ...baseProps.currentUser!, credits: 499 }} initialPrompt="Refreshed server prompt" channels={[...canvasStageChannels]} />);
    expect(controller.getSnapshot().activeCanvasId).toBe(target.canvasId);
    expect(await screen.findByRole("textbox", { name: "节点提示词" })).toHaveValue("Canvas original prompt");
    switchMode("对话");
    expect(composer()).toHaveValue("Chat balance draft");
    fireEvent.change(composer(), { target: { value: "Newer independent chat" } });
    const failed = canvasJob(job.id, { status: "failed", completedAt: canvasDate, errorMessage: "Fixture failure" });
    server().runs.set(wire.runId, { state: "COMMITTED", origin, jobId: job.id, generation: failed, unavailable: null });
    await act(() => controller.refreshRuntime(target.canvasId));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(2));
    await act(() => controller.refreshRuntime(target.canvasId));
    await act(() => controller.refreshRuntime(target.canvasId));
    expect(router.refresh).toHaveBeenCalledTimes(2);
    expect(composer()).toHaveValue("Newer independent chat");
    expect(controller.getSnapshot().active!.scene.runBindings[0]).toMatchObject({ jobId: job.id, outputsHandled: true });
    expect(sends()).toHaveLength(1);
  });

  it("drops a waiting challenge and old widget callbacks when the actual root account key changes", async () => {
    const view = render(<GeneratorStudio {...baseProps} turnstile={challengeConfig} />);
    const firstController = await openCanvas();
    await graph(firstController);
    await run();
    await screen.findByRole("dialog", { name: "确认本次画布运行" });
    const staleVerify = controls.challengeCallbacks.at(-1)!;
    verify("unsubmitted-owner-a-token");
    serverOwner = "owner-b";
    view.rerender(<GeneratorStudio {...baseProps} ownerId="owner-b" turnstile={challengeConfig} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const secondController = await openCanvas();
    await graph(secondController);
    await run();
    await screen.findByRole("dialog", { name: "确认本次画布运行" });
    act(() => staleVerify("late-owner-a-token"));
    expect(within(modal()).getByRole("button", { name: "确认运行" })).toBeDisabled();
    fireEvent.click(within(modal()).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sends()).toEqual([]);
    expect(controls.challengeResets).toHaveBeenCalled();
  });

  it("keeps a viewer-owned reference lease after its card disappears, releases it on close/account change, and never offers chat edit", async () => {
    const view = render(<GeneratorStudio {...baseProps} />);
    const controller = await openCanvas();
    const target = await graph(controller);
    let referenceId = "";
    act(() => { referenceId = controller.importReference(target.canvasId, new File(["png"], "canvas.png", { type: "image/png" }), { x: 0, y: 350 }); });
    const thumbnail = await screen.findByAltText("画布参考图");
    const preview = thumbnail.getAttribute("src")!;
    fireEvent.click(screen.getByRole("button", { name: "查看参考原图" }));
    expect(await screen.findByAltText("放大查看")).toHaveAttribute("src", preview);
    expect(screen.queryByRole("button", { name: "加入编辑" })).not.toBeInTheDocument();
    act(() => controller.removeNode(target.canvasId, referenceId));
    expect(screen.queryByAltText("画布参考图")).not.toBeInTheDocument();
    expect(revokeUrls).not.toHaveBeenCalledWith(preview);
    let replacementId = "";
    act(() => { replacementId = controller.importReference(target.canvasId, new File(["png"], "replacement.png", { type: "image/png" }), { x: 0, y: 350 }); });
    const replacementPreview = (await screen.findByAltText("画布参考图")).getAttribute("src")!;
    act(() => controls.stage!.onViewImage({ kind: "reference", canvasId: target.canvasId, nodeId: replacementId, url: replacementPreview }));
    expect(revokeUrls).toHaveBeenCalledWith(preview);
    expect(screen.getByAltText("放大查看")).toHaveAttribute("src", replacementPreview);
    act(() => controller.removeNode(target.canvasId, replacementId));
    expect(revokeUrls).not.toHaveBeenCalledWith(replacementPreview);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(revokeUrls).toHaveBeenCalledWith(replacementPreview));
    act(() => { controller.importReference(target.canvasId, new File(["png"], "next.png", { type: "image/png" }), { x: 0, y: 350 }); });
    const nextPreview = (await screen.findByAltText("画布参考图")).getAttribute("src")!;
    fireEvent.click(screen.getByRole("button", { name: "查看参考原图" }));
    serverOwner = "owner-b";
    view.rerender(<GeneratorStudio {...baseProps} ownerId="owner-b" />);
    expect(revokeUrls).toHaveBeenCalledWith(nextPreview);
    expect(screen.queryByAltText("放大查看")).not.toBeInTheDocument();
  });

  it("shows canonical result metadata without chat edit and downloads through the owner-scoped proxy", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<GeneratorStudio {...baseProps} />);
    const controller = await openCanvas();
    await graph(controller);
    await run();
    await screen.findByAltText("画布生成结果");
    fireEvent.click(screen.getByRole("button", { name: "查看生成原图" }));
    expect(await screen.findByAltText("放大查看")).toHaveAttribute("src", "https://images.invalid/canvas-job-1/1.png");
    expect(within(screen.getByAltText("放大查看").parentElement!).getByText("1024x1024")).toBeInTheDocument();
    expect(screen.getByText("1:1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "加入编辑" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存高清原图" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(requests.some((request) => request.path === `/api/proxy-image?url=${encodeURIComponent("https://images.invalid/canvas-job-1/1.png")}` && request.init.signal instanceof AbortSignal)).toBe(true);
  });

  it.each(["close", "switch", "account"] as const)("isolates an in-flight modal download from a removed reference across %s", async (operation) => {
    downloadGate = deferred<Response>();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const view = render(<GeneratorStudio {...baseProps} />);
    const controller = await openCanvas();
    const target = await graph(controller);
    let referenceId = "";
    act(() => { referenceId = controller.importReference(target.canvasId, new File(["png"], "download.png", { type: "image/png" }), { x: 0, y: 350 }); });
    const preview = (await screen.findByAltText("画布参考图")).getAttribute("src")!;
    fireEvent.click(screen.getByRole("button", { name: "查看参考原图" }));
    await screen.findByAltText("放大查看");
    act(() => controller.removeNode(target.canvasId, referenceId));
    fireEvent.click(screen.getByRole("button", { name: "保存高清原图" }));
    await waitFor(() => expect(requests.some((request) => request.path === preview)).toBe(true));
    if (operation === "close") fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    else if (operation === "switch") switchMode("对话");
    else {
      serverOwner = "owner-b";
      view.rerender(<GeneratorStudio {...baseProps} ownerId="owner-b" />);
    }
    if (operation === "account") {
      expect(revokeUrls).toHaveBeenCalledWith(preview);
      expect(requests.find((request) => request.path === preview)!.init.signal!.aborted).toBe(true);
    } else expect(revokeUrls).not.toHaveBeenCalledWith(preview);
    await act(async () => downloadGate!.resolve(new Response(new Blob(["image"], { type: "image/png" }), { headers: { "content-type": "image/png" } })));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(operation === "account" ? 0 : 1));
    await waitFor(() => expect(revokeUrls).toHaveBeenCalledWith(preview));
    expect(sends()).toEqual([]);
  });

  it("retains controller/drafts when the named lazy stage fails, retries, and returns to chat", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = render(<GeneratorStudio {...baseProps} initialPrompt="Recover chat" />);
    const controller = await openCanvas();
    const target = await graph(controller);
    controls.failStage = true;
    view.rerender(<GeneratorStudio {...baseProps} initialPrompt="Changed server value" channels={[...canvasStageChannels]} />);
    expect(await screen.findByText("画布暂时无法显示")).toBeInTheDocument();
    controls.failStage = false;
    fireEvent.click(screen.getByRole("button", { name: "重试加载画布" }));
    expect(await screen.findByRole("textbox", { name: "节点提示词" })).toHaveValue("Canvas original prompt");
    expect(controls.stage!.controller).toBe(controller);
    expect(controller.getSnapshot().activeCanvasId).toBe(target.canvasId);
    controls.failStage = true;
    view.rerender(<GeneratorStudio {...baseProps} channels={[...canvasStageChannels]} />);
    await screen.findByText("画布暂时无法显示");
    fireEvent.click(screen.getByRole("button", { name: "返回对话" }));
    expect(composer()).toHaveValue("Recover chat");
    expect(sends()).toEqual([]);
    expect(logged).toHaveBeenCalled();
  });

  it("preserves unsent chat and the mounted canvas draft while a chunk failure requires manual recovery", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const view = render(<GeneratorStudio {...baseProps} initialPrompt="Keep unsent chat" />);
    const controller = await openCanvas();
    const target = await graph(controller);
    await act(() => controller.flushLocal(target.canvasId));
    controls.failStage = true;
    controls.stageFailureName = "ChunkLoadError";
    view.rerender(<GeneratorStudio {...baseProps} channels={[...canvasStageChannels]} />);
    await screen.findByText(/当前页面无法直接重试/);
    expect(screen.queryByRole("button", { name: "重试加载画布" })).not.toBeInTheDocument();
    expect(controller.getSnapshot().active?.scene.nodes.find((node) => node.id === target.promptId)).toMatchObject({ text: "Canvas original prompt" });
    expect(store.row("owner-a", target.canvasId)!.envelope.scene.nodes.find((node) => node.id === target.promptId)).toMatchObject({ text: "Canvas original prompt" });
    fireEvent.click(screen.getByRole("button", { name: "返回对话" }));
    expect(composer()).toHaveValue("Keep unsent chat");
    expect(controller.getSnapshot().activeCanvasId).toBe(target.canvasId);
    expect(sends()).toEqual([]);
  });

  it("reloads a lost-ACK local run by read-only lookup without another generation POST", async () => {
    generationGate = deferred<Response>();
    const first = render(<GeneratorStudio {...baseProps} />);
    const controller = await openCanvas();
    const target = await graph(controller);
    await run();
    await waitFor(() => expect(sends()).toHaveLength(1));
    const original = canvasSend().canvasRun;
    expect(store.row("owner-a", target.canvasId)!.envelope.outbox[0]).toMatchObject({ runId: original.runId, phase: "uncertain" });
    first.unmount();
    render(<GeneratorStudio {...baseProps} />);
    await screen.findByRole("textbox", { name: "节点提示词" });
    await waitFor(() => expect(requests.some((request) => request.path === `/api/me/canvas-runs/${original.runId}` && request.method === "GET")).toBe(true));
    expect(sends()).toHaveLength(1);
    expect(controls.stage!.controller!.getSnapshot().activeCanvasId).toBe(target.canvasId);
  });
});

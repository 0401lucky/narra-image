import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";

import { useCanvasRuntimeLease } from "@/components/create/hooks/use-canvas-runtime-lease";
import type { CanvasControllerOptions } from "@/components/create/canvas/controller";

import { canvasDate, canvasDefaults, canvasUuid } from "./helpers/canvas-controller-fixtures";

type Options = Parameters<typeof useCanvasRuntimeLease>[0];
type Input = Parameters<CanvasControllerOptions["acquireTransientLease"]>[0];
type Lease = Awaited<ReturnType<CanvasControllerOptions["acquireTransientLease"]>>;
const options: Options = { ownerId: "owner-a", enabled: true, readOnly: false, savedProvider: null, turnstile: null };
const challenge = { isEnabled: true, siteKey: "fixture-site-key", protectGenerate: true };
const savedProvider = { id: "saved-fixture", model: "saved", models: ["saved"], baseUrl: "https://saved.invalid/v1", label: "Saved", updatedAt: canvasDate };
function input(sequence = 1, overrides: Partial<Input> = {}) {
  const abort = new AbortController();
  return { abort, value: {
    origin: { ownerId: "owner-a", canvasId: canvasUuid(100), nodeId: canvasUuid(sequence), runId: canvasUuid(sequence + 1000) },
    parameters: { ...canvasDefaults }, reason: "run", signal: abort.signal, ...overrides,
  } satisfies Input };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("canvas runtime transient leases", () => {
  it.each(["built_in", "custom"] as const)("uses no browser credentials for %s with an available account provider", async (providerMode) => {
    const { result } = renderHook(() => useCanvasRuntimeLease({ ...options, savedProvider }));
    const command = input(1, { parameters: { ...canvasDefaults, providerMode } });
    const lease = await result.current.acquireTransientLease(command.value);
    expect(lease!.fields).toEqual({});
    expect(result.current.dialog).toBeNull();
    act(() => { lease!.release(); lease!.release(); });
    expect(lease!.fields).toEqual({});
  });

  it("queues challenge requests, leases one token to one captured run, and resets before the next dialog", async () => {
    const { result } = renderHook(() => useCanvasRuntimeLease({ ...options, turnstile: challenge }));
    const reset = vi.fn();
    act(() => { result.current.widgetRef.current = { reset }; });
    const first = input(1);
    const second = input(2, { reason: "transport-retry" });
    let firstPromise!: Promise<Lease>;
    let secondPromise!: Promise<Lease>;
    act(() => {
      firstPromise = result.current.acquireTransientLease(first.value);
      secondPromise = result.current.acquireTransientLease(second.value);
    });
    const firstDialog = result.current.dialog!;
    expect(firstDialog.target.nodeId).toBe(first.value.origin.nodeId);
    expect(firstDialog.verified).toBe(false);
    act(() => { result.current.verify(firstDialog.id, "first-run-token"); result.current.confirm(firstDialog.id); });
    const lease = await firstPromise;
    expect(lease!.fields).toEqual({ turnstileToken: "first-run-token" });
    expect(result.current.dialog!.busy).toBe(true);
    act(() => { result.current.verify(firstDialog.id, "late-replacement"); result.current.confirm(firstDialog.id); });
    expect(lease!.fields).toEqual({ turnstileToken: "first-run-token" });
    act(() => lease!.release());
    expect(lease!.fields).toEqual({});
    expect(reset).toHaveBeenCalledTimes(1);
    const secondDialog = result.current.dialog!;
    expect(secondDialog.target.nodeId).toBe(second.value.origin.nodeId);
    expect(secondDialog.runId).toBe(second.value.origin.runId);
    expect(secondDialog.reason).toBe("transport-retry");
    expect(secondDialog.verified).toBe(false);
    act(() => { result.current.verify(firstDialog.id, "stale-token"); result.current.confirm(firstDialog.id); });
    expect(result.current.dialog!.verified).toBe(false);
    act(() => result.current.cancel(secondDialog.id));
    await expect(secondPromise).resolves.toBeNull();
    expect(result.current.dialog).toBeNull();
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it("keeps explicit provider settings per-node and in memory, using the next run's frozen model", async () => {
    const write = vi.fn(() => { throw new Error("Credentials must not be persisted"); });
    vi.stubGlobal("localStorage", { setItem: write });
    vi.stubGlobal("fetch", write);
    const { result, unmount } = renderHook(() => useCanvasRuntimeLease(options));
    const first = input(1, { parameters: { ...canvasDefaults, providerMode: "custom", model: "first-model" } });
    act(() => result.current.openProviderSettings(first.value.origin, first.value.parameters));
    const dialog = result.current.dialog!;
    expect(dialog.reason).toBe("settings");
    expect(dialog.runId).toBeNull();
    act(() => result.current.changeProvider(dialog.id, { ...dialog.provider!, baseUrl: "https://canvas.invalid/v1", apiKey: "runtime-fixture-key", label: "Canvas only" }));
    act(() => result.current.confirm(dialog.id));
    expect(result.current.dialog).toBeNull();
    const lease = await result.current.acquireTransientLease({ ...first.value, parameters: { ...first.value.parameters, model: "frozen-run-model" } });
    expect(lease!.fields).toMatchObject({ customProvider: { apiKey: "runtime-fixture-key", baseUrl: "https://canvas.invalid/v1", label: "Canvas only", model: "frozen-run-model", remember: false } });
    const second = input(2, { parameters: { ...canvasDefaults, providerMode: "custom" } });
    let otherPromise!: Promise<Lease>;
    act(() => { otherPromise = result.current.acquireTransientLease(second.value); });
    expect(result.current.dialog!.target.nodeId).toBe(second.value.origin.nodeId);
    expect(result.current.dialog!.provider!.apiKey).toBe("");
    unmount();
    expect(lease!.fields).toEqual({});
    await expect(otherPromise).resolves.toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it("validates missing runtime credentials without resolving or losing the captured request", async () => {
    const { result } = renderHook(() => useCanvasRuntimeLease(options));
    const command = input(1, { parameters: { ...canvasDefaults, providerMode: "custom" } });
    let promise!: Promise<Lease>;
    const settled = vi.fn();
    act(() => { promise = result.current.acquireTransientLease(command.value); void promise.then(settled); });
    const dialog = result.current.dialog!;
    act(() => result.current.confirm(dialog.id));
    expect(result.current.dialog!.error).toMatch(/API Key/);
    expect(result.current.dialog!.target).toEqual(dialog.target);
    expect(settled).not.toHaveBeenCalled();
    act(() => result.current.cancel(dialog.id));
    await expect(promise).resolves.toBeNull();
  });

  it.each(["abort", "readOnly", "disabled", "unmount"])("cancels a waiting request on %s without returning any fields", async (operation) => {
    const { result, rerender, unmount } = renderHook((props: Options) => useCanvasRuntimeLease(props), { initialProps: { ...options, turnstile: challenge } });
    const command = input();
    const reset = vi.fn();
    act(() => { result.current.widgetRef.current = { reset }; });
    let promise!: Promise<Lease>;
    act(() => { promise = result.current.acquireTransientLease(command.value); });
    const id = result.current.dialog!.id;
    act(() => result.current.verify(id, "not-yet-leased"));
    if (operation === "abort") act(() => command.abort.abort());
    if (operation === "readOnly") rerender({ ...options, turnstile: challenge, readOnly: true });
    if (operation === "disabled") rerender({ ...options, turnstile: challenge, enabled: false });
    if (operation === "unmount") unmount();
    await expect(promise).resolves.toBeNull();
    expect(reset).toHaveBeenCalledTimes(1);
    if (operation !== "unmount") expect(result.current.dialog).toBeNull();
  });

  it("invalidates pending dialogs and their callbacks on owner change even if the hook is reused", async () => {
    const { result, rerender } = renderHook((props: Options) => useCanvasRuntimeLease(props), { initialProps: { ...options, turnstile: challenge } });
    let oldPromise!: Promise<Lease>;
    act(() => { oldPromise = result.current.acquireTransientLease(input().value); });
    const oldId = result.current.dialog!.id;
    const oldVerify = result.current.verify;
    rerender({ ...options, ownerId: "owner-b", turnstile: challenge });
    await expect(oldPromise).resolves.toBeNull();
    expect(result.current.dialog).toBeNull();
    const next = input(2);
    const nextInput = { ...next.value, origin: { ...next.value.origin, ownerId: "owner-b" } };
    let nextPromise!: Promise<Lease>;
    act(() => { nextPromise = result.current.acquireTransientLease(nextInput); });
    expect(result.current.dialog!.id).not.toBe(oldId);
    act(() => oldVerify(oldId, "previous-owner-token"));
    expect(result.current.dialog!.verified).toBe(false);
    act(() => result.current.cancel(result.current.dialog!.id));
    await expect(nextPromise).resolves.toBeNull();
  });

  it("rejects wrong-owner/already-aborted requests and leaves one usable manager after StrictMode remount", async () => {
    const { result } = renderHook(() => useCanvasRuntimeLease(options), { wrapper: StrictMode });
    const obsolete = input();
    obsolete.abort.abort();
    await expect(result.current.acquireTransientLease(obsolete.value)).resolves.toBeNull();
    const foreign = input();
    await expect(result.current.acquireTransientLease({ ...foreign.value, origin: { ...foreign.value.origin, ownerId: "foreign-owner" } })).resolves.toBeNull();
    const lease = await result.current.acquireTransientLease(input().value);
    expect(lease!.fields).toEqual({});
    act(() => lease!.release());
  });
});

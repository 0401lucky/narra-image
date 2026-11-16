// @vitest-environment node

const mocks = vi.hoisted(() => ({ get: vi.fn(), head: vi.fn(), open: vi.fn(), enabled: vi.fn() }));
vi.mock("@/lib/storage/image-repository", () => ({ ImageRepository: class { getByToken = mocks.get; } }));
vi.mock("@/lib/storage/managed-image-storage", () => ({ isManagedImageStorageEnabled: mocks.enabled, headManagedImage: mocks.head, openManagedImage: mocks.open }));

import { GET, HEAD } from "@/app/media/images/[token]/route";

const token = "a".repeat(64);
const context = { params: Promise.resolve({ token }) };
const image = () => ({ asset: { state: "AVAILABLE", byteLength: "3", mimeType: "image/png", sha256: "b".repeat(64) }, object: {}, location: {} });
beforeEach(() => {
  vi.resetAllMocks(); mocks.enabled.mockReturnValue(true); mocks.get.mockResolvedValue(image());
  mocks.open.mockImplementation(async () => new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } }));
});

describe("public token image reads", () => {
  it("serves exact bytes without a session cookie and with fixed MIME/nosniff", async () => {
    const response = await GET(new Request(`http://localhost/media/images/${token}`), context);
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  });
  it("HEAD proves existence without buffering file bytes", async () => {
    const response = await HEAD(new Request(`http://localhost/media/images/${token}`, { method: "HEAD" }), context);
    expect(response.status).toBe(200); expect(response.body).toBeNull();
    expect(mocks.head).toHaveBeenCalledOnce(); expect(mocks.open).not.toHaveBeenCalled();
  });
  it("checks current availability before returning a cache validator", async () => {
    const response = await GET(new Request(`http://localhost/media/images/${token}`, { headers: { "If-None-Match": `"${"b".repeat(64)}"` } }), context);
    expect(response.status).toBe(304); expect(mocks.head).toHaveBeenCalledOnce(); expect(mocks.open).not.toHaveBeenCalled();
  });
  it.each(["DELETING", "DELETED"])("returns a tombstone for %s without reading physical bytes", async (state) => {
    mocks.get.mockResolvedValue({ ...image(), asset: { ...image().asset, state } });
    expect((await GET(new Request(`http://localhost/media/images/${token}`), context)).status).toBe(410);
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("rejects noncanonical tokens before querying the ledger", async () => {
    expect((await GET(new Request("http://localhost/media/images/.."), { params: Promise.resolve({ token: ".." }) })).status).toBe(404);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("returns storage-unavailable when configuration cannot be loaded", async () => {
    mocks.open.mockRejectedValue(new Error("invalid storage config"));
    const response = await GET(new Request(`http://localhost/media/images/${token}`), context);
    expect(response.status).toBe(503); expect(await response.text()).toBe("");
  });
  it("continues reading previously registered images when new managed writes are disabled", async () => {
    mocks.enabled.mockReturnValue(false);
    const response = await GET(new Request(`http://localhost/media/images/${token}`), context);
    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(mocks.enabled).not.toHaveBeenCalled();
  });
});

// @vitest-environment node

import { checkApplicationReadiness, probeWorkerReadiness } from "@/lib/readiness";
import { IMAGE_STORAGE_REVISION, IMAGE_READER_REVISION, IMAGE_MAINTENANCE_REVISION } from "@/lib/storage/image-maintenance-types";

const images = { version: 1 as const, schema: "ready" as const, provider: "LOCAL" as const, locationId: "local-v1:00112233-4455-4677-8899-aabbccddeeff",
  storageRevision: IMAGE_STORAGE_REVISION, readerRevision: IMAGE_READER_REVISION, executorRevision: IMAGE_MAINTENANCE_REVISION, maintenance: "running" as const };
const environment = { CANVAS_ENABLED: false, IMAGE_STORAGE_MANAGED_ENABLED: true, WORKER_READINESS_REQUIRED: false, WORKER_INTERNAL_URL: "http://worker:8081", WORKER_READINESS_TIMEOUT_MS: 2000 };
const dependencies = () => ({ loadEnvironment: () => environment, logFailure: vi.fn(), pingDatabase: vi.fn().mockResolvedValue(undefined),
  probeImageStorage: vi.fn().mockResolvedValue(images), probeWorker: vi.fn().mockResolvedValue({ ready: true, images }) });

describe("managed images require a compatible worker independently of Canvas", () => {
  it("checks both runtimes even when generic Worker and Canvas dependencies are disabled", async () => {
    const probes = dependencies();
    await expect(checkApplicationReadiness(probes)).resolves.toEqual({ code: "READY", ready: true });
    expect(probes.probeWorker).toHaveBeenCalledWith({ baseUrl: environment.WORKER_INTERNAL_URL, timeoutMs: 2000, requireImages: true, expectedImages: images });
  });
  it("fails before worker handoff if the local volume or media schema probe fails", async () => {
    const probes = dependencies();
    probes.probeImageStorage.mockRejectedValue(new Error("volume unreadable"));
    await expect(checkApplicationReadiness(probes)).resolves.toEqual({ code: "IMAGE_STORAGE_UNAVAILABLE", ready: false });
    expect(probes.probeWorker).not.toHaveBeenCalled();
  });
  it.each([undefined, { ...images, locationId: "local-v1:11223344-5566-4788-99aa-bbccddeeff00" }, { ...images, provider: "S3" }])("rejects absent or mismatched runtime capability %#", async (capability) => {
    const probes = dependencies();
    probes.probeWorker.mockResolvedValue({ ready: true, images: capability });
    await expect(checkApplicationReadiness(probes)).resolves.toEqual({ code: "WORKER_NOT_READY", ready: false });
  });
  it("requires strict image capability fields on the HTTP protocol", async () => {
    const probe = (value: unknown) => probeWorkerReadiness({ baseUrl: environment.WORKER_INTERNAL_URL, timeoutMs: 100, requireImages: true, expectedImages: images,
      fetchImpl: vi.fn().mockResolvedValue(Response.json({ status: "ready", capabilities: { images: value } })) });
    await expect(probe(images)).resolves.toEqual({ ready: true, images });
    await expect(probe({ ...images, privateExtension: true })).resolves.toMatchObject({ ready: false, upstreamCode: "IMAGE_CAPABILITY_MISMATCH" });
    await expect(probe({ version: 1, schema: "ready", provider: images.provider, locationId: images.locationId })).resolves.toMatchObject({ ready: false });
    for (const field of ["storageRevision", "readerRevision", "executorRevision"]) {
      await expect(probe({ ...images, [field]: 1 })).resolves.toMatchObject({ ready: false });
      await expect(probe({ ...images, [field]: 2 })).resolves.toMatchObject({ ready: false });
    }
    await expect(probe({ ...images, maintenance: "stopped" })).resolves.toMatchObject({ ready: false });
  });
});

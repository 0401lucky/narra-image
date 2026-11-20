// @vitest-environment node

import { GenerationStatus, GenerationType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  failStale: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  serializeList: vi.fn(),
}));

vi.mock("@/lib/server/current-user", () => ({
  getCurrentUserRecord: mocks.currentUser,
}));
vi.mock("@/lib/generation/job-refund", () => ({
  failStalePendingGenerationJobs: mocks.failStale,
}));
vi.mock("@/lib/db", () => ({
  db: {
    generationJob: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
    },
  },
}));
vi.mock("@/lib/prisma-mappers", () => ({
  serializeGenerationsForClient: mocks.serializeList,
}));

import { GET as getMeGenerations } from "@/app/api/me/generations/route";
import { POST as hideGenerations } from "@/app/api/me/generations/hide/route";
import { listStudioGenerations } from "@/lib/server/studio-generations";

const user = { id: "user_1", email: "u@unit.invalid", credits: 100 };

function makeRow(id: string, createdAtIso: string, status: GenerationStatus = GenerationStatus.SUCCEEDED) {
  return {
    id,
    userId: user.id,
    createdAt: new Date(createdAtIso),
    status,
    generationType: GenerationType.TEXT_TO_IMAGE,
    images: [],
    videos: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.currentUser.mockResolvedValue(user);
  mocks.failStale.mockResolvedValue(undefined);
  mocks.serializeList.mockImplementation(async (rows: Array<{ id: string }>) =>
    rows.map((row) => ({ id: row.id, prompt: `prompt ${row.id}`, status: "succeeded", count: 1, creditsSpent: 5, images: [] })),
  );
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("studio flat generation records loader & APIs", () => {
  it("lists non-hidden image jobs with keyset cursor pagination", async () => {
    mocks.findMany.mockResolvedValue([
      makeRow("job_3", "2026-11-20T09:00:00.000Z"),
      makeRow("job_2", "2026-11-20T08:00:00.000Z"),
      makeRow("job_1", "2026-11-20T07:00:00.000Z"),
    ]);

    const page = await listStudioGenerations({ ownerId: user.id, limit: 2 });
    expect(page.generations.map((g) => g.id)).toEqual(["job_3", "job_2"]);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBeTruthy();

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: user.id,
          studioHiddenAt: null,
          generationType: { in: [GenerationType.TEXT_TO_IMAGE, GenerationType.IMAGE_TO_IMAGE] },
        }),
        take: 3,
      }),
    );

    // Rejects cursor belonging to a different owner
    const foreignRequest = new Request(`https://app.unit.invalid/api/me/generations?scope=studio&cursor=${page.nextCursor}`);
    mocks.currentUser.mockResolvedValue({ ...user, id: "user_other" });
    const rejected = await getMeGenerations(foreignRequest);
    expect(rejected.status).toBe(400);
  });

  it("GET /api/me/generations?scope=studio returns paginated studio payload", async () => {
    mocks.findMany.mockResolvedValue([makeRow("job_1", "2026-11-20T09:00:00.000Z")]);
    const response = await getMeGenerations(new Request("https://app.unit.invalid/api/me/generations?scope=studio&limit=10"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        generations: [{ id: "job_1" }],
        hasMore: false,
        nextCursor: null,
      },
    });
  });

  it("POST /api/me/generations/hide marks only terminal owned jobs with studioHiddenAt and skips pending jobs", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "job_done", status: GenerationStatus.SUCCEEDED },
      { id: "job_fail", status: GenerationStatus.FAILED },
      { id: "job_running", status: GenerationStatus.PENDING },
    ]);

    const response = await hideGenerations(
      new Request("https://app.unit.invalid/api/me/generations/hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["job_done", "job_fail", "job_running", "job_done"] }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        hiddenIds: ["job_done", "job_fail"],
        skippedPendingIds: ["job_running"],
      },
    });
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["job_done", "job_fail"] },
          userId: user.id,
          studioHiddenAt: null,
        }),
        data: { studioHiddenAt: expect.any(Date) },
      }),
    );
  });

  it("POST /api/me/generations/hide requires auth and valid non-empty ids", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const unauth = await hideGenerations(
      new Request("https://app.unit.invalid/api/me/generations/hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["job_1"] }),
      }),
    );
    expect(unauth.status).toBe(401);

    mocks.currentUser.mockResolvedValue(user);
    const empty = await hideGenerations(
      new Request("https://app.unit.invalid/api/me/generations/hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [] }),
      }),
    );
    expect(empty.status).toBe(400);
  });
});

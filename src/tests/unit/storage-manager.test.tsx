import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StorageManager } from "@/components/admin/storage/storage-manager";
import { cleanupJob, cleanupPreview, storageFixtureIds, storageOverview, storagePolicy } from "./helpers/storage-management-fixtures";

const fetcher = vi.fn<typeof fetch>();
const ok = (data: unknown) => Response.json({ data });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetcher);
  window.history.replaceState({}, "", "/admin/settings/storage");
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("image storage management", () => {
  it("shows decimal byte usage and gates cleanup behind explicit policy enablement", () => {
    render(<StorageManager initialOverview={storageOverview({ policy: storagePolicy({ enabled: false }) })} initialJob={null} />);
    expect(screen.getByTestId("storage-used")).toHaveTextContent("2.30 GB");
    expect(screen.getByTestId("storage-used")).toHaveAttribute("data-bytes", "2306867200");
    expect(screen.getByTestId("storage-unmanaged")).toHaveTextContent("7 张");
    expect(screen.getByRole("checkbox", { name: "启用定时清理" })).not.toBeChecked();
    expect(screen.getByLabelText("保留天数")).toHaveValue(30);
    expect(screen.getByLabelText("清理间隔（小时）")).toHaveValue(24);
    expect(screen.getByRole("button", { name: "预览清理" })).toBeDisabled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("lets an admin cancel preview without submitting deletion", async () => {
    const user = userEvent.setup();
    fetcher.mockResolvedValue(ok(cleanupPreview()));
    render(<StorageManager initialOverview={storageOverview()} initialJob={null} />);
    await user.selectOptions(screen.getByLabelText("清理范围"), "MANUAL_ALL");
    await user.click(screen.getByRole("button", { name: "预览清理" }));
    expect(await screen.findByRole("region", { name: "清理预览" })).toHaveTextContent("预计清理 2 张图片、2 份文件，释放 200.00 MB");
    await user.click(screen.getByRole("button", { name: "取消预览" }));
    expect(screen.queryByRole("region", { name: "清理预览" })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.every(([path]) => String(path).endsWith("/preview"))).toBe(true);
  });

  it("reuses confirmation identity after an unknown response and reports actual completion", async () => {
    const user = userEvent.setup();
    const confirmations: Array<Record<string, unknown>> = [];
    fetcher.mockImplementation(async (path, init) => {
      if (String(path).endsWith("/preview")) return ok(cleanupPreview());
      if (String(path).endsWith("/cleanup")) {
        confirmations.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (confirmations.length === 1) throw new Error("连接中断，请使用原预览重试");
        return ok(cleanupJob());
      }
      if (String(path).includes("/jobs/")) return ok(cleanupJob({ state: "SUCCEEDED", completedItems: 2, pendingItems: 0, releasedBytes: "200000000" }));
      return ok(storageOverview({ usedBytes: "2106867200" }));
    });
    render(<StorageManager initialOverview={storageOverview()} initialJob={null} />);
    await user.click(screen.getByRole("button", { name: "预览清理" }));
    await user.click(await screen.findByRole("button", { name: "确认清理" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("连接中断");
    await user.click(screen.getByRole("button", { name: "确认清理" }));
    expect(await screen.findByTestId("storage-job")).toHaveAttribute("data-state", "QUEUED");
    expect(confirmations).toHaveLength(2);
    expect(confirmations[1]).toEqual(confirmations[0]);
    expect(confirmations[0]).toMatchObject({ previewId: storageFixtureIds.job, expectedPolicyVersion: 1 });
    expect(new URL(window.location.href).searchParams.get("job")).toBe(storageFixtureIds.job);
    await waitFor(() => expect(screen.getByTestId("storage-job")).toHaveAttribute("data-state", "SUCCEEDED"), { timeout: 5000 });
    expect(screen.getByTestId("storage-job-released")).toHaveTextContent("200.00 MB");
    expect(screen.getByTestId("storage-used")).toHaveAttribute("data-bytes", "2106867200");
  });

  it("requires a fresh preview after policy or expiration conflicts", async () => {
    const user = userEvent.setup();
    fetcher.mockImplementation(async (path) => String(path).endsWith("/preview")
      ? ok(cleanupPreview()) : Response.json({ code: "IMAGE_PREVIEW_EXPIRED", error: "清理预览已过期，请重新预览" }, { status: 409 }));
    render(<StorageManager initialOverview={storageOverview()} initialJob={null} />);
    await user.click(screen.getByRole("button", { name: "预览清理" }));
    await user.click(await screen.findByRole("button", { name: "确认清理" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("清理预览已过期");
    expect(screen.queryByRole("button", { name: "确认清理" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("storage-job")).not.toBeInTheDocument();
  });

  it("reloads the saved policy explicitly after a CAS conflict without silently replacing edits", async () => {
    const user = userEvent.setup();
    const submitted: Array<Record<string, unknown>> = [];
    fetcher.mockImplementation(async (_path, init) => {
      if (init?.method === "PATCH") {
        submitted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return submitted.length === 1
          ? Response.json({ code: "IMAGE_POLICY_CONFLICT", error: "策略已变化，请重新载入策略" }, { status: 409 })
          : ok(storagePolicy({ version: 3, limitBytes: "6000000000" }));
      }
      return ok(storageOverview({ policy: storagePolicy({ version: 2, limitBytes: "6000000000" }) }));
    });
    render(<StorageManager initialOverview={storageOverview()} initialJob={null} />);
    await user.clear(screen.getByLabelText("容量上限（GB）"));
    await user.type(screen.getByLabelText("容量上限（GB）"), "4.5");
    await user.click(screen.getByRole("button", { name: "保存清理策略" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("策略已变化");
    expect(screen.getByLabelText("容量上限（GB）")).toHaveValue("4.5");
    await user.click(screen.getByRole("button", { name: "重新载入策略" }));
    expect(screen.getByLabelText("容量上限（GB）")).toHaveValue("6");
    await user.click(screen.getByRole("button", { name: "保存清理策略" }));
    expect(submitted[0]).toMatchObject({ expectedVersion: 1, limitBytes: "4500000000" });
    expect(submitted[1]).toMatchObject({ expectedVersion: 2, limitBytes: "6000000000" });
  });

  it("resumes a queued task after reload, exposes polling errors and stops further cleanup", async () => {
    const user = userEvent.setup();
    fetcher.mockImplementation(async (path, init) => {
      if (init?.method === "POST") return ok(cleanupJob({ state: "CANCELLED", pendingItems: 0, skippedItems: 2 }));
      if (String(path).includes("/jobs/")) throw new Error("暂时无法读取进度");
      return ok(storageOverview());
    });
    render(<StorageManager initialOverview={storageOverview()} initialJob={cleanupJob()} />);
    expect(await screen.findByText("进度读取暂时失败", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(within(screen.getByTestId("storage-job")).getByRole("button", { name: "刷新进度" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "停止后续清理" }));
    expect(screen.getByTestId("storage-job")).toHaveAttribute("data-state", "CANCELLED");
    expect(screen.getByTestId("storage-job-released")).toHaveAttribute("data-bytes", "0");
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST").map(([path]) => String(path))).toEqual([`/api/admin/storage/jobs/${storageFixtureIds.job}/cancel`]);
  });
});

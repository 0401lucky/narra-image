import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createSessionToken } from "../../../../src/lib/auth/session-token.ts";
import { SESSION_COOKIE_NAME } from "../../../../src/lib/constants.ts";
import { waitFor } from "./cdp.mjs";
import { openRetentionBrowser, selectNativeOption } from "./browser-driver.mjs";
import { createRetentionFixture } from "./retention-fixture.mjs";

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const terminal = new Set(["SUCCEEDED", "PARTIAL", "CANCELLED", "EXPIRED"]);

export async function runRetentionProof(context) {
  const { request, sql, env, ownerRoot, ownerId, cookie, fixture, bytes, imageDirectory } = context;
  const evidence = path.join(ownerRoot, "receipts", `retention-browser-${randomUUID()}`);
  mkdirSync(evidence);
  const adminId = randomUUID();
  await sql(`INSERT INTO "User" (id,email,role,credits,"updatedAt") VALUES (${literal(adminId)},${literal(`${adminId}@fixture.invalid`)},'ADMIN',100,clock_timestamp()); SELECT to_json(true);`);
  const adminCookie = `${SESSION_COOKIE_NAME}=${await createSessionToken({ userId: adminId, role: "admin" }, env.AUTH_SECRET)}`;
  const json = async (route, method = "GET", body, session = adminCookie, expected = 200) => {
    const response = await request(route, { method, headers: { ...(session ? { cookie: session } : {}), "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, expected, `${method} ${route}: ${response.bytes.toString().slice(0, 500)}`);
    return JSON.parse(response.bytes.toString());
  };
  const results = [];
  let browser;
  let workerStopped = false;
  const record = async (name, operation) => {
    const startedAt = Date.now();
    try {
      const detail = await operation();
      results.push({ name, passed: true, durationMs: Date.now() - startedAt, detail });
    } catch (error) {
      results.push({ name, passed: false, durationMs: Date.now() - startedAt, error: error.stack });
      await browser?.page.screenshot(path.join(evidence, `${name}-failure.png`), true).catch(() => {});
      throw error;
    } finally {
      writeFileSync(path.join(evidence, "checks.json"), JSON.stringify(results, null, 2) + "\n");
    }
  };
  try {
    await record("admin-permissions", async () => {
      await json("/api/admin/storage", "GET", undefined, "", 401);
      await json("/api/admin/storage", "GET", undefined, cookie, 403);
      for (const [route, method] of [["/api/admin/storage/policy", "PATCH"], ["/api/admin/storage/cleanup/preview", "POST"], ["/api/admin/storage/cleanup", "POST"]]) {
        await json(route, method, {}, cookie, 403);
      }
      return { unauthenticated: 401, ordinaryUser: 403 };
    });
    const key = `proof/retention-${randomUUID()}.png`;
    const seeded = createRetentionFixture({ ownerId, locationId: `local-v1:${fixture.volumeId}`, key,
      byteLength: bytes.length, mimeType: "image/png", sha256: fixture.sha256, publicUrlOrigin: env.APP_URL });
    // Seed one known historical file inside the disposable fixture volume. This
    // sets up deletion evidence; C1 separately exercises the actual PUT paths.
    const resolvedDirectory = realpathSync(imageDirectory);
    const relativeDirectory = path.relative(realpathSync(ownerRoot), resolvedDirectory);
    assert(relativeDirectory && !relativeDirectory.startsWith("..") && !path.isAbsolute(relativeDirectory));
    assert(!lstatSync(imageDirectory).isSymbolicLink());
    const physicalFile = path.join(resolvedDirectory, `image-${createHash("sha256").update(key).digest("hex")}.bin`);
    writeFileSync(physicalFile, bytes, { flag: "wx", mode: 0o600 });
    await sql(`${seeded.sql}\nSELECT to_json(true);`);
    await waitFor(() => sql(`SELECT to_json("writeExpiresAt" < clock_timestamp()) FROM "ImageObject" WHERE id=${literal(seeded.objectId)}::uuid;`),
      { timeout: 15_000, message: "The fixture's original bounded writer lease did not expire" });
    assert.deepEqual(readFileSync(physicalFile), bytes);
    const before = (await json("/api/admin/storage")).data;
    assert.equal(before.cleanableBytes, String(bytes.length));
    assert.equal(before.policy.enabled, false);
    assert.equal(before.policy.scheduleEnabled, false);
    const initialFacts = await sql(`SELECT json_build_object('credits',(SELECT credits FROM "User" WHERE id=${literal(ownerId)}),'status',(SELECT status FROM "GenerationJob" WHERE id=${literal(seeded.jobId)}),'prompt',(SELECT prompt FROM "GenerationJob" WHERE id=${literal(seeded.jobId)}));`);

    browser = await openRetentionBrowser({ ...context, evidence });
    await browser.session(adminCookie);
    const page = browser.page;
    const confirmations = [];
    page.cdp.on("Network.requestWillBeSent", ({ request: outgoing }) => {
      if (outgoing.method === "POST" && outgoing.url === `${context.base}/api/admin/storage/cleanup` && outgoing.postData) {
        confirmations.push(JSON.parse(outgoing.postData));
      }
    });
    await record("native-policy-and-preview-cancel", async () => {
      await page.navigate("/admin/settings/storage");
      await page.ready('[data-testid="storage-manager"]');
      assert.equal(await page.cdp.evaluate('document.querySelector("#storage-schedule").checked'), false);
      assert.equal(await page.cdp.evaluate('document.querySelector("[data-testid=storage-used]").dataset.bytes'), before.usedBytes);
      await page.click('label[for="storage-enabled"]');
      await page.type("#storage-retention-days", "14");
      await page.type("#storage-interval-hours", "12");
      await page.click("button", "保存清理策略");
      await waitFor(() => page.cdp.evaluate('document.body.innerText.includes("清理策略已保存")'));
      const policy = (await json("/api/admin/storage")).data.policy;
      assert.equal(policy.enabled, true);
      assert.equal(policy.retentionDays, 14);
      assert.equal(policy.intervalSeconds, 43200);
      assert.equal(policy.scheduleEnabled, false);
      await page.click("button", "预览清理");
      await page.ready('[data-testid="storage-preview"]');
      assert.match(await page.cdp.evaluate('document.querySelector("[data-testid=storage-preview]").innerText'), /预计清理 1 张图片、1 份文件/);
      await page.screenshot(path.join(evidence, "desktop-preview.png"), true);
      await page.click("button", "取消预览");
      assert.equal(await page.cdp.evaluate('Boolean(document.querySelector("[data-testid=storage-preview]"))'), false);
      assert.equal(confirmations.length, 0);
      assert(existsSync(physicalFile));
      assert.equal((await json("/api/admin/storage")).data.usedBytes, before.usedBytes);
      return { policyVersion: policy.version, previewDidNotDelete: true, nativeCancel: true };
    });

    let maintenanceJobId;
    let confirmation;
    await record("native-confirm-and-close-browser", async () => {
      await selectNativeOption(page, "#storage-cleanup-mode", "MANUAL_ALL");
      await page.click("button", "预览清理");
      await page.ready('[data-testid="storage-preview"]');
      // Stop only this fixture's worker before confirmation, making browser
      // closure and process recovery observable without a millisecond race.
      await context.stopWorker();
      workerStopped = true;
      await page.click("button", "确认清理");
      await page.ready('[data-testid="storage-job"]');
      maintenanceJobId = await page.cdp.evaluate('document.querySelector("[data-testid=storage-job]").dataset.jobId');
      assert.match(maintenanceJobId, /^[a-f0-9-]{36}$/);
      assert.equal(await page.cdp.evaluate('document.querySelector("[data-testid=storage-job]").dataset.state'), "QUEUED");
      assert.equal(confirmations.length, 1);
      confirmation = confirmations[0];
      assert(existsSync(physicalFile));
      await browser.close();
      browser = null;
      await context.restartWorker();
      workerStopped = false;
      return { jobId: maintenanceJobId, browserClosedBeforeExecution: true, fixtureWorkerRestarted: true };
    });

    let completed;
    await record("background-physical-delete-and-replay", async () => {
      completed = await waitFor(async () => {
        const job = (await json(`/api/admin/storage/jobs/${maintenanceJobId}`)).data;
        return terminal.has(job.state) ? job : null;
      }, { timeout: 150_000, message: "Durable cleanup did not finish after the original executor lease expired" });
      assert.equal(completed.state, "SUCCEEDED", JSON.stringify(completed));
      assert.equal(completed.releasedBytes, String(bytes.length));
      assert.equal(completed.completedItems, 1);
      assert.equal(completed.failedItems, 0);
      assert(!existsSync(physicalFile));
      const after = (await json("/api/admin/storage")).data;
      assert.equal(BigInt(before.usedBytes) - BigInt(after.usedBytes), BigInt(bytes.length));
      const replay = (await json("/api/admin/storage/cleanup", "POST", confirmation)).data;
      assert.equal(replay.id, maintenanceJobId);
      assert.equal(replay.releasedBytes, completed.releasedBytes);
      assert.equal((await json("/api/admin/storage")).data.usedBytes, after.usedBytes);
      const currentFacts = await sql(`SELECT json_build_object('credits',(SELECT credits FROM "User" WHERE id=${literal(ownerId)}),'status',(SELECT status FROM "GenerationJob" WHERE id=${literal(seeded.jobId)}),'prompt',(SELECT prompt FROM "GenerationJob" WHERE id=${literal(seeded.jobId)}));`);
      assert.deepEqual(currentFacts, initialFacts);
      const media = await request(`/media/images/${seeded.publicToken}`);
      assert.equal(media.status, 410);
      await json(`/api/admin/storage/jobs/${maintenanceJobId}`, "GET", undefined, cookie, 403);
      return { releasedBytes: completed.releasedBytes, physicalFileMissing: true, replayReleasedNoAdditionalBytes: true,
        jobAndPromptAndCreditsUnchanged: true, mediaStatus: media.status };
    });

    browser = await openRetentionBrowser({ ...context, evidence });
    await browser.session(adminCookie);
    await record("reload-same-job-and-responsive-results", async () => {
      await browser.page.navigate(`/admin/settings/storage?job=${maintenanceJobId}`);
      await browser.page.ready('[data-testid="storage-job"]');
      assert.equal(await browser.page.cdp.evaluate('document.querySelector("[data-testid=storage-job]").dataset.jobId'), maintenanceJobId);
      assert.equal(await browser.page.cdp.evaluate('document.querySelector("[data-testid=storage-job-released]").dataset.bytes'), String(bytes.length));
      assert.equal(browser.page.requests.filter((outgoing) => outgoing.method === "POST" && outgoing.url.endsWith("/api/admin/storage/cleanup")).length, 0);
      await browser.page.screenshot(path.join(evidence, "desktop-completed.png"), true);
      await browser.page.viewport(390, 844, true);
      await browser.page.screenshot(path.join(evidence, "mobile-completed.png"), true);
      assert.equal(await browser.page.cdp.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
      assert.deepEqual(browser.page.errors, []);
      return { sameJobId: true, noDuplicateConfirmation: true, mobileWidth: 390, horizontalOverflow: false };
    });
    await record("owner-history-cleaned-state", async () => {
      const generation = (await json(`/api/me/generations/${seeded.jobId}`, "GET", undefined, cookie)).data.generation;
      assert.equal(generation.status, "succeeded");
      assert.equal(generation.prompt, initialFacts.prompt);
      assert.equal(generation.images.find((image) => image.id === seeded.imageId)?.availability, "cleaned");
      await browser.session(cookie);
      await browser.page.viewport(1440, 1000);
      await browser.page.navigate("/works");
      const card = `[data-work-id=${JSON.stringify(seeded.imageId)}]`;
      await browser.page.ready(card);
      const cardState = await browser.page.cdp.evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(card)});
        return { availability: node.dataset.availability, text: node.innerText, images: node.querySelectorAll('img').length,
          downloadDisabled: node.querySelector('button[aria-label="下载作品"]')?.disabled };
      })()`);
      assert.equal(cardState.availability, "cleaned");
      assert.match(cardState.text, /图片已清理/);
      assert.equal(cardState.images, 0);
      assert.equal(cardState.downloadDisabled, true);
      await browser.page.screenshot(path.join(evidence, "owner-history.png"), true);
      await browser.page.navigate(`/works/${seeded.imageId}`);
      await browser.page.ready('[data-testid="work-image"]');
      const detail = await browser.page.cdp.evaluate(`(() => {
        const image = document.querySelector('[data-testid="work-image"]');
        const download = [...document.querySelectorAll('button')].find(node => node.textContent.includes('下载图片'));
        return { availability: image.dataset.availability, text: image.innerText, images: image.querySelectorAll('img').length,
          downloadDisabled: download?.disabled };
      })()`);
      assert.equal(detail.availability, "cleaned");
      assert.match(detail.text, /图片已清理/);
      assert.equal(detail.images, 0);
      assert.equal(detail.downloadDisabled, true);
      await browser.page.screenshot(path.join(evidence, "owner-detail.png"), true);
      assert.deepEqual(browser.page.errors, []);
      return { generationStatus: generation.status, formalAvailability: "cleaned", originalPromptRetained: true,
        cardAndDetailPlaceholders: true, cardAndDetailDownloadsDisabled: true };
    });
    writeFileSync(path.join(evidence, "fixture.json"), JSON.stringify({ imageId: seeded.imageId, assetId: seeded.assetId,
      jobId: seeded.jobId, maintenanceJobId, byteLength: bytes.length, beforeUsedBytes: before.usedBytes }, null, 2) + "\n");
    console.log(JSON.stringify({ retentionBrowser: "passed", evidence, checks: results.length,
      realNextAndWorker: true, fakeProductRoutes: false, browserClosedBeforeCleanup: true }));
  } finally {
    if (browser) await browser.close();
    if (workerStopped) await context.restartWorker();
  }
}

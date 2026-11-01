import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserPage, Cdp, delay, waitFor } from "./cdp.mjs";
import { buildIdentity, FIXED_GUARD_SHA256, helperIdentity } from "./input-identity.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../../../../..");
const app = await realpath(process.cwd());
const runtime = await realpath(path.resolve(here, "../.runtime"));
assert(path.relative(runtime, app) && !path.relative(runtime, app).startsWith("..") && path.basename(app) === "app", "Only an owned G0 snapshot may serve the fixture");
const manifest = JSON.parse(await readFile(path.join(app, "homepage-fixture-manifest.json"), "utf8"));
const config = JSON.parse(await readFile(path.join(app, "src/lib/homepage-fixture-config.json"), "utf8"));
const mode = process.argv.includes("--baseline") ? "baseline" : process.argv.includes("--privacy") ? "privacy" : process.argv.includes("--reference") ? "reference" : process.argv.includes("--diagnostic") ? "diagnostic" : process.argv.includes("--home") ? "home" : "full";
const filterIndex = process.argv.indexOf("--filter");
const checkFilter = filterIndex >= 0 ? new RegExp(process.argv[filterIndex + 1]) : null;
const runId = `${mode}-${Date.now()}`;
const evidence = path.join(here, "evidence", runId);
await mkdir(evidence, { recursive: true });
const profile = path.join(path.dirname(app), `chrome-${runId}`);
await mkdir(profile);
const checks = [];
const children = [];
const authSecret = randomBytes(32).toString("hex");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const helperInputs = await helperIdentity(here);
const builtArtifacts = await buildIdentity(app);
const buildId = (await readFile(path.join(app, ".next/BUILD_ID"), "utf8")).trim();
const guardFile = path.join(path.dirname(app), "tools/deny_env.cjs");
const guardHash = sha(await readFile(guardFile));
const fixtureConfigHash = sha(await readFile(path.join(app, "src/lib/homepage-fixture-config.json")));
const safeName = (value) => value.replace(/[^a-z0-9_-]/gi, "-");
const environment = { ...process.env, NODE_ENV: "production", AUTH_SECRET: authSecret, APP_URL: "https://homepage-browser.invalid", CANVAS_ENABLED: "true", NEXT_TELEMETRY_DISABLED: "1" };
let browser;
let currentPage;
let origin;

function token(userId) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ userId, role: userId === "home-admin" ? "admin" : "user", iat: now, exp: now + 3600 })).toString("base64url");
  return `${header}.${body}.${createHmac("sha256", authSecret).update(`${header}.${body}`).digest("base64url")}`;
}

async function sourceIdentity(stage) {
  const drift = [];
  const privacyScope = new Set(["src/app/works/[id]/page.tsx", "src/components/works/work-detail-panel.tsx", "src/lib/prisma-mappers.ts", "src/lib/server/works.ts", "src/lib/work-showcase.ts"]);
  for (const [file, hash] of Object.entries(manifest.production)) {
    const expected = manifest.replacements[file]?.sha256 ?? hash;
    if (sha(await readFile(path.join(app, file))) !== expected) drift.push(`snapshot:${file}`);
    if (mode !== "baseline" && mode !== "reference" && !file.startsWith("src/tests/") && (mode !== "privacy" || privacyScope.has(file)) && sha(await readFile(path.join(repository, file))) !== hash) drift.push(`live:${file}`);
  }
  for (const [file, receipt] of Object.entries(manifest.replacements)) {
    if (sha(await readFile(path.join(app, file))) !== receipt.sha256) drift.push(`replacement:${file}`);
  }
  for (const [file, record] of Object.entries(helperInputs)) if (sha(await readFile(path.join(here, file))) !== record.sha256) drift.push(`helper:${file}`);
  if (manifest.helperInputs && JSON.stringify(helperInputs) !== JSON.stringify(manifest.helperInputs)) drift.push("helper:changed-after-pre-build");
  const artifacts = await buildIdentity(app);
  if (artifacts.sha256 !== builtArtifacts.sha256) drift.push("build:immutable-output");
  if ((await readFile(path.join(app, ".next/BUILD_ID"), "utf8")).trim() !== buildId) drift.push("build:BUILD_ID");
  if (sha(await readFile(guardFile)) !== guardHash) drift.push("guard:deny_env.cjs");
  if (guardHash !== FIXED_GUARD_SHA256) drift.push("guard:fixed-G0-sha256");
  if (sha(await readFile(path.join(app, "src/lib/homepage-fixture-config.json"))) !== fixtureConfigHash) drift.push("fixture:config");
  if ((config.heroAssets ?? []).some((asset) => asset.available) && guardHash !== sha(await readFile(path.join(here, "../deny_env.cjs")))) drift.push("guard:current-fixed-source-mismatch");
  await writeFile(path.join(evidence, `source-${stage}.json`), JSON.stringify({ stage, productInputs: Object.keys(manifest.production).length, liveScope: mode === "privacy" ? [...privacyScope] : mode === "baseline" || mode === "reference" ? "recorded exact before-images" : "all recorded production inputs except source-test files", helperInputs, buildId, builtArtifacts: artifacts, fixtureInputs: manifest.replacements, fixtureConfigHash, guardHash, heroAssets: config.heroAssets ?? [], drift }, null, 2));
  assert.deepEqual(drift, [], `${stage} source identities changed`);
}

async function check(id, operation) {
  if (checkFilter && !checkFilter.test(id)) return;
  const started = Date.now();
  try {
    const detail = await operation();
    checks.push({ id, passed: true, durationMs: Date.now() - started, detail });
    console.log(`PASS ${id}`);
  } catch (error) {
    checks.push({ id, passed: false, durationMs: Date.now() - started, error: error.stack ?? String(error) });
    console.error(`FAIL ${id}: ${error.message}`);
    if (currentPage) await currentPage.screenshot(path.join(evidence, `${safeName(id)}-failure.png`)).catch(() => {});
    if (currentPage) {
      const state = await currentPage.cdp.evaluate("({url:location.href,hidden:document.hidden,motion:document.querySelector('[data-homepage]')?.dataset,active:document.activeElement?.outerHTML?.slice(0,500),reveals:[...document.querySelectorAll('[data-home-reveal]')].slice(0,10).map(el=>({opacity:getComputedStyle(el).opacity,transform:getComputedStyle(el).transform,rect:el.getBoundingClientRect().toJSON()}))})").catch(() => null);
      await writeFile(path.join(evidence, `${safeName(id)}-failure-state.json`), JSON.stringify(state, null, 2));
      const native = await currentPage.cdp.evaluate(`(()=>{const frame=document.querySelector('[data-home-hero-frame]'),root=document.querySelector('[data-homepage]');return {trace:window.__nativeInputTrace,copies:window.__heroCopies,motion:root?{active:root.dataset.motionActive,paused:root.dataset.motionPaused,reduced:root.dataset.motionReduced}:null,frame:frame?{transform:getComputedStyle(frame).transform,pointer:frame.dataset.pointerActive,rx:frame.style.getPropertyValue('--rotate-x'),ry:frame.style.getPropertyValue('--rotate-y')}:null,buttons:frame?[...frame.querySelectorAll('button')].map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,rect:r.toJSON(),stack:document.elementsFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2).slice(0,6).map(n=>({tag:n.tagName,classes:n.className,text:n.textContent?.slice(0,80),transform:getComputedStyle(n).transform,z:getComputedStyle(n).zIndex}))}}):[]}})()`).catch(() => null);
      await writeFile(path.join(evidence, `${safeName(id)}-native-input-diagnostic.json`), JSON.stringify(native, null, 2));
    }
  }
  if (currentPage) await writeFile(path.join(evidence, `${safeName(id)}-network.json`), JSON.stringify({ requests: currentPage.requests, errors: currentPage.errors, blockedExternal: currentPage.externalRequests, pointApproaches: currentPage.pointApproaches }, null, 2));
  await writeFile(path.join(evidence, "checks.json"), JSON.stringify(checks, null, 2));
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function start(binary, argv, name) {
  const child = spawn(binary, argv, { cwd: app, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(createWriteStream(path.join(evidence, `${name}.stdout.log`)));
  child.stderr.pipe(createWriteStream(path.join(evidence, `${name}.stderr.log`)));
  children.push(child);
  return child;
}

async function request(url, options = {}) {
  const target = new URL(url, origin);
  assert.equal(target.origin, origin, "Fixture HTTP cannot leave loopback origin");
  return fetch(target, { ...options, redirect: "manual", signal: AbortSignal.timeout(15000) });
}

async function control(input = null) {
  const response = await request("/homepage-fixture/control", {
    method: input ? "POST" : "GET",
    headers: { "x-homepage-fixture": config.controlToken, ...(input ? { "content-type": "application/json" } : {}) },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  assert.equal(response.status, 200, "Fixture control must be usable only via its local guard");
  return response.json();
}

async function page(userId = null) {
  if (currentPage) {
    await currentPage.flushBodies();
    currentPage.dispose();
    await browser.send("Target.closeTarget", { targetId: currentPage.targetId });
    currentPage.cdp.close();
  }
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  await browser.send("Target.activateTarget", { targetId });
  const tabs = await (await fetch(`${origin.replace(/:\d+$/, `:${browser.port}`)}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const target = tabs.find((entry) => entry.id === targetId);
  assert(target?.webSocketDebuggerUrl, "Owned Chrome target available");
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  const result = new BrowserPage(cdp, origin);
  result.targetId = targetId;
  await result.initialize();
  await cdp.send("Network.clearBrowserCookies");
  if (userId) await cdp.send("Network.setCookie", { name: "narra_session", value: token(userId), url: origin, httpOnly: true, sameSite: "Lax" });
  currentPage = result;
  return result;
}

function decodedFlight(raw) {
  if (!raw.includes("<html")) return raw;
  const chunks = [];
  for (const script of raw.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    const start = "self.__next_f.push(";
    const text = script[1];
    if (!text.startsWith(start) || !text.endsWith(")")) continue;
    try { const payload = JSON.parse(text.slice(start.length, -1)); if (payload[0] === 1) chunks.push(payload[1]); } catch { /* Non-flight bootstrap script. */ }
  }
  return chunks.join("");
}

function workPayloads(raw) {
  const output = [];
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value) && "isOwner" in value && value.work && typeof value.work === "object") output.push(value);
    for (const nested of Object.values(value)) visit(nested);
  }
  for (const row of decodedFlight(raw).split("\n")) {
    const colon = row.indexOf(":");
    if (colon < 0) continue;
    try { visit(JSON.parse(row.slice(colon + 1))); } catch { /* Module, binary and text rows are not JSON element rows. */ }
  }
  return output;
}

const publicKeys = ["authorNickname", "createdAt", "featuredAt", "id", "model", "negativePrompt", "prompt", "showcaseStatus", "showPromptPublic", "size", "url"].sort();
const secrets = ["HOME_REVIEW_NOTE_SECRET", "HOME_REVIEWER_ID_SECRET", "HOME_REVIEWER_EMAIL_SECRET"];
const privatePrompts = ["HOME_PRIVATE_POSITIVE_SECRET", "HOME_PRIVATE_NEGATIVE_SECRET"];

function assertTransfer(raw, { isOwner, publicPrompt, id }) {
  const payloads = workPayloads(raw);
  const payload = payloads.find((entry) => entry.work.id === id);
  assert(payload, `Actual WorkDetailPanel Flight props not found for ${id}`);
  assert.equal(payload.isOwner, isOwner);
  if (!isOwner) {
    assert.deepEqual(Object.keys(payload.work).sort(), publicKeys, "Public detail must be an exact allowlist");
    for (const secret of secrets) assert(!raw.includes(secret), `Internal sentinel transferred: ${secret}`);
    if (!publicPrompt) {
      for (const secret of privatePrompts) assert(!raw.includes(secret), `Private prompt transferred: ${secret}`);
      assert.equal(payload.work.prompt, null);
      assert.equal(payload.work.negativePrompt, null);
    } else {
      assert(raw.includes("HOME_PUBLIC_POSITIVE_SENTINEL"));
      assert(raw.includes("HOME_PUBLIC_NEGATIVE_SENTINEL"));
    }
  } else {
    for (const secret of secrets) assert(raw.includes(secret), `Owner lost management data: ${secret}`);
    assert.equal(typeof payload.work.prompt, "string");
    assert.equal(typeof payload.work.negativePrompt, "string");
    assert.equal(payload.work.ownerId, "home-owner");
  }
  return { id, keys: Object.keys(payload.work).sort(), isOwner, publicPrompt };
}

async function privacyChecks() {
  await control({ mode: "data" });
  for (const userId of [null, "home-member", "home-admin", "home-owner"]) {
    for (const status of ["featured", "private", "pending", "takedown_pending"]) {
      for (const visibility of ["public", "hidden"]) {
        const id = `fixture-${status}-${visibility}`;
        await check(`D1-html-${userId ?? "guest"}-${status}-${visibility}`, async () => {
          const response = await request(`/works/${id}`, { headers: userId ? { cookie: `narra_session=${token(userId)}` } : {} });
          const raw = await response.text();
          await writeFile(path.join(evidence, `transfer-${userId ?? "guest"}-${id}.html`), raw);
          const allowed = status === "featured" || userId === "home-owner";
          if (!allowed) {
            assert([200, 404].includes(response.status));
            assert(raw.includes("NEXT_HTTP_ERROR_FALLBACK;404"), "Actual Next notFound boundary must reject the request");
            assert(raw.includes('name="robots" content="noindex"'));
            assert.equal(workPayloads(raw).length, 0);
            for (const secret of [...secrets, ...privatePrompts]) assert(!raw.includes(secret));
            return { transportStatus: response.status, nextBoundaryStatus: 404, noClientDetail: true, note: "Next streaming can already have committed HTTP200 before notFound; semantic rejection matches pre-change behavior." };
          }
          assert.equal(response.status, 200);
          return assertTransfer(raw, { id, isOwner: userId === "home-owner", publicPrompt: visibility === "public" });
        });
      }
    }
  }
  await check("D1-missing-image-remains-404", async () => {
    const response = await request("/works/fixture-missing");
    const raw = await response.text();
    assert([200, 404].includes(response.status));
    assert(raw.includes("NEXT_HTTP_ERROR_FALLBACK;404"));
    assert.equal(workPayloads(raw).length, 0);
    return { transportStatus: response.status, nextBoundaryStatus: 404 };
  });
  await check("D1-admin-list-retains-authorized-data", async () => {
    const response = await request("/admin/works", { headers: { cookie: `narra_session=${token("home-admin")}` } });
    assert.equal(response.status, 200);
    const body = await response.text();
    for (const secret of [...secrets, ...privatePrompts]) assert(body.includes(secret));
    await writeFile(path.join(evidence, "transfer-admin-works.html"), body);
  });
  await check("D1-featured-api-never-transfers-private-prompt-or-review", async () => {
    const response = await request("/api/works/featured?limit=16");
    assert.equal(response.status, 200);
    const body = await response.text();
    for (const secret of [...secrets, ...privatePrompts, "HOME_PUBLIC_NEGATIVE_SENTINEL"]) assert(!body.includes(secret));
    const parsed = JSON.parse(body);
    assert.equal(parsed.items.length, 16);
    assert.equal(parsed.items[1].showPromptPublic, true);
    assert.equal(parsed.items[1].prompt, "作者未公开提示词");
    assert.equal(parsed.items[2].showPromptPublic, false);
    await writeFile(path.join(evidence, "featured-api.json"), body);
  });
  for (const userId of [null, "home-member", "home-admin", "home-owner"]) {
    for (const visibility of ["public", "hidden"]) {
      await check(`D1-next-navigation-refresh-${userId ?? "guest"}-${visibility}`, async () => {
        const tab = await page(userId);
        const id = `fixture-featured-${visibility}`;
        await tab.navigate("/homepage-fixture/links");
        await waitFor(() => tab.cdp.evaluate("[...document.querySelectorAll('a')].some(a=>Object.keys(a).some(key=>key.startsWith('__reactProps$')))"), { message: "React link hydration did not complete" });
        const prior = tab.responses.length;
        await tab.click(`a[href="/works/${id}"]`);
        await waitFor(() => tab.cdp.evaluate(`location.pathname === ${JSON.stringify(`/works/${id}`)}`));
        const transfer = await waitFor(async () => {
          await tab.flushBodies();
          return tab.responses.slice(prior).find((entry) => entry.url.includes(`/works/${id}`) && entry.mimeType.includes("component"));
        }, { timeout: 7000, message: "Actual Next client navigation must request a Flight payload" });
        assert(transfer, "Actual Next client navigation must request a Flight payload");
        await writeFile(path.join(evidence, `navigation-${userId ?? "guest"}-${id}.rsc`), transfer.body);
        const result = assertTransfer(transfer.body, { id, isOwner: userId === "home-owner", publicPrompt: visibility === "public" });
        const priorRefresh = tab.responses.length;
        await tab.cdp.send("Page.reload", { ignoreCache: true });
        await waitFor(() => tab.cdp.evaluate("document.readyState === 'complete'"));
        await delay(500);
        await tab.flushBodies();
        const refresh = tab.responses.slice(priorRefresh).find((entry) => entry.type === "Document" && entry.url.includes(id));
        assert(refresh, "Refresh document body must be captured");
        assertTransfer(refresh.body, { id, isOwner: userId === "home-owner", publicPrompt: visibility === "public" });
        return result;
      });
    }
  }
}

async function visualMetrics(tab) {
  return tab.cdp.evaluate(`(() => {
    const style=(node)=>{if(!node)return null;const s=getComputedStyle(node),r=node.getBoundingClientRect();return {fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,color:s.color,backgroundColor:s.backgroundColor,borderColor:s.borderColor,height:r.height,width:r.width};};
    return {body:style(document.body),main:style(document.querySelector('main')),header:style(document.querySelector('header')),h1:style(document.querySelector('h1')),overflow:document.documentElement.scrollWidth>innerWidth,links:[...document.querySelectorAll('header a')].map(a=>({href:a.getAttribute('href'),text:a.textContent.trim()}))};
  })()`);
}

async function baselineChecks() {
  await control({ mode: "data" });
  const baseline = {};
  for (const route of ["/create", "/works", "/settings", "/admin"]) {
    await check(`S1-baseline-${safeName(route)}`, async () => {
      const tab = await page(route === "/admin" ? "home-admin" : "home-member");
      await tab.navigate(route);
      await tab.ready(route === "/create" ? "textarea" : "h1");
      await tab.settledFonts();
      baseline[route] = await visualMetrics(tab);
      assert.equal(baseline[route].overflow, false);
      await tab.screenshot(path.join(evidence, `baseline-${safeName(route)}.png`));
      return baseline[route];
    });
  }
  await writeFile(path.join(evidence, "default-route-baseline.json"), JSON.stringify(baseline, null, 2));
  await writeFile(path.join(here, "evidence", "latest-baseline.json"), JSON.stringify({ runId, evidence, baseline }, null, 2));
  await check("D1-before-change-notFound-transport-semantics", async () => {
    const response = await request("/works/fixture-private-hidden");
    const raw = await response.text();
    assert(raw.includes("NEXT_HTTP_ERROR_FALLBACK;404"));
    assert.equal(workPayloads(raw).length, 0);
    await writeFile(path.join(evidence, "prior-notfound.html"), raw);
    return { transportStatus: response.status, nextBoundaryStatus: 404, noClientDetail: true };
  });
}

async function navigationBoundaryChecks() {
  const tab = await page("home-member");
  const results = [];
  for (const [label, prompt] of [["ascii8000", "a".repeat(8000)], ["ascii8001", "a".repeat(8001)], ["chinese8000", "江".repeat(8000)], ["emoji8000units", "🌧️".repeat(2666) + "雨雨"]]) {
    await check(`C2-existing-navigation-${label}`, async () => {
      const target = `/create?prompt=${encodeURIComponent(prompt)}`;
      const before = tab.responses.length;
      await tab.cdp.send("Page.navigate", { url: new URL(target, origin).href });
      await waitFor(() => tab.responses.slice(before).some((entry) => entry.type === "Document"), { timeout: 15000 });
      await delay(700);
      const response = tab.responses.slice(before).filter((entry) => entry.type === "Document").at(-1);
      const value = await tab.cdp.evaluate("document.querySelector('textarea')?.value ?? null");
      const result = { label, promptUnits: prompt.length, requestTargetBytes: Buffer.byteLength(target), transportStatus: response.status, inputUnits: value?.length ?? null, correctlyPrefilled: value === prompt.slice(0, 8000) };
      results.push(result);
      if (label.startsWith("ascii")) assert(result.correctlyPrefilled);
      return result;
    });
  }
  await writeFile(path.join(evidence, "long-url-baseline.json"), JSON.stringify(results, null, 2));
}

try {
  await sourceIdentity("pre-browser");
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  const server = start(process.execPath, [path.join(app, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], "next");
  await waitFor(async () => {
    if (server.exitCode !== null) throw new Error(`Next exited ${server.exitCode}`);
    const response = await request("/homepage-fixture/control", { headers: { "x-homepage-fixture": config.controlToken } });
    return response.status === 200;
  }, { timeout: 60000, message: "Owned Next fixture did not start" });
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const chrome = start(chromePath, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-extensions", "--disable-default-apps", "--metrics-recording-only", "--no-proxy-server", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], "chrome");
  const devtools = await waitFor(async () => {
    if (chrome.exitCode !== null) throw new Error(`Chrome exited ${chrome.exitCode}`);
    return (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).trim().split(/\r?\n/);
  }, { timeout: 20000, message: "Fresh owned Chrome profile did not start" });
  browser = new Cdp(`ws://127.0.0.1:${devtools[0]}${devtools[1]}`);
  browser.port = Number(devtools[0]);
  const versions = { node: process.version, requiredNode: "v24.22.1", pinnedRuntimeParity: process.version === "v24.22.1", browser: await browser.send("Browser.getVersion"), parity: "Exact installed runtime is recorded; this local run is not actual CI." };
  await writeFile(path.join(evidence, "toolchain.json"), JSON.stringify(versions, null, 2));
  if (mode === "baseline") { await baselineChecks(); if (process.argv.includes("--navigation")) await navigationBoundaryChecks(); }
  else if (mode === "reference") {
    const { referenceChecks } = await import("./reference-checks.mjs");
    await referenceChecks({ page, check, evidence, here });
  }
  else if (mode === "diagnostic") {
    if (process.argv.includes("--gallery-entrance")) {
      const { diagnoseGalleryEntrance } = await import("./diagnose-gallery-entrance.mjs");
      await diagnoseGalleryEntrance({ page, check, evidence });
    } else {
      const { diagnoseHeroHit } = await import("./diagnose-hero-hit.mjs");
      await diagnoseHeroHit({ page, check, evidence });
    }
  }
  else {
    if (mode !== "home") await privacyChecks();
    if (mode === "full" || mode === "home") {
      const { fullHomepageChecks } = await import("./homepage-checks.mjs");
      await fullHomepageChecks({ page, check, control, request, evidence, browser, visualMetrics, here, heroAssets: config.heroAssets ?? [] });
    }
  }
  await sourceIdentity("post-browser");
} catch (error) {
  checks.push({ id: "runner", passed: false, error: error.stack ?? String(error) });
  console.error(error.stack ?? error);
} finally {
  if (currentPage) {
    await currentPage.flushBodies().catch(() => {});
    await writeFile(path.join(evidence, "last-page-network.json"), JSON.stringify({ requests: currentPage.requests, errors: currentPage.errors, blockedExternal: currentPage.externalRequests }, null, 2));
    currentPage.dispose();
    currentPage.cdp.close();
  }
  if (browser) { await browser.send("Browser.close", {}, 3000).catch(() => {}); browser.close(); }
  for (const child of children.reverse()) {
    if (child.exitCode !== null) continue;
    child.kill();
    await delay(350);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  const unresolvedAcceptance = await readFile(path.join(evidence, "unresolved-acceptance.json"), "utf8").then(JSON.parse).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
  const result = { runId, mode, filter: checkFilter?.source ?? null, evidence, app, checks, passed: checks.length > 0 && checks.every((entry) => entry.passed), passedScope: "Executable checks only; unresolved acceptance is separate and never a passing navigation case.", unresolvedAcceptance, limitations: ["Real Next/React/Chromium with synthetic DB only; not live DB/Worker/provider E2E.", "Desktop Chrome CDP emulates viewport/touch; not physical mobile/native IME.", process.version === "v24.22.1" ? "Pinned installed Node24.22.1 is used locally; actual CI is not exercised." : "Local installed Node is not pinned Node24.22.1."] };
  await writeFile(path.join(evidence, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ runId, evidence, passed: result.passed, checks: checks.length, failed: checks.filter((entry) => !entry.passed).map((entry) => entry.id), unresolvedAcceptance: unresolvedAcceptance.length }));
  process.exitCode = result.passed ? 0 : 1;
}

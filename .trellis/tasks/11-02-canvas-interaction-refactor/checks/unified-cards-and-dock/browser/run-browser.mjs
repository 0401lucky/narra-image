import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";

import { createStudioApi, defaults, emptyScene, fixturePng } from "./api.mjs";
import { BrowserPage, Cdp, CDP_MODIFIERS, delay, waitFor } from "./cdp.mjs";
import { buildIdentity, here, sha, verifyInputs, writeJson } from "./identity.mjs";

const { app, ownerRoot, report: inputReport } = await verifyInputs("prebrowser", true);
const runId = `native-${Date.now()}`;
const evidence = path.join(here, "evidence", runId);
const profile = path.join(ownerRoot, "chrome-" + runId);
const downloads = path.join(ownerRoot, "downloads-" + runId);
await mkdir(evidence, { recursive: true });
await mkdir(profile);
await mkdir(downloads);
const children = [];
const results = [];
const api = createStudioApi();
const thumbnailRequests = [];
let page, browser, server;
const editor = '[aria-label="\u8282\u70b9\u7f16\u8f91\u9762\u677f"]';
const prompt = editor + ' textarea[aria-label="\u521b\u4f5c\u63d0\u793a\u8bcd"]';
const runButton = editor + ' button[aria-label="\u8fd0\u884c\u6b64\u8282\u70b9"]';
const graphButton = 'button[aria-label="\u9ad8\u7ea7\u56fe\u8c31"]';
const panButton = 'button[aria-label="\u5e73\u79fb\u5de5\u5177"]';
const selectButton = 'button[aria-label="\u9009\u62e9\u5de5\u5177"]';
const fitButton = 'button[aria-label="\u9002\u5e94\u5168\u90e8\u8282\u70b9"]';
const viewer = 'img[alt="\u653e\u5927\u67e5\u770b"]';
const node = (id) => `.react-flow__node[data-id=${JSON.stringify(id)}]`;
const resultImage = (id) => node(id) + " img";
const generationRequests = () => api.requests.filter((request) => request.method === "POST" && request.path === "/api/generate");
const account = api.account();
const oldScene = emptyScene();
const originalPng = fixturePng(true);
const references = [];
for (let index = 0; index < 8; index += 1) {
  const assetId = randomUUID(), id = randomUUID();
  account.assets.set(assetId, { id: assetId, uploadId: randomUUID(), state: "READY", byteLength: originalPng.length, mimeType: "image/png", sha256: sha(originalPng), readyAt: "2026-11-04T00:00:00.000Z", url: `/fixture-media/${assetId}.png` });
  account.bytes.set(assetId, originalPng);
  references.push(id);
  oldScene.nodes.push({ id, kind: "reference", source: { kind: "imported", assetId }, position: { x: (index % 4) * 380, y: Math.floor(index / 4) * 360 } });
}
for (let index = 0; index < 8; index += 1) {
  const promptId = randomUUID(), generatorId = randomUUID();
  oldScene.nodes.push({ id: promptId, kind: "prompt", text: `Legacy prompt ${index}`, position: index === 7 ? { x: 50000, y: 20000 } : { x: (index % 4) * 380, y: 900 + Math.floor(index / 4) * 360 } });
  oldScene.nodes.push({ id: generatorId, kind: "generation", parameters: { ...defaults }, position: { x: (index % 4) * 380, y: 1800 + Math.floor(index / 4) * 360 } });
  oldScene.edges.push({ id: randomUUID(), kind: "prompt-input", source: promptId, target: generatorId });
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) oldScene.edges.push({ id: randomUUID(), kind: "image-input", source: references[(index + ordinal) % references.length], target: generatorId, ordinal });
}
const legacyId = api.seed("fixture-owner-a", "Legacy 24-node graph", oldScene);
const smokeScene = emptyScene();
for (let index = 0; index < 200; index += 1) smokeScene.nodes.push({ id: randomUUID(), kind: "prompt", text: `Capacity note ${index}`, position: { x: (index % 10) * 380, y: Math.floor(index / 10) * 360 } });
const smokeId = api.seed("fixture-owner-a", "200-node capacity smoke", smokeScene);
const sharedScene = emptyScene();
const sharedPromptId = randomUUID(), standalonePromptId = randomUUID();
const sharedGenerators = [randomUUID(), randomUUID()];
sharedScene.nodes.push({ id: sharedPromptId, kind: "prompt", text: "A shared scene for two images", position: { x: -360, y: 20 } });
sharedScene.nodes.push({ id: standalonePromptId, kind: "prompt", text: "Standalone note retained in full graph", position: { x: -360, y: 430 } });
for (const [index, id] of sharedGenerators.entries()) {
  sharedScene.nodes.push({ id, kind: "generation", parameters: { ...defaults }, position: { x: index * 460 + 20, y: 20 } });
  sharedScene.edges.push({ id: randomUUID(), kind: "prompt-input", source: sharedPromptId, target: id });
}
const sharedId = api.seed("fixture-owner-a", "Shared prompt compatibility", sharedScene);

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}
function start(binary, argv, name) {
  const child = spawn(binary, argv, { cwd: app, env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(createWriteStream(path.join(evidence, name + ".stdout.log")));
  child.stderr.pipe(createWriteStream(path.join(evidence, name + ".stderr.log")));
  children.push(child);
  return child;
}
async function stop(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") await new Promise((resolve) => { const killer = spawn(path.join(process.env.SYSTEMROOT ?? process.env.SystemRoot, "System32/taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); killer.once("exit", resolve); });
  else child.kill("SIGTERM");
}
async function check(id, operation) {
  const started = Date.now();
  try { const detail = await operation(); results.push({ id, passed: true, durationMs: Date.now() - started, detail }); console.log("PASS " + id); }
  catch (error) {
    results.push({ id, passed: false, durationMs: Date.now() - started, error: error.stack });
    console.error("FAIL " + id + ": " + error.message);
    if (page) await page.screenshot(path.join(evidence, id + "-failure.png")).catch(() => {});
    if (page) await writeJson(path.join(evidence, id + "-state.json"), await page.cdp.evaluate(`({url:location.href,active:document.activeElement?.outerHTML?.slice(0,800),html:document.body.innerHTML.slice(0,80000),trace:window.__nativeInputTrace})`).catch(() => null));
  }
  await writeJson(path.join(evidence, "checks.json"), results);
}
async function nativeDraft(id) {
  return page.cdp.evaluate(`new Promise(async(resolve,reject)=>{const databases=await indexedDB.databases();if(!databases.some(d=>d.name==='narra-canvas-drafts'))return resolve(null);const open=indexedDB.open('narra-canvas-drafts',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('drafts','readonly'),request=tx.objectStore('drafts').get(['fixture-owner-a',${JSON.stringify(id)}]);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const value=request.result;resolve(value?.envelope??null)};tx.oncomplete=()=>db.close()}})`);
}
async function scene(id) {
  return (await waitFor(() => nativeDraft(id), { timeout: 15000, message: "Native draft unavailable " + id })).scene;
}
async function waitForScene(id, predicate, message) {
  return waitFor(async () => { const draft = await nativeDraft(id); return draft && predicate(draft.scene) ? draft.scene : null; }, { timeout: 15000, message });
}
async function closeEditor(touch = false) {
  if (await page.cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(editor)}))`)) await page.click(editor + ' button[aria-label^="\u5173\u95ed\u8282\u70b9"]', null, 0, touch);
}
async function readyImage(selector) {
  await page.ready(selector);
  return waitFor(() => page.cdp.evaluate(`(()=>{const images=[...document.querySelectorAll(${JSON.stringify(selector)})];return images.length>0&&images.every(image=>image.complete&&image.naturalWidth>0)})()`), { timeout: 15000, message: "Visible fixture image did not decode: " + selector });
}
async function graphView(enabled) {
  await page.ready(graphButton);
  if ((await page.cdp.evaluate(`document.querySelector(${JSON.stringify(graphButton)}).getAttribute('aria-pressed')`)) !== String(enabled)) await page.click(graphButton);
  await waitFor(() => page.cdp.evaluate(`document.querySelector(${JSON.stringify(graphButton)}).getAttribute('aria-pressed')===${JSON.stringify(String(enabled))}`));
}
async function nativeSelect(selector, value) {
  await page.click(selector);
  await page.key("Home");
  const index = await page.cdp.evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).options).findIndex(option=>option.value===${JSON.stringify(value)})`);
  assert(index >= 0, `Missing select option ${value}`);
  for (let offset = 0; offset < index; offset += 1) await page.key("ArrowDown");
  await page.key("Enter");
  await delay(200);
}
async function showNode(id) {
  await closeEditor();
  await page.ready('select[aria-label="\u9009\u62e9\u753b\u5e03\u8282\u70b9"]');
  await nativeSelect('select[aria-label="\u9009\u62e9\u753b\u5e03\u8282\u70b9"]', id);
}
async function panePoint() {
  return page.cdp.evaluate(`(()=>{const pane=document.querySelector('.react-flow');if(!pane)return null;const r=pane.getBoundingClientRect();for(const fy of [.85,.7,.5,.25])for(const fx of [.95,.85,.65,.4,.1]){const x=r.left+r.width*fx,y=r.top+r.height*fy,hit=document.elementFromPoint(x,y);if(hit&&pane.contains(hit)&&!hit.closest('.react-flow__node,button,input,textarea,select,[aria-label="\u8282\u70b9\u7f16\u8f91\u9762\u677f"],[aria-label="\u6240\u9009\u56fe\u7247\u64cd\u4f5c"]'))return{x,y}}return null})()`);
}
async function drag(selector, dx, dy, release = null) {
  const point = await page.point(selector);
  await page.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await page.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, x: point.x, y: point.y });
  for (const fraction of [0.25, 0.5, 0.75, 1]) { await page.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, x: point.x + dx * fraction, y: point.y + dy * fraction }); await delay(30); }
  await page.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, x: release?.x ?? point.x + dx, y: release?.y ?? point.y + dy });
  await delay(500);
}
let canvasId, firstResult, firstGenerator, referenceId, continuationGenerator;
try {
  const nextPort = await freePort();
  start(process.execPath, [path.join(app, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(nextPort)], "next");
  await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${nextPort}/create`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } }, { timeout: 30000, message: "Next fixture failed to start" });
  server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://fixture.local");
      if (url.pathname === "/_next/image") {
        assert.equal(request.method, "GET");
        const original = new URL(url.searchParams.get("url"), "http://fixture.local");
        assert.equal(original.origin, "http://fixture.local");
        assert(/^\/fixture-media\/(?:asset-)?[a-f\d-]+\.png$/.test(original.pathname) && !original.search && !original.hash);
        const width = Number(url.searchParams.get("w")), quality = Number(url.searchParams.get("q"));
        assert(Number.isInteger(width) && width > 0 && width <= 1920 && Number.isInteger(quality) && quality >= 1 && quality <= 100);
        request.url = original.pathname;
        const result = await api.handle(request);
        assert.equal(result.status, 200);
        thumbnailRequests.push({ source: original.pathname, width, quality, sha256: sha(result.body), boundary: "Fake thumbnail endpoint serves fixture original bytes, not real Next optimizer/backend proof" });
        response.writeHead(200, { "content-type": result.type }); response.end(result.body);
      }
      else if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/fixture-media/")) { const result = await api.handle(request); response.writeHead(result.status, { "content-type": result.type }); response.end(result.body); }
      else { const forward = http.request({ hostname: "127.0.0.1", port: nextPort, path: request.url, method: request.method, headers: request.headers }, (upstream) => { response.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(response); }); forward.on("error", (error) => { response.writeHead(502); response.end(error.message); }); request.pipe(forward); }
    } catch (error) { response.writeHead(500, { "content-type": "application/json" }); response.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const debugPort = await freePort();
  start("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank"], "chrome");
  const version = await waitFor(async () => { try { return await (await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(1000) })).json(); } catch { return null; } }, { timeout: 30000, message: "Owned Chrome failed to start" });
  browser = new Cdp(version.webSocketDebuggerUrl);
  await browser.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((item) => item.id === targetId));
  page = new BrowserPage(new Cdp(target.webSocketDebuggerUrl), origin);
  await page.initialize();
  await page.viewport(1440, 1000);
  await check("B0-native-calibration", async () => {
    await page.navigate("about:blank");
    await page.cdp.evaluate(`void(()=>{document.body.innerHTML='<button id="ok" style="width:100px;height:48px">Enabled</button><button id="off" disabled>Disabled</button><textarea id="plain">input</textarea>';window.__calib=[];for(const name of ['click','keydown','keypress'])document.addEventListener(name,e=>window.__calib.push({name,trusted:e.isTrusted,key:e.key,alt:e.altKey,shift:e.shiftKey}),true);document.querySelector('#ok').addEventListener('click',()=>{window.__clicks=(window.__clicks??0)+1})})()`);
    await page.click("#ok");
    const before = await page.cdp.evaluate("window.__clicks");
    await page.key("Enter");
    assert.equal(await page.cdp.evaluate("window.__clicks"), before + 1);
    await page.cdp.evaluate("void(document.querySelector('#ok').disabled=true)");
    await page.key("Enter");
    assert.equal(await page.cdp.evaluate("window.__clicks"), before + 1);
    await page.cdp.evaluate("void(document.querySelector('#ok').disabled=false)");
    await page.click("#ok"); await page.key("Tab"); assert.equal(await page.cdp.evaluate("document.activeElement.id"), "plain");
    await page.key("Tab", CDP_MODIFIERS.Shift); assert.equal(await page.cdp.evaluate("document.activeElement.id"), "ok");
    assert((await page.cdp.evaluate("window.__calib")).some((item) => item.name === "keypress" && item.trusted && item.key === "Enter"));
    return await page.cdp.evaluate("window.__calib");
  });
  await page.navigate("/create");
  await check("B1-direct-create-run", async () => {
    await page.click("button", "\u753b\u5e03");
    await page.ready('[aria-label="\u753b\u5e03\u5bfc\u822a"]');
    await page.click('[aria-label="\u753b\u5e03\u5bfc\u822a"] button', "\u65b0\u5efa\u7a7a\u767d\u753b\u5e03");
    await waitFor(() => [...account.documents.keys()].find((id) => ![legacyId, smokeId, sharedId].includes(id)));
    canvasId = [...account.documents.keys()].find((id) => ![legacyId, smokeId, sharedId].includes(id));
    assert.equal((await scene(canvasId)).nodes.length, 0);
    await page.click("button", "\u65b0\u5efa\u56fe\u7247");
    await page.ready(prompt);
    const created = await waitForScene(canvasId, (value) => value.nodes.length === 2, "Quick creation was not committed to the native draft"); assert.equal(created.edges.length, 1);
    firstGenerator = created.nodes.find((entry) => entry.kind === "generation").id;
    await waitFor(() => page.cdp.evaluate(`document.querySelectorAll('.react-flow__node').length===1&&document.querySelectorAll('.react-flow__node-prompt').length===0`), { message: "Default view still exposes the separate prompt card" });
    assert.equal(await page.cdp.evaluate("document.querySelectorAll('.react-flow__edge').length"), 0);
    const surface = await page.cdp.evaluate(`(()=>{const panel=document.querySelector(${JSON.stringify(editor)}),r=panel.getBoundingClientRect(),field=document.querySelector(${JSON.stringify(prompt)});return{rect:r.toJSON(),promptCount:document.querySelectorAll(${JSON.stringify(prompt)}).length,font:parseFloat(getComputedStyle(field).fontSize),controls:panel.querySelectorAll('input,select,textarea').length}})()`);
    assert.equal(surface.promptCount, 1); assert(surface.font >= 16);
    assert(surface.rect.left >= 0 && surface.rect.right <= 1440 && surface.rect.bottom <= 1000, "Creation surface is outside screen bounds");
    const viewportBefore = await page.cdp.evaluate("document.querySelector('.react-flow').getBoundingClientRect().toJSON()");
    await page.type(prompt, "A ceramic cup in warm afternoon light");
    await page.key("Enter");
    assert.equal(generationRequests().length, 0);
    assert((await page.cdp.evaluate(`document.querySelector(${JSON.stringify(prompt)}).value`)).includes("\n"));
    await page.screenshot(path.join(evidence, "desktop-composer.png"));
    await page.click(runButton);
    await waitFor(async () => (await scene(canvasId)).nodes.some((entry) => entry.kind === "result"));
    const settled = await scene(canvasId); firstResult = settled.nodes.find((entry) => entry.kind === "result");
    assert.equal(generationRequests().length, 1); assert.equal(settled.runBindings.length, 1);
    assert.equal(generationRequests()[0].body.canvasRun.nodeId, firstGenerator);
    assert.equal(viewportBefore.width, await page.cdp.evaluate("document.querySelector('.react-flow').getBoundingClientRect().width"));
    await closeEditor();
    await page.click('button[aria-label="\u9002\u5e94\u5168\u90e8\u8282\u70b9"]');
    await readyImage(resultImage(firstResult.id));
    return { canvasId, canonicalNodes: settled.nodes.length, defaultVisibleCardsBeforeRun: 1, surface, run: generationRequests()[0].body.canvasRun, result: firstResult };
  });
  if (canvasId && firstResult) {
    await check("U5-invalid-size-blocks-run-and-save", async () => {
      const runCount = generationRequests().length;
      const saveCount = api.requests.filter((request) => request.method === "PUT").length;
      await page.click(node(firstGenerator)); await page.ready(prompt);
      const sizeSelect = editor + ' select[aria-label="\u8282\u70b9\u8f93\u51fa\u5c3a\u5bf8"]';
      const sizeInput = editor + ' input[aria-label="\u8282\u70b9\u81ea\u5b9a\u4e49\u5c3a\u5bf8"]';
      await nativeSelect(sizeSelect, "custom"); await page.ready(sizeInput);
      assert.equal(await page.cdp.evaluate(`document.querySelector(${JSON.stringify(sizeInput)}).value`), "");
      await page.click(runButton); await delay(250);
      assert.equal(generationRequests().length, runCount, "Empty custom size submitted a generation");
      assert.equal(await page.cdp.evaluate(`document.querySelector(${JSON.stringify(sizeInput)}).getAttribute('aria-invalid')`), "true");
      await closeEditor();
      await page.click('button[aria-label="\u4fdd\u5b58\u5230\u8d26\u6237"]'); await page.ready(sizeInput);
      assert.equal(api.requests.filter((request) => request.method === "PUT").length, saveCount, "Invalid pending size was omitted from Save validation");
      assert.equal(await page.cdp.evaluate(`document.querySelector(${JSON.stringify(sizeInput)}).value`), "");
      await nativeSelect(sizeSelect, "auto");
      await waitFor(() => page.cdp.evaluate(`!document.querySelector(${JSON.stringify(sizeInput)})`));
      await closeEditor(); await page.click(fitButton);
      return { runCount, saveCount, invalidDraftSurvivesClose: true, explicitAutoClearsDraft: true };
    });
    await check("B2-select-explicit-view-drag", async () => {
      await readyImage(resultImage(firstResult.id));
      await page.click(resultImage(firstResult.id));
      assert.equal(await page.cdp.evaluate(`document.querySelectorAll(${JSON.stringify(viewer)}).length`), 0);
      await page.ready('[aria-label="\u6240\u9009\u56fe\u7247\u64cd\u4f5c"]');
      await page.screenshot(path.join(evidence, "desktop-image-selected.png"));
      await page.click('button[aria-label="\u67e5\u770b\u6240\u9009\u539f\u56fe"]');
      await page.ready(viewer);
      await readyImage(viewer);
      await page.screenshot(path.join(evidence, "desktop-explicit-viewer.png"));
      await page.key("Escape");
      await waitFor(() => page.cdp.evaluate(`!document.querySelector(${JSON.stringify(viewer)})`), { message: "Explicit viewer did not close on native Escape" });
      const before = (await scene(canvasId)).nodes.find((entry) => entry.id === firstResult.id).position;
      await drag(resultImage(firstResult.id), 70, 38);
      const moved = (await scene(canvasId)).nodes.find((entry) => entry.id === firstResult.id).position;
      assert(moved.x > before.x && moved.y > before.y, "Whole image did not move");
      assert.equal(generationRequests().length, 1);
      assert.equal(await page.cdp.evaluate(`document.querySelectorAll(${JSON.stringify(viewer)}).length`), 0);
      return { before, moved, native: await page.cdp.evaluate("window.__nativeInputTrace") };
    });
    await check("B3-outside-release-cancels", async () => {
      const before = (await scene(canvasId)).nodes.find((entry) => entry.id === firstResult.id).position;
      await drag(resultImage(firstResult.id), 25, 20, { x: 20, y: 15 });
      const after = (await scene(canvasId)).nodes.find((entry) => entry.id === firstResult.id).position;
      assert.deepEqual(after, before, "Captured mouse release outside viewport became a domain move");
      return { before, after };
    });
    await check("U3-hand-tool-and-keyboard", async () => {
      await closeEditor();
      await page.click(panButton);
      const before = await scene(canvasId);
      await drag(resultImage(firstResult.id), -70, -30);
      const after = await waitForScene(canvasId, (value) => value.viewport.x !== before.viewport.x || value.viewport.y !== before.viewport.y, "Hand mode did not pan when dragging an image");
      assert.deepEqual(after.nodes, before.nodes, "Hand tool moved a domain card");
      assert.equal(await page.cdp.evaluate(`document.querySelector(${JSON.stringify(panButton)}).getAttribute('aria-pressed')`), "true");
      await page.click(selectButton);
      await page.key("Tab");
      const focused = await page.cdp.evaluate("document.activeElement.getAttribute('aria-label')");
      assert.equal(focused, "\u5e73\u79fb\u5de5\u5177");
      await page.key("Enter");
      assert.equal(await page.cdp.evaluate(`document.querySelector(${JSON.stringify(panButton)}).getAttribute('aria-pressed')`), "true");
      await page.click(selectButton);
      assert.equal(generationRequests().length, 1);
      return { cameraBefore: before.viewport, cameraAfter: after.viewport, domainPositionsUnchanged: true, nativeEnterOnDock: true };
    });
    await check("U6-low-image-toolbar-clears-docks", async () => {
      await page.click(fitButton);
      await page.click(resultImage(firstResult.id));
      const before = await scene(canvasId);
      await page.click(panButton);
      const card = await page.inspect(node(firstResult.id));
      const pane = await page.cdp.evaluate("document.querySelector('.react-flow').getBoundingClientRect().toJSON()");
      const delta = pane.bottom - 8 - card.top;
      const start = await page.cdp.evaluate(`(()=>{const r=document.querySelector('.react-flow').getBoundingClientRect();for(const fy of [.12,.2,.32])for(const fx of [.95,.85,.65,.45,.15]){const x=r.left+r.width*fx,y=r.top+r.height*fy,hit=document.elementFromPoint(x,y);if(y+${delta}<r.bottom-4&&hit?.closest('.react-flow')&&!hit.closest('.react-flow__node,button,input,select,textarea'))return{x,y}}return null})()`);
      assert(start, "No native hand-pan start with bounded travel");
      await page.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, ...start });
      await page.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, x: start.x, y: start.y + delta });
      await page.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, x: start.x, y: start.y + delta });
      await waitForScene(canvasId, (value) => value.viewport.y > before.viewport.y + delta - 2, "Hand pan did not reach low-image fixture");
      const geometry = await page.cdp.evaluate(`(()=>{const toolbar=document.querySelector('[aria-label="\u6240\u9009\u56fe\u7247\u64cd\u4f5c"]'),r=toolbar.getBoundingClientRect(),docks=[...document.querySelectorAll('[data-canvas-dock] > div,[data-canvas-camera]')].map(n=>n.getBoundingClientRect().toJSON());return{toolbar:r.toJSON(),docks,overlap:docks.some(d=>r.left<d.right&&r.right>d.left&&r.top<d.bottom&&r.bottom>d.top)}})()`);
      assert(!geometry.overlap, "Selected-image toolbar lies under the new dock");
      await page.point('button[aria-label="\u67e5\u770b\u6240\u9009\u539f\u56fe"]');
      await page.point('button[aria-label="\u4e0b\u8f7d\u6240\u9009\u539f\u56fe"]');
      await page.point("button", "\u7ee7\u7eed\u521b\u4f5c");
      await page.screenshot(path.join(evidence, "desktop-low-image-context-toolbar.png"));
      await page.click('button[aria-label="\u67e5\u770b\u6240\u9009\u539f\u56fe"]'); await readyImage(viewer);
      await page.key("Escape");
      await page.click(selectButton); await page.click(fitButton);
      assert.deepEqual((await scene(canvasId)).nodes, before.nodes, "Toolbar placement edited original image coordinates");
      return { ...geometry, originalPositionsUnchanged: true };
    });
    await check("B4-original-import-download", async () => {
      await closeEditor();
      const file = path.join(ownerRoot, "reference-original.png"); await writeFile(file, originalPng);
      await page.cdp.send("Page.setInterceptFileChooserDialog", { enabled: true });
      let chooser = null; const off = page.cdp.on("Page.fileChooserOpened", (event) => { chooser = event; });
      await page.click('button[aria-label="\u5bfc\u5165\u53c2\u8003\u56fe"]');
      await waitFor(() => chooser);
      await page.cdp.send("DOM.setFileInputFiles", { files: [file], backendNodeId: chooser.backendNodeId }); off();
      await waitFor(async () => (await scene(canvasId)).nodes.some((entry) => entry.kind === "reference"));
      referenceId = (await scene(canvasId)).nodes.find((entry) => entry.kind === "reference").id;
      await page.click('button[aria-label="\u9002\u5e94\u5168\u90e8\u8282\u70b9"]');
      await readyImage(resultImage(referenceId));
      await page.click(resultImage(referenceId));
      await page.click('button[aria-label="\u4e0b\u8f7d\u6240\u9009\u539f\u56fe"]');
      await waitFor(async () => (await readdir(downloads)).some((name) => !name.endsWith(".crdownload")), { timeout: 15000 });
      const files = await readdir(downloads);
      const hashes = await Promise.all(files.filter((name) => !name.endsWith(".crdownload")).map(async (name) => sha(await readFile(path.join(downloads, name)))));
      assert(hashes.includes(sha(originalPng)), "Original downloaded bytes changed");
      assert.equal(generationRequests().length, 1);
      return { referenceId, originalSha256: sha(originalPng), downloadHashes: hashes, chooser: "native button + CDP file selection, not OS chooser" };
    });
    if (referenceId) await check("B5-continue-thumbnail-order", async () => {
      const before = await scene(canvasId);
      const runCount = generationRequests().length;
      await page.click("button", "\u7ee7\u7eed\u521b\u4f5c"); await page.ready(prompt);
      const prepared = await waitForScene(canvasId, (value) => value.nodes.length === before.nodes.length + 2, "Continuation group was not committed");
      continuationGenerator = prepared.nodes.filter((entry) => entry.kind === "generation").find((entry) => entry.id !== firstGenerator).id;
      await page.click(editor + " button", "\u4ece\u753b\u5e03\u9009\u62e9");
      await page.click(`button[aria-label^=${JSON.stringify("\u9009\u62e9\u53c2\u8003 " + firstResult.id.slice(-6))}]`);
      await page.click('button[aria-label="\u4e0a\u79fb\u7f29\u7565\u53c2\u8003\u56fe 2"]');
      const reordered = await waitForScene(canvasId, (value) => value.edges.some((edge) => edge.kind === "image-input" && edge.target === continuationGenerator && edge.source === firstResult.id && edge.ordinal === 1), "Reference reorder was not committed");
      const inputs = reordered.edges.filter((edge) => edge.kind === "image-input" && edge.target === continuationGenerator).sort((a, b) => a.ordinal - b.ordinal);
      assert.deepEqual(inputs.map((edge) => edge.source), [firstResult.id, referenceId]);
      await page.type(prompt, "Keep the shape and change the lighting");
      assert.equal(generationRequests().length, runCount);
      await page.click(runButton);
      await waitFor(async () => (await scene(canvasId)).nodes.filter((entry) => entry.kind === "result").length === 2);
      const latest = await scene(canvasId);
      assert.equal(generationRequests().length, runCount + 1); assert(latest.nodes.some((entry) => entry.id === firstResult.id));
      assert.equal(generationRequests()[runCount].body.canvasRun.input.references.length, 2);
      await readyImage(editor + " img");
      await page.screenshot(path.join(evidence, "desktop-continuation.png"));
      return { inputs, wire: generationRequests()[runCount].body.canvasRun, resultIds: latest.nodes.filter((entry) => entry.kind === "result").map((entry) => entry.id) };
    });
    if (continuationGenerator) await check("U4-screen-sized-editor-at-zoom", async () => {
      const runCount = generationRequests().length;
      await page.cdp.evaluate(`void(window.__zoomField=document.querySelector(${JSON.stringify(prompt)}))`);
      const accepted = await page.cdp.evaluate(`document.querySelector(${JSON.stringify(prompt)}).value`);
      const measures = [];
      for (const [label, count] of [["\u7f29\u5c0f\u753b\u5e03", 3], ["\u653e\u5927\u753b\u5e03", 6]]) {
        const cameraBefore = (await scene(canvasId)).viewport;
        for (let index = 0; index < count; index += 1) await page.click(`button[aria-label=${JSON.stringify(label)}]`);
        const cameraAfter = (await scene(canvasId)).viewport;
        assert.notEqual(cameraAfter.zoom, cameraBefore.zoom);
        const detail = await page.cdp.evaluate(`(()=>{const field=document.querySelector(${JSON.stringify(prompt)}),panel=document.querySelector(${JSON.stringify(editor)}),dock=document.querySelector('[data-canvas-dock]');return{same:field===window.__zoomField,value:field.value,font:parseFloat(getComputedStyle(field).fontSize),panel:panel.getBoundingClientRect().toJSON(),dock:dock.getBoundingClientRect().toJSON()}})()`);
        assert(detail.same && detail.value === accepted && detail.font >= 16);
        assert(detail.panel.bottom <= detail.dock.top, "Creation editor overlaps the bottom dock");
        await page.point(runButton);
        await page.screenshot(path.join(evidence, `desktop-zoom-${Math.round(cameraAfter.zoom * 100)}.png`));
        measures.push({ cameraBefore, cameraAfter, ...detail });
      }
      const ghost = await page.cdp.evaluate(`(()=>{const card=document.querySelector(${JSON.stringify(node(continuationGenerator))}),panel=document.querySelector(${JSON.stringify(editor)}),r=card.getBoundingClientRect(),p=panel.getBoundingClientRect(),bounds=document.querySelector('.react-flow').getBoundingClientRect(),samples=[];for(const fx of [.1,.5,.9])for(const fy of [.1,.5,.9]){const x=r.left+r.width*fx,y=r.top+r.height*fy;if(x<bounds.left||x>=bounds.right||y<bounds.top||y>=bounds.bottom||(x>=p.left&&x<p.right&&y>=p.top&&y<p.bottom))continue;const hit=document.elementFromPoint(x,y);samples.push({x,y,hitsGhost:hit===card||card.contains(hit)})}return{tabIndex:card.tabIndex,inert:card.inert,samples}})()`);
      assert(ghost.tabIndex < 0 || ghost.inert, "Invisible replacement wrapper remains keyboard-focusable");
      assert(ghost.samples.every((sample) => !sample.hitsGhost), "Invisible replacement wrapper intercepts the canvas");
      assert.equal(generationRequests().length, runCount);
      return { measures, ghost };
    });
    if (continuationGenerator) await check("B6-phone-sheets-focus", async () => {
      const measurements = [];
      const runCount = generationRequests().length;
      await page.cdp.evaluate(`void(()=>{window.__compositionTrace=[];for(const type of ['compositionstart','compositionupdate','compositionend','input'])document.addEventListener(type,event=>{if(event.target.matches(${JSON.stringify(prompt)}))window.__compositionTrace.push({type,trusted:event.isTrusted,composing:event.isComposing,value:event.target.value,start:event.target.selectionStart,end:event.target.selectionEnd})},true)})()`);
      for (const width of [360, 390, 430]) {
        await page.viewport(width, 760, true); await page.ready(prompt);
        await readyImage(editor + " img");
        await page.type(prompt, `Phone ${width}: keep a readable independent draft`);
        await page.cdp.evaluate(`void(window.__field=document.querySelector(${JSON.stringify(prompt)}))`);
        await page.cdp.send("Input.imeSetComposition", { text: "\u6696", selectionStart: 1, selectionEnd: 1 });
        await page.cdp.send("Input.imeSetComposition", { text: "\u6696\u8272\u5149\u7ebf", selectionStart: 4, selectionEnd: 4 });
        await page.screenshot(path.join(evidence, `phone-${width}-portrait-composition.png`));
        await page.viewport(width, 390, true); await delay(250);
        const detail = await page.cdp.evaluate(`(()=>{const field=document.querySelector(${JSON.stringify(prompt)}),panel=document.querySelector(${JSON.stringify(editor)}),r=panel.getBoundingClientRect();return{same:field===window.__field,value:field.value,focus:document.activeElement===field,font:parseFloat(getComputedStyle(field).fontSize),panel:r.toJSON(),buttons:[...panel.querySelectorAll('header button,footer button')].filter(b=>b.getBoundingClientRect().width>0).map(b=>({text:b.textContent,height:b.getBoundingClientRect().height,width:b.getBoundingClientRect().width}))}})()`);
        assert(detail.same && detail.focus && detail.value.includes(String(width)), "Resize replaced or blurred the focused prompt");
        assert(detail.value.includes("\u6696\u8272\u5149\u7ebf"), "Viewport change restored text during CDP composition");
        assert(detail.font >= 16); assert(detail.buttons.every((button) => button.width >= 44 && button.height >= 44), "Phone action target below 44px");
        await page.cdp.send("Input.insertText", { text: "\u6696\u8272\u5149\u7ebf" });
        await page.point(prompt);
        await page.screenshot(path.join(evidence, `phone-${width}-short-focused.png`));
        await page.point(runButton);
        await page.screenshot(path.join(evidence, `phone-${width}-short.png`));
        measurements.push({ width, ...detail });
        await page.viewport(width, 760, true);
      }
      assert.equal(generationRequests().length, runCount);
      const trace = await page.cdp.evaluate("window.__compositionTrace");
      assert(trace.some((event) => event.type === "compositionstart" && event.trusted), "CDP composition did not reach the native focused input");
      await page.viewport(760, 390, true);
      await page.point(prompt);
      await page.screenshot(path.join(evidence, "phone-landscape-focused.png"));
      await page.point(runButton);
      await page.screenshot(path.join(evidence, "phone-landscape-actions.png"));
      return { measurements, compositionTrace: trace, boundary: "Trusted Chromium CDP composition across resize; not physical OS IME or on-screen keyboard" };
    });
    await check("B7-save-native-reload", async () => {
      const runCount = generationRequests().length;
      await page.viewport(1440, 1000); await closeEditor();
      const before = await scene(canvasId);
      await page.click('[aria-label="\u753b\u5e03\u5de5\u5177\u680f"] button', "\u4fdd\u5b58\u5230\u8d26\u6237");
      await waitFor(() => account.documents.get(canvasId)?.canvas.hasSavedSnapshot === true);
      const saved = account.documents.get(canvasId).scene;
      assert(saved.nodes.some((entry) => entry.kind === "reference" && entry.source.kind === "imported"));
      await page.cdp.send("Page.reload", { ignoreCache: true }); await delay(1500);
      await page.ready(".react-flow");
      const after = await scene(canvasId);
      assert.deepEqual(after.nodes.map((entry) => entry.id).sort(), before.nodes.map((entry) => entry.id).sort());
      assert.deepEqual(after.nodes.map((entry) => ({ id: entry.id, position: entry.position })).sort((a, b) => a.id.localeCompare(b.id)), before.nodes.map((entry) => ({ id: entry.id, position: entry.position })).sort((a, b) => a.id.localeCompare(b.id)));
      assert.equal(generationRequests().length, runCount);
      await page.screenshot(path.join(evidence, "desktop-reloaded.png"));
      return { nodeCount: after.nodes.length, originalAssetIds: saved.nodes.filter((entry) => entry.kind === "reference").map((entry) => entry.source.assetId), nativeDatabase: "narra-canvas-drafts v1", noAutomaticRun: true };
    });
  }
  await page.viewport(1440, 1000);
  await check("U2-shared-standalone-and-folded-view", async () => {
    const runCount = generationRequests().length;
    await closeEditor(); await page.click("button", "Shared prompt compatibility");
    const before = await waitForScene(sharedId, (value) => value.nodes.length === 4, "Shared graph not loaded");
    await graphView(false);
    assert.equal(await page.cdp.evaluate("document.querySelectorAll('.react-flow__node').length"), 2);
    const creationCamera = structuredClone(before.viewport);
    await graphView(true);
    await waitFor(() => page.cdp.evaluate("document.querySelectorAll('.react-flow__node').length===4"));
    await page.screenshot(path.join(evidence, "shared-full-graph.png"));
    await graphView(false);
    await waitFor(() => page.cdp.evaluate("document.querySelectorAll('.react-flow__node').length===2"));
    assert.deepEqual(await scene(sharedId), before, "Switching views mutated the durable graph");
    await page.click(node(sharedGenerators[0])); await page.ready(prompt);
    assert(await page.cdp.evaluate(`document.querySelector(${JSON.stringify(editor)}).textContent.includes('\u5171\u4eab\u63d0\u793a\u8bcd')`));
    await page.type(prompt, "Shared edit remains shared without a second prompt");
    const edited = await waitForScene(sharedId, (value) => value.nodes.find((entry) => entry.id === sharedPromptId)?.text === "Shared edit remains shared without a second prompt", "Shared source edit was not accepted");
    assert.equal(edited.nodes.length, 4); assert.deepEqual(edited.edges, before.edges);
    assert.deepEqual(edited.viewport, creationCamera);
    await closeEditor(); await page.click(node(sharedGenerators[1])); await page.ready(prompt);
    assert.equal(await page.cdp.evaluate(`document.querySelector(${JSON.stringify(prompt)}).value`), "Shared edit remains shared without a second prompt");
    await page.screenshot(path.join(evidence, "shared-one-creation-surface.png"));
    await showNode(standalonePromptId);
    await waitFor(() => page.cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(node(standalonePromptId))}))`));
    assert.equal(await page.cdp.evaluate(`document.querySelector(${JSON.stringify(graphButton)}).getAttribute('aria-pressed')`), "true");
    assert.equal(generationRequests().length, runCount);
    return { sourceId: sharedPromptId, generators: sharedGenerators, standalonePromptId, noMigration: true, noAutomaticRun: true };
  });
  await check("B8-legacy-visible-anchor", async () => {
    const runCount = generationRequests().length;
    await closeEditor(); await page.click("button", "Legacy 24-node graph");
    await waitFor(async () => (await scene(legacyId)).nodes.length === 24);
    await graphView(false); await readyImage('.react-flow__node img');
    assert.equal(await page.cdp.evaluate("document.querySelectorAll('.react-flow__node').length"), 16);
    const before = await scene(legacyId); assert.equal(before.edges.length, 32);
    const point = await panePoint(); assert(point);
    await page.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, x: point.x, y: point.y });
    await page.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, x: point.x - 35, y: point.y - 25 });
    await page.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, x: point.x - 35, y: point.y - 25 });
    const panned = await waitForScene(legacyId, (value) => value.viewport.x !== before.viewport.x || value.viewport.y !== before.viewport.y, "Native blank-pane pan did not change the camera");
    await page.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: -120 }); await delay(250);
    const zoomed = await waitForScene(legacyId, (value) => value.viewport.zoom > panned.viewport.zoom, "Native wheel did not zoom the camera");
    await page.click("button", "\u65b0\u5efa\u56fe\u7247"); await page.ready(prompt);
    const after = await waitForScene(legacyId, (value) => value.nodes.length === 26, "Legacy graph quick creation was not committed");
    for (const original of before.nodes) assert.deepEqual(after.nodes.find((entry) => entry.id === original.id), original);
    const created = after.nodes.find((entry) => entry.kind === "generation" && !before.nodes.some((old) => old.id === entry.id));
    const rect = await page.inspect(node(created.id)); assert(rect?.visible, "Primary creation follows far-off legacy prompt");
    assert.deepEqual(after.viewport, zoomed.viewport, "Opening a creation composer changes the camera");
    assert.equal(generationRequests().length, runCount);
    await page.screenshot(path.join(evidence, "legacy-24-visible-create.png"));
    return { oldNodes: 24, oldEdges: 32, cameraBefore: before.viewport, pannedCamera: panned.viewport, camera: after.viewport, newPosition: created.position, rect };
  });
  await check("B9-200-node-capacity-smoke", async () => {
    const runCount = generationRequests().length;
    await closeEditor(); await page.click("button", "200-node capacity smoke");
    await waitFor(async () => (await scene(smokeId)).nodes.length === 200);
    await graphView(true);
    await page.click("button", "\u65b0\u5efa\u56fe\u7247"); await delay(250);
    assert.equal((await scene(smokeId)).nodes.length, 200);
    assert.equal(await page.cdp.evaluate("document.querySelectorAll('.react-flow__node').length"), 200);
    assert.equal(generationRequests().length, runCount);
    await page.screenshot(path.join(evidence, "capacity-200.png"));
    return { renderedNodes: 200, noPartialCreation: true, noFpsClaim: true };
  });
  const final = await verifyInputs("postbrowser", true);
  assert.equal(final.report.build.sha256, inputReport.build.sha256, "Built artifacts changed while serving");
  await writeJson(path.join(evidence, "source.json"), { before: inputReport, after: final.report, build: await buildIdentity(app) });
  await writeJson(path.join(evidence, "network.json"), { requests: api.requests, browserRequests: page.requests, thumbnails: thumbnailRequests, errors: page.errors, blockedExternal: page.externalRequests, pointApproaches: page.pointApproaches });
  await writeJson(path.join(evidence, "result.json"), { app, runId, checks: results, chrome: version.Browser, pinnedNode: process.version, boundaries: final.manifest.boundaries, physicalDevice: "unperformed", liveServices: "unperformed", actualCi: "unperformed" });
  console.log(JSON.stringify({ evidence, passed: results.filter((item) => item.passed).length, failed: results.filter((item) => !item.passed).map((item) => item.id), errors: page.errors }));
  process.exitCode = results.some((item) => !item.passed) || page.errors.length ? 1 : 0;
} finally {
  api.releaseAll(); page?.dispose(); page?.cdp.close(); browser?.close();
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  for (const child of children.reverse()) await stop(child);
}

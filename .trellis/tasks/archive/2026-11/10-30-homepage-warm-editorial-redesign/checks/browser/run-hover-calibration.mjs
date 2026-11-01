import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserPage, Cdp, delay, waitFor } from "./cdp.mjs";
import { helperIdentity } from "./input-identity.mjs";
import { calibrateNativeHover } from "./native-hover-calibration.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ownerRoot = await realpath(process.env.NARRA_CHECK_OWNER_ROOT);
const app = await realpath(process.cwd());
assert.equal(path.join(ownerRoot, "app"), app);
assert.equal(path.dirname(ownerRoot), await realpath(path.join(here, "../.runtime")));
const owner = JSON.parse(await readFile(path.join(ownerRoot, "owner.json"), "utf8"));
assert.equal(owner.workspace, app);
const runId = `hover-calibration-${Date.now()}`;
const evidence = path.join(here, "evidence", runId);
const profile = path.join(ownerRoot, `chrome-${runId}`);
await mkdir(evidence); await mkdir(profile);
const helpers = await helperIdentity(here);
const argv = ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-extensions", "--disable-default-apps", "--metrics-recording-only", "--no-proxy-server", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"];
const binary = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const child = spawn(binary, argv, { cwd: app, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.pipe(createWriteStream(path.join(evidence, "chrome.stdout.log")));
child.stderr.pipe(createWriteStream(path.join(evidence, "chrome.stderr.log")));
const result = { runId, passed: false, scope: "Plain native-input helper calibration only; no Next/product-source verdict", binary, argv, pid: child.pid, helpers };
let browser, tab;
try {
  const devtools = await waitFor(async () => {
    assert.equal(child.exitCode, null, "Owned Chrome exited before calibration");
    return (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).trim().split(/\r?\n/);
  }, { timeout: 20000 });
  browser = new Cdp(`ws://127.0.0.1:${devtools[0]}${devtools[1]}`);
  result.toolchain = { node: process.version, chrome: await browser.send("Browser.getVersion") };
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  await browser.send("Target.activateTarget", { targetId });
  const targets = await (await fetch(`http://127.0.0.1:${devtools[0]}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  tab = new BrowserPage(new Cdp(targets.find((target) => target.id === targetId).webSocketDebuggerUrl), "http://127.0.0.1:1");
  await tab.initialize();
  result.calibration = await calibrateNativeHover(tab, (samples) => writeFile(path.join(evidence, "samples.json"), JSON.stringify(samples, null, 2)));
  assert.deepEqual(await helperIdentity(here), helpers);
  result.passed = true;
} catch (error) {
  result.error = error.stack ?? String(error);
  if (tab) await tab.screenshot(path.join(evidence, "failure.png")).catch(() => {});
} finally {
  if (tab) { tab.dispose(); tab.cdp.close(); }
  if (browser) { await browser.send("Browser.close", {}, 3000).catch(() => {}); browser.close(); }
  if (child.exitCode === null) { child.kill(); await delay(350); }
  if (child.exitCode === null) child.kill("SIGKILL");
  result.exitCode = child.exitCode;
  await writeFile(path.join(evidence, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ runId, passed: result.passed, evidence, error: result.error }));
  process.exitCode = result.passed ? 0 : 1;
}

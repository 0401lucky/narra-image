import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { BrowserPage, Cdp, CDP_MODIFIERS, waitFor } from "./cdp.mjs";

export async function openRetentionBrowser({ base, env, start, stop, unusedPort, ownerRoot, evidence }) {
  const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  assert(existsSync(chrome), "An installed Chrome is required for native administrator checks");
  const profile = path.join(ownerRoot, `retention-chrome-${randomUUID()}`);
  mkdirSync(profile);
  const port = await unusedPort();
  const tracked = start(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], env, "retention-browser");
  let browser;
  let page;
  try {
    const version = await waitFor(async () => {
      try { return await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).json(); }
      catch { return null; }
    }, { timeout: 30_000, message: "Owned retention Chrome did not start" });
    browser = new Cdp(version.webSocketDebuggerUrl);
    const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
    const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`,
      { signal: AbortSignal.timeout(1000) })).json()).find((candidate) => candidate.id === targetId));
    page = new BrowserPage(new Cdp(target.webSocketDebuggerUrl), base);
    await page.initialize();
    await page.navigate("about:blank");
    await page.cdp.evaluate(`void (() => {
      document.body.innerHTML = '<button id="enabled" style="width:120px;height:48px">Enabled</button><button id="disabled" disabled>Disabled</button><input id="field">';
      window.__calibrationClicks = [];
      document.querySelector('#enabled').addEventListener('click', event => window.__calibrationClicks.push(event.isTrusted));
    })()`);
    await page.click("#enabled");
    await page.key("Enter");
    assert.deepEqual(await page.cdp.evaluate("window.__calibrationClicks"), [true, true]);
    await page.cdp.evaluate("void (document.querySelector('#enabled').disabled = true)");
    await page.key("Enter");
    assert.deepEqual(await page.cdp.evaluate("window.__calibrationClicks"), [true, true]);
    await page.cdp.evaluate("void (document.querySelector('#enabled').disabled = false)");
    await page.click("#enabled");
    await page.key("Tab");
    assert.equal(await page.cdp.evaluate("document.activeElement.id"), "field");
    await page.key("Tab", CDP_MODIFIERS.Shift);
    assert.equal(await page.cdp.evaluate("document.activeElement.id"), "enabled");
    writeFileSync(path.join(evidence, `calibration-${targetId}.json`), JSON.stringify({ trustedPointerAndEnter: true,
      disabledDidNotActivate: true, tabSkippedDisabled: true, reverseTab: true, chromeVersion: version.Browser }, null, 2) + "\n");
    return {
      page,
      async session(cookie) {
        const separator = cookie.indexOf("=");
        assert(separator > 0);
        const result = await page.cdp.send("Network.setCookie", { name: cookie.slice(0, separator), value: cookie.slice(separator + 1),
          url: base, httpOnly: true, secure: false, sameSite: "Lax" });
        assert(result.success, "Synthetic fixture session cookie was rejected");
      },
      async close() {
        page.dispose();
        page.cdp.close();
        await browser.send("Browser.close").catch(() => {});
        browser.close();
        await stop(tracked);
      },
    };
  } catch (error) {
    page?.dispose();
    page?.cdp.close();
    browser?.close();
    await stop(tracked);
    throw error;
  }
}

export async function selectNativeOption(page, selector, value) {
  await page.click(selector);
  const index = await page.cdp.evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).options).findIndex(option => option.value === ${JSON.stringify(value)})`);
  assert(index >= 0, `Missing native select option ${value}`);
  await page.key("Home");
  for (let offset = 0; offset < index; offset += 1) await page.key("ArrowDown");
  await page.key("Enter");
}

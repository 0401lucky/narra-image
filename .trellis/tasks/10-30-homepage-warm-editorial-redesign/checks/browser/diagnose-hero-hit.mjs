import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { delay, waitFor } from "./cdp.mjs";

export async function diagnoseHeroHit({ page, check, evidence }) {
  await check("diagnostic-hero-native-painted-control", async () => {
    const tab = await page();
    await tab.navigate("/");
    await waitFor(() => tab.cdp.evaluate("document.querySelector('[data-home-hero-frame]')?.dataset.imageState==='ready'"));
    await tab.cdp.evaluate("void (()=>{window.__diagnosticCopies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__diagnosticCopies.push(text)}})})()");
    await tab.click('[role="tab"]', "绘本叙事");
    await tab.click('[role="tab"]', "东方美学");
    await waitFor(() => tab.cdp.evaluate("document.querySelector('[data-home-hero-frame]')?.dataset.sceneId==='oriental'"));
    await delay(1000);
    const snapshot = () => tab.cdp.evaluate(`(()=>{
      const button=[...document.querySelectorAll('[data-home-hero-frame] button')].find(el=>el.textContent.includes('复用画面灵感')||el.textContent.includes('已复制完整提示词'));
      const r=button.getBoundingClientRect(),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2;
      const project=node=>node?{tag:node.tagName,text:node.textContent?.slice(0,30),classes:node.className}:null;
      const hit=project(document.elementFromPoint(x,y)),all=document.elementsFromPoint(x,y).slice(0,6).map(project),after=project(document.elementFromPoint(x,y));
      return {x,y,rect:r.toJSON(),hit,all,after,copies:[...window.__diagnosticCopies],trace:window.__nativeInputTrace.slice(-6)};
    })()`);
    const before = await snapshot();
    await tab.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: before.x, y: before.y });
    await delay(350);
    const approached = await snapshot();
    // Diagnostic only: a native press at the painted location records whether
    // Chromium actually targets the obstruction. This is not an accepted click.
    await tab.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: approached.x, y: approached.y });
    await tab.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: approached.x, y: approached.y });
    await delay(100);
    const pressed = await snapshot();
    const helper = await tab.inspect("[data-home-hero-frame] button", pressed.copies.length ? "已复制完整提示词" : "复用画面灵感");
    const report = { before, approached, pressed, helper, noProgrammaticClick: true };
    await writeFile(path.join(evidence, "hero-native-hit-diagnostic.json"), JSON.stringify(report, null, 2));
    assert.equal(pressed.copies.length, 1, "A native press at the painted hero copy control was obstructed");
    return report;
  });
}

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { delay, waitFor } from "./cdp.mjs";

export async function revealInterruptionChecks({ page, check, evidence }) {
  await check("M7-native-reveal-interruption-and-no-replay", async () => {
    const samples = [];
    for (const interruption of ["offscreen", "reduced-motion"]) {
      const tab = await page("home-member");
      await tab.navigate("/");
      await tab.ready('[data-work-id="home-001"]');
      await tab.settledFonts();
      const snapshot = () => tab.cdp.evaluate(`(()=>({hidden:document.hidden,scrollY,height:innerHeight,reduced:document.querySelector('[data-homepage]').dataset.motionReduced,entries:[...document.querySelectorAll('[data-gallery-card]')].slice(0,4).map(node=>({id:node.dataset.workId,rect:node.getBoundingClientRect().toJSON(),opacity:Number(getComputedStyle(node.parentElement).opacity),transform:getComputedStyle(node.parentElement).transform}))}))()`);
      await tab.cdp.evaluate(`void (()=>{window.__revealWheel=[];document.addEventListener('wheel',event=>window.__revealWheel.push({trusted:event.isTrusted,x:event.clientX,y:event.clientY,deltaY:event.deltaY}),{passive:true})})()`);
      const initial = await snapshot();
      await tab.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 1416, y: 500, deltaX: 0, deltaY: initial.entries[0].rect.top - 320 });
      let active;
      await waitFor(async () => {
        active = await snapshot();
        const first = active.entries[0];
        return first.rect.top > 64 && first.rect.top < active.height - 100 && first.opacity > 0 && first.opacity < 0.98;
      }, { timeout: 5000, message: "Observe a real in-progress entrance before interruption" });
      assert(active.entries.some((entry) => entry.opacity < active.entries[0].opacity), "Later cascade entries must still lag the first card");
      if (interruption === "offscreen") {
        await tab.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 1416, y: 500, deltaX: 0, deltaY: -active.scrollY });
        await waitFor(async () => (await snapshot()).entries[0].rect.top > tab.height);
      } else {
        await tab.reducedMotion(true);
        await waitFor(() => tab.cdp.evaluate("document.querySelector('[data-homepage]').dataset.motionReduced==='true'"));
      }
      const stopped = [];
      for (const duration of [80, 240, 700]) {
        await delay(duration);
        const current = await snapshot();
        stopped.push(current);
        for (const entry of current.entries) {
          assert(entry.opacity > 0.995, `${interruption}: ${entry.id} must remain visible after queued Motion renders`);
          assert.equal(entry.transform, "none", `${interruption}: interrupted entry cannot retain displacement`);
        }
      }
      if (interruption === "offscreen") {
        const current = await snapshot();
        await tab.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 1416, y: 500, deltaX: 0, deltaY: current.entries[0].rect.top - 320 });
      } else await tab.reducedMotion(false);
      const returned = [];
      for (let index = 0; index < 4; index += 1) {
        await delay(100);
        const current = await snapshot();
        returned.push(current);
        for (const entry of current.entries) assert(entry.opacity > 0.995 && entry.transform === "none", "Returning/re-enabling must not replay or restore interrupted values");
      }
      const wheel = await tab.cdp.evaluate("window.__revealWheel");
      assert(wheel.length > 0 && wheel.every((event) => event.trusted));
      samples.push({ interruption, initial, active, stopped, returned, wheel, programmaticScrollOrStyleMutation: false });
      await writeFile(path.join(evidence, "reveal-native-interruption.json"), JSON.stringify(samples, null, 2));
      await tab.screenshot(path.join(evidence, `gallery-after-${interruption}-interruption.png`));
    }
    return { samples };
  });
}

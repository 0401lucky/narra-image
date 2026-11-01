import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { delay, waitFor } from "./cdp.mjs";

export async function diagnoseGalleryEntrance({ page, check, evidence }) {
  await check("diagnostic-gallery-entrance-native-viewport", async () => {
    const tab = await page("home-member");
    const selector = '[data-gallery-card][data-work-id="home-001"]';
    const samples = [];
    await tab.navigate("/");
    await waitFor(() => tab.cdp.evaluate("document.querySelector('[data-homepage]')?.dataset.motionActive==='true'"));
    await tab.cdp.evaluate(`void (()=>{
      window.__galleryPointer=[];
      for(const type of ['pointermove','wheel'])document.addEventListener(type,event=>window.__galleryPointer.push({type,x:event.clientX,y:event.clientY,trusted:event.isTrusted,target:event.target.tagName}),{passive:true});
      window.__galleryStyleWrites=[];
      const entrance=document.querySelector(${JSON.stringify(selector)}).parentElement;
      window.__galleryStyleObserver=new MutationObserver(records=>{
        for(const record of records)window.__galleryStyleWrites.push({at:performance.now(),old:record.oldValue,current:entrance.getAttribute('style')});
      });
      window.__galleryStyleObserver.observe(entrance,{attributes:true,attributeFilter:['style'],attributeOldValue:true});
    })()`);
    async function sample(label) {
      const value = await tab.cdp.evaluate(`(()=>{
        const card=document.querySelector(${JSON.stringify(selector)}),entrance=card.parentElement;
        const project=el=>({tag:el.tagName,rect:el.getBoundingClientRect().toJSON(),opacity:getComputedStyle(el).opacity,transform:getComputedStyle(el).transform,inline:el.getAttribute('style'),animations:el.getAnimations().map(a=>({playState:a.playState,currentTime:a.currentTime,startTime:a.startTime,pending:a.pending,timing:a.effect.getComputedTiming(),keyframes:a.effect.getKeyframes()}))});
        return {at:performance.now(),width:innerWidth,height:innerHeight,scrollY,hidden:document.hidden,card:project(card),entrance:project(entrance),section:project(document.querySelector('#gallery')),pointer:window.__galleryPointer.slice(-8),styleWrites:window.__galleryStyleWrites.slice(-16)};
      })()`);
      samples.push({ label, ...value });
      return value;
    }
    try {
      await sample("before-point");
      await tab.point(selector);
      await sample("after-original-point");
      await delay(800);
      const beforeHover = await sample("before-original-hover");
      const r = beforeHover.card.rect;
      const requested = { x: r.left + r.width * 0.8, y: r.top + r.height * 0.25 };
      samples.push({ label: "original-hover-request", ...requested, insideViewport: requested.x >= 0 && requested.x < beforeHover.width && requested.y >= 0 && requested.y < beforeHover.height });
      await tab.hover(selector, null, 0, [0.8, 0.25]);
      for (let index = 0; index < 5; index += 1) { await delay(400); await sample(`original-hover-${index}`); }
      await tab.screenshot(path.join(evidence, "gallery-entrance-original-hover.png"));

      // Native viewport movement only; never force the animation or its styles.
      const beforeScroll = await sample("before-full-card-native-scroll");
      const delta = beforeScroll.card.rect.top - 260;
      await tab.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: tab.width - 24, y: tab.height / 2, deltaX: 0, deltaY: delta });
      await delay(250);
      const centered = await sample("after-full-card-native-scroll");
      const c = centered.card.rect;
      const x = c.left + c.width * 0.8, y = c.top + c.height * 0.25;
      assert(x > 0 && x < centered.width && y > 64 && y < centered.height);
      const hit = await tab.cdp.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)}),hit=document.elementFromPoint(${x},${y});return {correct:hit===node||node.contains(hit),tag:hit?.tagName}})()`);
      assert(hit.correct, "Corrected diagnostic point must hit the real card");
      await tab.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      for (let index = 0; index < 5; index += 1) { await delay(400); await sample(`visible-hover-${index}`); }
      await tab.screenshot(path.join(evidence, "gallery-entrance-visible-hover.png"));
      assert(Number(samples.at(-1).entrance.opacity) > 0.995, "Fully visible native-hovered card must finish its unchanged opacity contract");
      return { samples, correctedPoint: { x, y, hit }, noProductMutation: true };
    } finally {
      await tab.cdp.evaluate("void window.__galleryStyleObserver.disconnect()");
      await writeFile(path.join(evidence, "gallery-entrance-diagnostic.json"), JSON.stringify({ samples, noProductMutation: true }, null, 2));
    }
  });
}

import assert from "node:assert/strict";

import { delay } from "./cdp.mjs";

// Plain browser controls isolate input-driver mistakes from product animation.
export async function calibrateNativeHover(tab, record = async () => {}) {
  const samples = [];
  async function setup(nested = false, blocked = false) {
    await tab.navigate("about:blank");
    await tab.cdp.evaluate(`void (()=>{
      document.body.style.cssText='margin:0;height:2400px';
      const viewport=document.createElement('div');viewport.id='calibration-clip';
      viewport.style.cssText=${JSON.stringify(nested ? "position:absolute;left:80px;top:120px;width:440px;height:180px;overflow-y:auto" : "position:absolute;left:80px;top:980px;width:440px;height:500px")};
      const target=document.createElement('button');target.type='button';target.id='calibration-hover';target.textContent='Native hover target';
      target.style.cssText='display:block;width:400px;height:240px;flex-shrink:0;margin-top:${nested ? 160 : 0}px';viewport.append(target);document.body.append(viewport);
      ${blocked ? "const cover=document.createElement('div');cover.id='calibration-cover';cover.style.cssText='position:fixed;inset:0;z-index:10;background:#ddd';document.body.append(cover);" : ""}
      window.__hoverCalibration=[];
      for(const type of ['pointermove','wheel','click'])document.addEventListener(type,event=>window.__hoverCalibration.push({type,target:event.target.id,x:event.clientX,y:event.clientY,trusted:event.isTrusted}),{passive:true});
    })()`);
  }
  async function state() {
    return tab.cdp.evaluate(`(()=>{const node=document.querySelector('#calibration-hover'),clip=document.querySelector('#calibration-clip'),r=node.getBoundingClientRect(),c=clip.getBoundingClientRect();return {rect:r.toJSON(),clip:c.toJSON(),innerWidth,innerHeight,scrollY,scrollTop:clip.scrollTop,events:window.__hoverCalibration}})()`);
  }
  try {
    for (const nested of [false, true]) {
      await setup(nested);
      const before = await state();
      const oldPoint = { x: before.rect.left + before.rect.width * 0.8, y: before.rect.top + before.rect.height * 0.25 };
      assert(nested ? oldPoint.y > before.clip.bottom : oldPoint.y > before.innerHeight, "Calibration must start with the old requested fraction outside its visible boundary");
      await tab.hover("#calibration-hover", null, 0, [0.8, 0.25]);
      const after = await state();
      samples.push({ label: nested ? "nested-clipping" : "viewport-sliver", before, oldPoint, after });
      await record(samples);
      const event = after.events.filter((item) => item.type === "pointermove").at(-1);
      assert(event?.trusted && event.target === "calibration-hover", "Real trusted hover must reach the requested target");
      assert(event.x > 0 && event.x < after.innerWidth && event.y > 0 && event.y < after.innerHeight, "Requested hover fraction must be inside the viewport, not just a visible sliver of the element");
      if (nested) {
        assert(after.scrollTop > 0, "Clipped target must be reached by native ancestor scrolling");
        assert(event.x > after.clip.left && event.x < after.clip.right && event.y > after.clip.top && event.y < after.clip.bottom);
      } else assert(after.scrollY > 0, "Offscreen requested point must be reached by native document scrolling");
      assert(after.events.some((item) => item.type === "wheel" && item.trusted));
      assert(!after.events.some((item) => item.type === "click"));
    }
    await setup(true, true);
    const before = await state();
    await assert.rejects(tab.hover("#calibration-hover", null, 0, [0.8, 0.25]), /occluded|clipped/);
    await delay(50);
    const after = await state();
    assert(!after.events.some((event) => event.target === "calibration-hover" && (event.type === "pointermove" || event.type === "click")), "Covered control must not be credited as hovered");
    samples.push({ label: "cover-negative-control", before, after, rejected: true });
    return { samples, noProgrammaticScrollFocusClick: true };
  } finally {
    await record(samples);
  }
}

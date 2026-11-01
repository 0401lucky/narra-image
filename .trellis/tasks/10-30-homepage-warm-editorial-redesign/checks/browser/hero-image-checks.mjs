import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { CDP_MODIFIERS, delay, waitFor } from "./cdp.mjs";
import { HERO_SCENE_CONTRACT } from "./hero-scene-contract.mjs";
import { calibrateNativeEnter, calibrateNativeTabTraversal } from "./native-keyboard-calibration.mjs";

const frameSelector = "[data-home-hero-frame]";
const sceneImage = "[data-home-scene-image]";
const copySelector = `${frameSelector} [role="tabpanel"] > div:last-child button`;

export function heroImagesReady(assets) {
  return HERO_SCENE_CONTRACT.every((scene) => assets.some((asset) => asset.id === scene.id && asset.url === scene.image && asset.available && asset.width > 0 && asset.height > 0));
}

async function sceneState(tab) {
  return tab.cdp.evaluate(`(()=>{
    const frame=document.querySelector('${frameSelector}'),image=document.querySelector('${sceneImage}'),typed=document.querySelector('[data-home-typewriter]');
    if(!frame||!image||!typed)return null;
    const style=getComputedStyle(image),viewportNode=document.querySelector('[data-home-hero-viewport]'),viewport=viewportNode.getBoundingClientRect(),promptNode=typed.parentElement.parentElement;
    return {id:frame.dataset.sceneId,state:frame.dataset.imageState,source:new URL(image.currentSrc||image.src).pathname,alt:image.alt,natural:[image.naturalWidth,image.naturalHeight],attributes:[Number(image.getAttribute('width')),Number(image.getAttribute('height'))],rendered:image.getBoundingClientRect().toJSON(),layout:[image.offsetWidth,image.offsetHeight],objectFit:style.objectFit,objectPosition:style.objectPosition,complete:image.complete,selected:[...frame.querySelectorAll('[role=tab][aria-selected=true]')].map(el=>el.textContent),prompt:typed.previousElementSibling?.textContent,typed:typed.textContent,frameText:frame.textContent,opacity:Number(style.opacity),animation:style.animationName,animationState:style.animationPlayState,viewport:viewport.toJSON(),viewportPosition:getComputedStyle(viewportNode).position,promptRect:promptNode.getBoundingClientRect().toJSON(),promptPosition:getComputedStyle(promptNode).position,windowWidth:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth};
  })()`);
}

async function waitScene(tab, id) {
  const state = await waitFor(async () => {
    const value = await sceneState(tab);
    return value?.id === id && value.state === "ready" && value.complete && value.natural[0] > 0 ? value : null;
  }, { timeout: 16000, message: `Actual delivered scene failed to decode: ${id}` });
  await tab.cdp.evaluate(`document.querySelector('${sceneImage}').decode().then(()=>true)`);
  return state;
}

function assertScene(state, scene, assets) {
  const asset = assets.find((entry) => entry.id === scene.id);
  assert(asset?.available, `No real delivered bitmap receipt for ${scene.id}`);
  assert.equal(asset.sha256, scene.sha256);
  assert.equal(state.id, scene.id);
  assert.equal(state.state, "ready");
  assert.equal(state.source, scene.image);
  assert.equal(state.alt, scene.alt);
  assert.deepEqual(state.natural, [asset.width, asset.height]);
  assert.deepEqual(state.attributes, [asset.width, asset.height], "DOM dimensions must describe the actual delivered bitmap");
  assert.deepEqual(state.natural, [scene.width, scene.height]);
  assert.equal(state.objectFit, "cover");
  assert.equal(state.objectPosition, "50% 50%");
  assert(Math.abs(state.layout[0] / state.layout[1] - 4 / 3) < 0.02);
  assert.deepEqual(state.selected, [scene.label]);
  assert.equal(state.prompt, scene.prompt);
  assert(state.frameText.includes(scene.lightLabel));
  assert(state.frameText.includes(scene.preset));
  assert(state.frameText.includes("固定示意图 · 非模型参数"));
  assert(Math.abs(state.viewport.width / state.viewport.height - 4 / 3) < 0.015);
  if (state.windowWidth < 640) {
    assert.equal(state.viewportPosition, "relative");
    assert.equal(state.promptPosition, "relative");
    assert(state.promptRect.top >= state.viewport.bottom + 9, "Phone prompt must sit below the complete 4:3 artwork, not cover its subject");
  } else {
    assert.equal(state.viewportPosition, "absolute");
    assert.equal(state.promptPosition, "absolute");
    assert(state.promptRect.top < state.viewport.bottom && state.promptRect.bottom <= state.viewport.bottom, "Desktop/tablet retains the original prompt overlay composition");
  }
  assert.equal(state.overflow, false);
}

async function fastClick(tab, selector, text = null, touch = false) {
  let point = await tab.point(selector, text);
  if (touch) {
    await tab.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y }] });
    await tab.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await tab.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await delay(70);
    point = await tab.point(selector, text);
    await tab.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: point.x, y: point.y });
    await tab.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: point.x, y: point.y });
  }
}

async function copyProbe(tab) {
  await tab.cdp.evaluate(`void (()=>{window.__heroCopies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{window.__heroCopies.push({text,id:document.querySelector('${frameSelector}').dataset.sceneId,typed:document.querySelector('[data-home-typewriter]').textContent})}}})})()`);
}

async function copyCenter(tab) {
  return tab.cdp.evaluate(`(()=>{
    const button=document.querySelector(${JSON.stringify(copySelector)}),frame=document.querySelector('${frameSelector}'),image=document.querySelector('${sceneImage}'),root=document.querySelector('[data-homepage]');
    const r=button.getBoundingClientRect(),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2;
    const clip={left:0,top:0,right:innerWidth,bottom:innerHeight};let fixed=false;
    for(let parent=button;parent;parent=parent.parentElement){const s=getComputedStyle(parent);if(s.position==='fixed')fixed=true;if(parent!==button&&!fixed&&/(hidden|clip|auto|scroll)/.test(s.overflow+s.overflowX+s.overflowY)){const p=parent.getBoundingClientRect();clip.left=Math.max(clip.left,p.left);clip.top=Math.max(clip.top,p.top);clip.right=Math.min(clip.right,p.right);clip.bottom=Math.min(clip.bottom,p.bottom)}}
    const hit=document.elementFromPoint(x,y);
    return {at:performance.now(),x,y,rect:r.toJSON(),clip,visible:x>clip.left&&x<clip.right&&y>clip.top&&y<clip.bottom,hit:hit===button||button.contains(hit),hitTag:hit?.tagName,disabled:button.disabled,scene:frame.dataset.sceneId,ready:frame.dataset.imageState==='ready'&&image.complete&&image.naturalWidth>0,frameTransform:getComputedStyle(frame).transform,pointerActive:frame.dataset.pointerActive,rotateX:parseFloat(frame.style.getPropertyValue('--rotate-x')),rotateY:parseFloat(frame.style.getPropertyValue('--rotate-y')),paused:root.dataset.motionPaused,reduced:root.dataset.motionReduced,copyCount:window.__heroCopies.length};
  })()`);
}

async function nativeCenterCopy(tab, scene, touch = false) {
  await tab.point(copySelector);
  const before = await copyCenter(tab);
  assert(before.visible && before.ready && before.hit && !before.disabled, `Painted copy center must hit its real button before approach: ${JSON.stringify(before)}`);
  if (!touch) {
    await tab.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: before.x, y: before.y });
    await delay(300);
  }
  const pressed = await copyCenter(tab);
  assert(pressed.visible && pressed.ready && pressed.hit && !pressed.disabled, `Re-hit the actual center after native tilt settles: ${JSON.stringify(pressed)}`);
  if (touch) {
    await tab.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pressed.x, y: pressed.y }] });
    await tab.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await tab.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: pressed.x, y: pressed.y });
    await tab.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: pressed.x, y: pressed.y });
  }
  const copied = await waitFor(() => tab.cdp.evaluate(`window.__heroCopies.length>${pressed.copyCount}?window.__heroCopies.at(-1):null`));
  assert.equal(copied.id, scene.id);
  assert.equal(copied.text, scene.prompt);
  const events = await tab.cdp.evaluate(`window.__nativeInputTrace.filter(event=>event.at>=${pressed.at})`);
  assert.deepEqual(events.map((event) => event.type), ["pointerdown", "pointerup", "click"]);
  assert(events.every((event) => event.heroCopy && event.trusted && event.scene === scene.id), "Native down/up/click must target the real copy control, not a painted-over image");
  assert.equal(events[0].pointerType, touch ? "touch" : "mouse");
  assert.equal(await tab.cdp.evaluate("window.__heroCopies.length"), pressed.copyCount + 1);
  return { before, pressed, copied, events };
}

async function installDustProbe(tab) {
  await tab.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(()=>{
    const counts={frames:0,arcs:0,lastArcCount:0,perFrame:0},clear=CanvasRenderingContext2D.prototype.clearRect,arc=CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.hasAttribute('data-home-dust')){counts.frames++;counts.lastArcCount=counts.perFrame;counts.perFrame=0}return clear.apply(this,args)};
    CanvasRenderingContext2D.prototype.arc=function(...args){if(this.canvas.hasAttribute('data-home-dust')){counts.arcs++;counts.perFrame++}return arc.apply(this,args)};
    window.__heroDustProbe=counts;
  })()` });
}

async function dustState(tab) {
  return tab.cdp.evaluate(`(()=>{
    const canvas=document.querySelector('[data-home-dust]'),root=document.querySelector('[data-homepage]'),frame=document.querySelector('${frameSelector}');
    const scans=frame?[...frame.querySelectorAll('i')].filter(el=>getComputedStyle(el).animationName.includes('scanLine')):[];
    return {counts:{...window.__heroDustProbe},active:canvas?.dataset.dustActive,dimensions:canvas?[canvas.width,canvas.height]:null,rect:canvas?{width:canvas.getBoundingClientRect().width,height:canvas.getBoundingClientRect().height}:null,paused:root?.dataset.motionPaused,reduced:root?.dataset.motionReduced,motionActive:root?.dataset.motionActive,hidden:document.hidden,scan:scans.map(el=>({top:getComputedStyle(el).top,opacity:getComputedStyle(el).opacity,animation:getComputedStyle(el).animationName,state:getComputedStyle(el).animationPlayState})),frameTransform:frame?getComputedStyle(frame).transform:null};
  })()`);
}

async function stationaryDust(tab, expectedActive) {
  await waitFor(async () => (await dustState(tab)).active === String(expectedActive));
  const before = await dustState(tab);
  await delay(360);
  const after = await dustState(tab);
  if (expectedActive) assert(after.counts.frames > before.counts.frames, "Visible active hero should paint real dust frames");
  else assert.equal(after.counts.frames, before.counts.frames, "Inactive hero must stop scheduling dust frames");
  return { before, after };
}

export async function heroImageChecks({ page, check, evidence, browser, heroAssets, unresolved }) {
  if (!heroImagesReady(heroAssets)) {
    unresolved.push({ id: "H2-real-image-success", reason: "Real delivered images not present in this snapshot; success cases not executed." });
    return;
  }

  for (const [width, height, touch] of [[1440, 1000, false], [390, 844, true], [320, 844, true], [768, 1000, false], [1024, 1000, false]]) {
    await check(`H2-real-three-scene-decode-layout-${width}`, async () => {
      const tab = await page("home-member");
      await tab.viewport(width, height, touch);
      await tab.navigate("/");
      await tab.settledFonts();
      const states = [];
      for (const scene of HERO_SCENE_CONTRACT) {
        if (scene.id !== "film") await tab.click('[role="tab"]', scene.label, 0, touch);
        const state = await waitScene(tab, scene.id);
        assertScene(state, scene, heroAssets);
        states.push(state);
        await tab.point("[role=tablist]");
        await waitFor(() => tab.cdp.evaluate(`document.querySelector('[data-home-typewriter]').textContent===${JSON.stringify(scene.prompt)}`));
        await delay(800);
        await tab.screenshot(path.join(evidence, `hero-${scene.id}-${width}.png`));
        const art = await tab.cdp.evaluate(`document.querySelector('${frameSelector}').getBoundingClientRect().toJSON()`);
        await tab.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: width - 8, y: height / 2, deltaX: 0, deltaY: art.top - 90 });
        await delay(500);
        const visibleArt = await tab.cdp.evaluate(`document.querySelector('${frameSelector}').getBoundingClientRect().toJSON()`);
        assert(visibleArt.top >= 64 && visibleArt.bottom <= height, "Artwork screenshot must contain the complete real frame");
        await tab.screenshot(path.join(evidence, `hero-${scene.id}-${width}-full-frame.png`));
      }
      assert.equal(tab.externalRequests.length, 0, "Delivered images/fonts cannot require external browser requests");
      assert.equal(tab.requests.filter((request) => request.method !== "GET").length, 0);
      return { states, imageReceipts: heroAssets, externalRequests: [] };
    });
  }

  for (const [width, height, touch] of [[1440, 1000, false], [390, 844, true]]) {
    await check(`H3-current-full-copy-during-typewriter-${width}`, async () => {
      const tab = await page();
      await tab.viewport(width, height, touch);
      await tab.navigate("/");
      await waitScene(tab, "film");
      await copyProbe(tab);
      const samples = [];
      // Returning to film restarts its real typewriter without depending on startup timing.
      for (const scene of [...HERO_SCENE_CONTRACT.slice(1), HERO_SCENE_CONTRACT[0]]) {
        await tab.point('[role="tablist"]');
        await fastClick(tab, '[role="tab"]', scene.label, touch);
        await waitScene(tab, scene.id);
        const sample = await nativeCenterCopy(tab, scene, touch);
        assert(sample.copied.typed.length < scene.prompt.length, "This check must actually copy before typing has finished");
        samples.push(sample);
      }
      return { samples, pointApproaches: tab.pointApproaches };
    });
  }

  await check("H4-rapid-requests-latest-committed-image-prompt", async () => {
    const tab = await page();
    await tab.cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await tab.navigate("/");
    await waitScene(tab, "film");
    await copyProbe(tab);
    await tab.cdp.evaluate(`void (()=>{
      const samples=[];window.__sceneSamples=samples;
      const record=()=>{const frame=document.querySelector('${frameSelector}'),image=document.querySelector('${sceneImage}'),typed=document.querySelector('[data-home-typewriter]');if(frame&&image&&typed)samples.push({id:frame.dataset.sceneId,source:image.getAttribute('src'),prompt:typed.previousElementSibling.textContent,selected:frame.querySelector('[role=tab][aria-selected=true]')?.textContent})};
      window.__sceneObserver=new MutationObserver(record);window.__sceneObserver.observe(document.querySelector('${frameSelector}'),{subtree:true,childList:true,attributes:true,characterData:true});record();
    })()`);
    tab.delayRequest(HERO_SCENE_CONTRACT[1].image, 2400);
    tab.delayRequest(HERO_SCENE_CONTRACT[2].image, 1100);
    await fastClick(tab, '[role="tab"]', HERO_SCENE_CONTRACT[1].label);
    await fastClick(tab, '[role="tab"]', HERO_SCENE_CONTRACT[2].label);
    await fastClick(tab, '[role="tab"]', HERO_SCENE_CONTRACT[0].label);
    await delay(2700);
    assertScene(await waitScene(tab, "film"), HERO_SCENE_CONTRACT[0], heroAssets);
    await fastClick(tab, '[role="tab"]', HERO_SCENE_CONTRACT[1].label);
    await fastClick(tab, '[role="tab"]', HERO_SCENE_CONTRACT[2].label);
    await waitScene(tab, "oriental");
    await delay(2700);
    assertScene(await sceneState(tab), HERO_SCENE_CONTRACT[2], heroAssets);
    const copy = await nativeCenterCopy(tab, HERO_SCENE_CONTRACT[2]);
    const samples = await tab.cdp.evaluate("window.__sceneSamples");
    await tab.cdp.evaluate("void window.__sceneObserver.disconnect()");
    for (const sample of samples) {
      const scene = HERO_SCENE_CONTRACT.find((entry) => entry.id === sample.id);
      assert(scene);
      assert.equal(sample.source, scene.image);
      assert.equal(sample.prompt, scene.prompt);
      assert.equal(sample.selected, scene.label);
    }
    for (const scene of HERO_SCENE_CONTRACT.slice(1)) {
      assert(tab.delayDeliveries.some((entry) => entry.url.endsWith(scene.image) && entry.continuedAt !== null && !entry.error), `The ${scene.id} late network delivery must actually occur`);
    }
    await writeFile(path.join(evidence, "scene-rapid-commit-samples.json"), JSON.stringify(samples, null, 2));
    return { sampleCount: samples.length, finalScene: "oriental", copy, delayedDeliveries: tab.delayDeliveries, pointApproaches: tab.pointApproaches, delays: "Only loopback image request delivery was delayed; actual bytes were not replaced." };
  });

  await check("H5-real-fade-dust-scan-tilt-pause-reduced", async () => {
    const tab = await page();
    await installDustProbe(tab);
    await tab.navigate("/");
    await waitScene(tab, "film");
    const visible = await stationaryDust(tab, true);
    assert.equal(visible.after.counts.lastArcCount, 32);
    assert(visible.after.dimensions[0] <= 2048 && visible.after.dimensions[1] <= 2048);
    const scanFirst = await dustState(tab);
    assert.equal(scanFirst.scan.length, 1, "Ready image should show one actual scanning animation");
    await delay(450);
    const scanNext = await dustState(tab);
    assert.notEqual(scanNext.scan[0].top, scanFirst.scan[0].top, "CSS scan line must actually move");
    await tab.hover(frameSelector, null, 0, [0.82, 0.25]);
    const tilt = await dustState(tab);
    assert.notEqual(tilt.frameTransform, "none");
    await fastClick(tab, '[role="tab"]', HERO_SCENE_CONTRACT[1].label);
    const fading = await waitScene(tab, "storybook");
    assert(fading.animation.includes("sceneAppear"));
    assert(fading.opacity < 1, "Transition must be sampled during the real image fade");
    await waitFor(async () => (await sceneState(tab)).opacity === 1);
    await tab.click('[aria-label="暂停装饰动效"]');
    const paused = await stationaryDust(tab, false);
    assert.equal((await sceneState(tab)).typed, HERO_SCENE_CONTRACT[1].prompt);
    assert.equal((await sceneState(tab)).animation, "none");
    assert.equal(paused.after.frameTransform, "none");
    assert.equal(paused.after.scan.length, 0, "Pause removes the decorative scan animation");
    await tab.click('[aria-label="恢复装饰动效"]');
    const resumed = await stationaryDust(tab, true);
    await tab.reducedMotion(true);
    const reduced = await stationaryDust(tab, false);
    assert.equal(reduced.after.scan.length, 0);
    assert.equal(reduced.after.frameTransform, "none");
    await tab.click('[role="tab"]', HERO_SCENE_CONTRACT[2].label);
    const reducedScene = await waitScene(tab, "oriental");
    assert.equal(reducedScene.typed, HERO_SCENE_CONTRACT[2].prompt);
    assert.equal(reducedScene.animation, "none");
    await tab.reducedMotion(false);
    await stationaryDust(tab, true);
    return { visible, scanFirst, scanNext, tilt, fading, paused, resumed, reduced, reducedScene };
  });

  await check("H6-real-dust-offscreen-background-unmount-remount", async () => {
    const tab = await page("home-member");
    await installDustProbe(tab);
    await tab.navigate("/");
    await waitScene(tab, "film");
    await stationaryDust(tab, true);
    await tab.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 1420, y: 850, deltaX: 0, deltaY: 1800 });
    const offscreen = await stationaryDust(tab, false);
    assert(offscreen.after.scan.every((scan) => scan.state === "paused"));
    await tab.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 1420, y: 300, deltaX: 0, deltaY: -4000 });
    await waitFor(() => tab.cdp.evaluate("scrollY===0"));
    await stationaryDust(tab, true);
    const background = await browser.send("Target.createTarget", { url: "about:blank", background: false });
    let hidden;
    try {
      await browser.send("Target.activateTarget", { targetId: background.targetId });
      await waitFor(() => tab.cdp.evaluate("document.hidden"), { timeout: 6000, message: "Chrome did not actually hide the hero tab; visibility acceptance cannot be inferred" });
      hidden = await stationaryDust(tab, false);
      assert.equal(hidden.after.hidden, true);
      assert(hidden.after.scan.every((scan) => scan.state === "paused"));
    } finally {
      await browser.send("Target.activateTarget", { targetId: tab.targetId });
      await browser.send("Target.closeTarget", { targetId: background.targetId });
    }
    await waitFor(() => tab.cdp.evaluate("!document.hidden"));
    const foreground = await stationaryDust(tab, true);
    await tab.click('header a[href="/works"]');
    await waitFor(() => tab.cdp.evaluate("location.pathname==='/works'&&!document.querySelector('[data-home-dust]')"));
    const before = await dustState(tab);
    await delay(700);
    const after = await dustState(tab);
    assert.equal(after.counts.frames, before.counts.frames, "Unmounted hero must not continue painting");
    await tab.click('header a[href="/"]');
    await waitFor(() => tab.cdp.evaluate("location.pathname==='/'"));
    await waitScene(tab, "film");
    const remounted = await stationaryDust(tab, true);
    return { offscreen, hidden, foreground, unmounted: { before, after }, remounted };
  });

  await check("H7-secondary-image-network-failure-preserves-ready-scene", async () => {
    const tab = await page();
    await tab.cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await tab.navigate("/");
    await waitScene(tab, "film");
    tab.serve(HERO_SCENE_CONTRACT[1].image, "Forced fixture image failure", "text/plain", 503);
    await tab.click('[role="tab"]', HERO_SCENE_CONTRACT[1].label);
    await waitFor(() => tab.cdp.evaluate(`document.querySelector('${frameSelector}').textContent.includes('已保留当前场景')`));
    assertScene(await sceneState(tab), HERO_SCENE_CONTRACT[0], heroAssets);
    tab.unserve(HERO_SCENE_CONTRACT[1].image);
    await tab.click(`${frameSelector} [role=status] button`, "重试");
    assertScene(await waitScene(tab, "storybook"), HERO_SCENE_CONTRACT[1], heroAssets);
    return { failedTarget: "storybook", preservedScene: "film", retryDecodedRealFile: true };
  });

  await check("H8-native-copy-from-all-tilted-corners-all-scenes", async () => {
    const tab = await page();
    await tab.navigate("/");
    await waitScene(tab, "film");
    await copyProbe(tab);
    const samples = [];
    for (const scene of HERO_SCENE_CONTRACT) {
      if (scene.id !== "film") await tab.click('[role="tab"]', scene.label);
      await waitScene(tab, scene.id);
      await waitFor(async () => (await sceneState(tab)).opacity === 1);
      for (const [corner, position] of [["top-left", [0.1, 0.1]], ["top-right", [0.9, 0.1]], ["bottom-left", [0.1, 0.9]], ["bottom-right", [0.9, 0.9]]]) {
        await tab.hover(frameSelector, null, 0, position);
        await delay(300);
        const tilted = await copyCenter(tab);
        assert.equal(tilted.pointerActive, "true");
        assert(Math.abs(tilted.rotateX) > 2 && Math.abs(tilted.rotateY) > 2, "All four real pointer corners must produce substantial two-axis tilt");
        assert.equal(Math.sign(tilted.rotateX), position[1] < 0.5 ? 1 : -1);
        assert.equal(Math.sign(tilted.rotateY), position[0] < 0.5 ? -1 : 1);
        assert.notEqual(tilted.frameTransform, "none");
        assert(tilted.visible && tilted.hit, "Painted center must remain natively hit-testable at every tilted corner");
        const copy = await nativeCenterCopy(tab, scene);
        assert.equal(copy.pressed.pointerActive, "true");
        assert.notEqual(copy.pressed.frameTransform, "none");
        samples.push({ scene: scene.id, corner, tilted, copy });
      }
    }
    await writeFile(path.join(evidence, "hero-native-corner-copies.json"), JSON.stringify(samples, null, 2));
    return { samples, nativeMouseCopies: samples.length, controlsForced: false, decorativeEffectsDisabled: false };
  });

  await check("H9-native-copy-paused-reduced-mouse-touch-all-scenes", async () => {
    const samples = [];
    for (const [width, height, touch] of [[1440, 1000, false], [390, 844, true]]) {
      const tab = await page();
      await tab.viewport(width, height, touch);
      await tab.navigate("/");
      await waitScene(tab, "film");
      await copyProbe(tab);
      await tab.click("[data-home-motion-toggle]", null, 0, touch);
      for (const mode of ["paused", "reduced"]) {
        if (mode === "reduced") {
          await tab.click("[data-home-motion-toggle]", null, 0, touch);
          await tab.reducedMotion(true);
        }
        await waitFor(() => tab.cdp.evaluate(`document.querySelector('[data-homepage]').dataset.${mode === "paused" ? "motionPaused" : "motionReduced"}==='true'`));
        for (const scene of HERO_SCENE_CONTRACT) {
          await tab.click('[role="tab"]', scene.label, 0, touch);
          const state = await waitScene(tab, scene.id);
          assertScene(state, scene, heroAssets);
          assert.equal(state.typed, scene.prompt);
          const copy = await nativeCenterCopy(tab, scene, touch);
          assert.equal(copy.pressed.frameTransform, "none");
          assert.equal(copy.pressed.pointerActive, "false");
          samples.push({ width, mode, scene: scene.id, copy });
        }
      }
    }
    return { samples, nativeCopies: samples.length };
  });

  await check("H10-keyboard-scene-tabs-and-native-copy-all-scenes", async () => {
    const tab = await page();
    const calibration = await calibrateNativeEnter(tab);
    await writeFile(path.join(evidence, "native-enter-calibration.json"), JSON.stringify(calibration, null, 2));
    const traversalCalibration = await calibrateNativeTabTraversal(tab);
    await writeFile(path.join(evidence, "native-tab-calibration.json"), JSON.stringify(traversalCalibration, null, 2));
    await tab.navigate("/");
    await waitScene(tab, "film");
    await copyProbe(tab);
    let focused = false;
    for (let step = 0; step < 45; step += 1) {
      await tab.key("Tab");
      focused = await tab.cdp.evaluate("document.activeElement?.matches('[role=tab][aria-selected=true]')");
      if (focused) break;
    }
    assert(focused, "Native Tab traversal must reach the selected hero tab without programmatic focus");
    const samples = [];
    for (const scene of HERO_SCENE_CONTRACT) {
      if (scene.id !== "film") await tab.key("ArrowRight");
      await waitScene(tab, scene.id);
      assert.equal(await tab.cdp.evaluate("document.activeElement?.textContent"), scene.label);
      await tab.key("Tab");
      assert.equal(await tab.cdp.evaluate(`document.activeElement?.matches(${JSON.stringify(copySelector)})`), true);
      const before = await copyCenter(tab);
      assert(before.visible && before.ready && before.hit);
      await tab.key("Enter");
      const copied = await waitFor(() => tab.cdp.evaluate(`window.__heroCopies.length>${before.copyCount}?window.__heroCopies.at(-1):null`));
      assert.equal(copied.text, scene.prompt);
      assert.equal(copied.id, scene.id);
      const events = await tab.cdp.evaluate(`window.__nativeInputTrace.filter(event=>event.at>=${before.at})`);
      assert.deepEqual(events.map((event) => event.type), ["click"]);
      assert(events[0].trusted && events[0].heroCopy && events[0].detail === 0);
      await tab.key("Tab", CDP_MODIFIERS.Shift);
      assert.equal(await tab.cdp.evaluate("document.activeElement?.matches('[role=tab][aria-selected=true]')"), true);
      const returnFocus = await tab.cdp.evaluate("document.activeElement.textContent");
      assert.equal(returnFocus, scene.label);
      samples.push({ scene: scene.id, before, copied, events, returnFocus });
    }
    return { calibration, traversalCalibration, samples, nativeKeyboardCopies: samples.length, programmaticFocus: false };
  });

  await check("H11-phone-tablet-prompt-layout-breakpoint", async () => {
    const samples = [];
    for (const width of [639, 640]) {
      const tab = await page();
      await tab.viewport(width, 1000, true);
      await tab.navigate("/");
      const state = await waitScene(tab, "film");
      assertScene(state, HERO_SCENE_CONTRACT[0], heroAssets);
      samples.push(state);
    }
    return { samples, preservedDesktopOverlayAt: 640, fullArtworkBeforePromptThrough: 639 };
  });
}

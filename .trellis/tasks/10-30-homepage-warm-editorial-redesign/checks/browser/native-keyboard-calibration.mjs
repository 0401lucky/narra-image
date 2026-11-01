import assert from "node:assert/strict";

import { CDP_MODIFIERS } from "./cdp.mjs";

export async function calibrateNativeEnter(tab) {
  // Calibrate browser input on a separate blank fixture, never product controls.
  await tab.cdp.evaluate(`void (()=>{
    const button=document.createElement('button');button.type='button';button.textContent='Native Enter calibration';button.id='native-enter-calibration';
    document.body.replaceChildren(button);window.__nativeEnterCalibration={clicks:0,events:[]};
    button.addEventListener('click',()=>{window.__nativeEnterCalibration.clicks++});
    for(const type of ['keydown','keypress','keyup','click'])document.addEventListener(type,event=>{window.__nativeEnterCalibration.events.push({type,key:event.key,code:event.code,trusted:event.isTrusted,target:event.target.id})},true);
  })()`);
  await tab.key("Tab");
  assert.equal(await tab.cdp.evaluate("document.activeElement.id"), "native-enter-calibration");
  for (const type of ["keyDown", "keyUp"]) {
    await tab.cdp.send("Input.dispatchKeyEvent", { type, key: "Enter", modifiers: 0, windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  }
  const incompleteKey = await tab.cdp.evaluate("window.__nativeEnterCalibration");
  await tab.key("Enter");
  const completeKey = await tab.cdp.evaluate("window.__nativeEnterCalibration");
  assert.equal(completeKey.clicks, incompleteKey.clicks + 1, "Complete native Enter must activate a plain enabled button exactly once");
  const acceptedEvents = completeKey.events.slice(incompleteKey.events.length);
  assert(acceptedEvents.some((event) => event.type === "keypress" && event.trusted));
  assert(acceptedEvents.some((event) => event.type === "click" && event.trusted && event.target === "native-enter-calibration"));
  await tab.cdp.evaluate("void (document.getElementById('native-enter-calibration').disabled=true)");
  await tab.key("Tab");
  await tab.key("Enter");
  const disabledKey = await tab.cdp.evaluate("window.__nativeEnterCalibration");
  assert.equal(disabledKey.clicks, completeKey.clicks, "Native keyboard input cannot activate a disabled button");
  assert.notEqual(await tab.cdp.evaluate("document.activeElement.id"), "native-enter-calibration");
  return { incompleteKey, completeKey, disabledKey, programmaticClickOrFocus: false };
}

export async function calibrateNativeTabTraversal(tab) {
  await tab.navigate("about:blank");
  await tab.cdp.evaluate(`void (()=>{
    const buttons=['first','middle','disabled','last'].map(name=>{
      const button=document.createElement('button');button.type='button';
      button.id='native-tab-'+name;button.textContent=name;button.disabled=name==='disabled';return button;
    });
    document.body.replaceChildren(...buttons);window.__nativeTabCalibration={clicks:0,events:[]};
    for(const type of ['keydown','keyup','focusin','click'])document.addEventListener(type,event=>{
      if(type==='click')window.__nativeTabCalibration.clicks++;
      window.__nativeTabCalibration.events.push({type,key:event.key,code:event.code,trusted:event.isTrusted,target:event.target.id,shift:event.shiftKey,alt:event.altKey,control:event.ctrlKey,meta:event.metaKey});
    },true);
  })()`);
  const samples = [];
  async function traverse(label, from, to, modifiers = 0) {
    const before = await tab.cdp.evaluate("({active:document.activeElement.id,eventCount:window.__nativeTabCalibration.events.length})");
    assert.equal(before.active, from);
    await tab.key("Tab", modifiers);
    const after = await tab.cdp.evaluate(`({active:document.activeElement.id,clicks:window.__nativeTabCalibration.clicks,events:window.__nativeTabCalibration.events.slice(${before.eventCount})})`);
    if (to !== null) assert.equal(after.active, to, label);
    assert.equal(after.clicks, 0, "Tab traversal must not activate an ordinary button");
    assert.notEqual(after.active, "native-tab-disabled", "Disabled controls must be skipped in both directions");
    const keys = after.events.filter((event) => event.type === "keydown" || event.type === "keyup");
    assert.deepEqual(keys.map((event) => event.type), ["keydown", "keyup"]);
    for (const event of keys) {
      assert(event.trusted && event.key === "Tab" && event.code === "Tab");
      assert.equal(event.shift, Boolean(modifiers & CDP_MODIFIERS.Shift));
      assert.equal(event.alt, Boolean(modifiers & CDP_MODIFIERS.Alt));
      assert.equal(event.control, false);
      assert.equal(event.meta, false);
    }
    assert(!after.events.some((event) => event.type === "focusin" && event.target === "native-tab-disabled"));
    samples.push({ label, modifiers, before: before.active, ...after });
    return after;
  }
  await traverse("forward-first", "", "native-tab-first");
  await traverse("forward-middle", "native-tab-first", "native-tab-middle");
  await traverse("forward-skips-disabled", "native-tab-middle", "native-tab-last");
  await traverse("reverse-skips-disabled", "native-tab-last", "native-tab-middle", CDP_MODIFIERS.Shift);
  await traverse("reverse-first", "native-tab-middle", "native-tab-first", CDP_MODIFIERS.Shift);
  await traverse("forward-after-reverse", "native-tab-first", "native-tab-middle");
  const wrongModifier = await traverse("alt-is-not-reverse", "native-tab-middle", null, CDP_MODIFIERS.Alt);
  assert.notEqual(wrongModifier.active, "native-tab-first", "Alt+Tab must not be credited as Shift+Tab reverse traversal");
  return { samples, modifiers: CDP_MODIFIERS, disabledControlSkipped: true, programmaticClickOrFocus: false };
}

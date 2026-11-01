import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const checks = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await fs.readFile(path.join(checks, 'mobile-browser-tooling.json'), 'utf8'));
const { openBrowser, sleep } = await import(pathToFileURL(path.join(config.root, 'support/studio-browser-cdp.mjs')));
const label = process.argv[2];
assert.match(label ?? '', /^[a-z0-9-]+$/);
const output = path.join(config.root, 'native-pinch-probe-' + label);
await fs.mkdir(output, { recursive: false });
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    html,body{margin:0;width:100%;height:100%;font-size:16px}body{overflow:hidden}textarea{display:block;width:280px;height:220px;font-size:16px}
    #control{margin:40px 20px;padding:20px;width:300px;height:400px;overflow:auto;background:#fff4dc;touch-action:auto}
    </style></head><body><div aria-label="\u521b\u4f5c\u6a21\u5f0f">Native pinch calibration only</div><div id="control"><textarea id="field">Plain non-React control</textarea></div>
    <script>window.__CANVAS_FIXTURE={ready:true};window.__events=[];for(const name of ['touchstart','touchmove','touchend','pointercancel'])document.addEventListener(name,e=>window.__events.push({name,cancelled:e.defaultPrevented,touches:e.touches?.length}),{passive:true});</script></body></html>`);
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
let browser;
const report = { label, scope: 'Plain non-React Chromium CDP calibration, not product/device acceptance', cases: [] };
try {
  browser = await openBrowser(output, 'http://127.0.0.1:' + server.address().port, 'plain');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await browser.navigate();
  report.engine = browser.evidence.chrome;
  report.context = await browser.evaluate('({userAgent:navigator.userAgent,viewport:document.querySelector("meta[name=viewport]").content,touchPoints:navigator.maxTouchPoints})');
  for (const action of ['auto', 'pan-y pinch-zoom', 'none']) {
    for (const method of ['synthesize', 'dispatch']) {
      await browser.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
      await browser.evaluate(`void(document.querySelector('#control').style.touchAction=${JSON.stringify(action)})`);
      await browser.evaluate(`void(document.querySelector('#field').style.touchAction=${JSON.stringify(action)})`);
      await browser.evaluate('void(window.__events=[])');
      const before = await browser.send('Page.getLayoutMetrics');
      const point = await browser.point('#field');
      if (method === 'synthesize') {
        await browser.send('Input.synthesizePinchGesture', { x: point.x, y: point.y, scaleFactor: 1.5, relativeSpeed: 400, gestureSourceType: 'touch' });
      } else {
        const points = (spread) => [-1, 1].map((direction, index) => ({ id: index + 1, x: point.x + direction * spread, y: point.y, radiusX: 2, radiusY: 2, force: 1 }));
        await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(35) });
        for (let index = 1; index <= 16; index += 1) {
          await browser.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(35 + index * 3) });
          await sleep(30);
        }
        await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await sleep(500);
      report.cases.push({ action, method, before, after: await browser.send('Page.getLayoutMetrics'),
        actual: await browser.evaluate('({scale:visualViewport.scale,fieldTouchAction:getComputedStyle(document.querySelector("#field")).touchAction,events:window.__events})') });
      await browser.shot(action.replaceAll(' ', '-') + '-' + method);
    }
  }
  report.browser = browser.evidence;
} finally {
  await browser?.close();
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  await fs.writeFile(path.join(checks, 'native-pinch-probe-' + label + '.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ engine: report.engine, cases: report.cases.map((item) => ({ action: item.action, method: item.method, scale: item.actual.scale })) }, null, 2));

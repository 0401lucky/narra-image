import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const date = '2026-11-02T00:00:00.000Z';
const clone = (value) => structuredClone(value);
const digest = (value) => createHash('sha256').update(value).digest('hex');
export const defaults = { providerMode: 'built_in', channelId: 'channel-account', model: 'image-account-default', size: 'auto', quality: 'auto', outputFormat: 'png', outputCompression: null, moderation: 'auto', count: 1, negativePrompt: null, seed: null };
export const emptyScene = () => ({ schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, runBindings: [] });
export const metadata = (id, title) => ({ id, title, revision: 0, hasSavedSnapshot: false, lastSavedAt: null, createdAt: date, updatedAt: date });
export function deferred() { let resolve; const promise = new Promise((accept) => { resolve = accept; }); return { promise, resolve }; }

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function fixturePng(alternate = false) {
  const width = 160, height = 120;
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    rows[offset] = alternate ? 65 + x : 230;
    rows[offset + 1] = alternate ? 95 + y : 100 + y;
    rows[offset + 2] = alternate ? 125 : 60 + Math.floor(x / 2);
  }
  const chunk = (name, data) => { const payload = Buffer.concat([Buffer.from(name), data]); const size = Buffer.alloc(4); size.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(payload)); return Buffer.concat([size, payload, crc]); };
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

export function createStudioApi() {
  const accounts = new Map();
  const requests = [];
  const pendingGates = [];
  const png = fixturePng();
  const controls = { nextSave: null, nextGenerate: null, nextUpload: null };
  function account(owner = 'fixture-owner-a') {
    if (!accounts.has(owner)) accounts.set(owner, { documents: new Map(), deleted: new Set(), assets: new Map(), bytes: new Map(), runs: new Map(), jobs: new Map(), conversations: new Map(), receipts: new Map() });
    return accounts.get(owner);
  }
  const data = (value, status = 200) => ({ status, type: 'application/json', body: Buffer.from(JSON.stringify({ data: clone(value) })) });
  const failure = (code, status = 409) => ({ status, type: 'application/json', body: Buffer.from(JSON.stringify({ code })) });
  function makeJob(id, prompt, parameters = defaults, conversationId = null, references = []) {
    return { id, count: references.length ? 1 : parameters.count, createdAt: date, updatedAt: date, startedAt: date, completedAt: date, status: 'succeeded', generationType: references.length ? 'image_to_image' : 'text_to_image',
      providerMode: parameters.providerMode, providerChannelId: parameters.channelId, model: parameters.model, prompt, size: parameters.size, quality: parameters.quality, outputFormat: parameters.outputFormat, outputCompression: parameters.outputCompression,
      moderation: parameters.moderation, negativePrompt: parameters.negativePrompt, creditsSpent: 1, images: Array.from({ length: references.length ? 1 : parameters.count }, () => { const imageId = randomUUID(); return { id: imageId, url: '/fixture-media/' + imageId + '.png', actualWidth: 160, actualHeight: 120, actualSize: '160x120' }; }), videos: [], aspectRatio: null, durationSeconds: null, durationMs: null, conversationId,
      sourceImageUrl: null, sourceImageUrls: [], cancelRequestedAt: null, contractVersion: 1, errorCode: null, errorMessage: null, featuredAt: null, handoffState: null };
  }
  function seed(owner, title, scene) {
    const id = randomUUID(); const a = account(owner);
    a.documents.set(id, { canvas: { ...metadata(id, title), revision: 1, hasSavedSnapshot: true, lastSavedAt: date }, scene: clone(scene) });
    return id;
  }
  async function handle(request) {
    const url = new URL(request.url, 'http://fixture.local');
    const owner = decodeURIComponent(request.headers.cookie?.match(/(?:^|;\s*)fixture-owner=([^;]+)/)?.[1] ?? 'fixture-owner-a');
    const a = account(owner);
    const method = request.method ?? 'GET';
    const chunks = []; let length = 0;
    for await (const chunk of request) { length += chunk.length; assert.ok(length < 9 * 1024 * 1024, 'Bounded fixture request'); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks);
    const body = bytes.length && request.headers['content-type']?.includes('application/json') ? JSON.parse(bytes) : null;
    const record = { owner, method, path: url.pathname, body: clone(body), headers: { 'x-narra-canvas-run': request.headers['x-narra-canvas-run'] ?? null } };
    if (url.pathname.startsWith('/api/')) requests.push(record);
    if (url.pathname.startsWith('/fixture-media/')) {
      const assetId = url.pathname.slice('/fixture-media/'.length).replace(/\.png$/, '');
      return { status: 200, type: 'image/png', body: a.bytes.get(assetId) ?? png };
    }
    if (url.pathname === '/api/proxy-image') { const target = new URL(url.searchParams.get('url') ?? '', 'http://fixture.local'); const assetId = target.pathname.slice('/fixture-media/'.length).replace(/\.png$/, ''); return { status: 200, type: 'image/png', body: a.bytes.get(assetId) ?? png }; }
    if (url.pathname === '/api/me/canvases') {
      if (method === 'GET') return data({ canvases: [...a.documents.values()].filter((doc) => !a.deleted.has(doc.canvas.id)).map((doc) => doc.canvas), nextCursor: null });
      if (method === 'POST') {
        if (a.deleted.has(body.id)) return failure('CANVAS_DELETED', 410);
        if (!a.documents.has(body.id)) a.documents.set(body.id, { canvas: metadata(body.id, body.title), scene: null });
        return data({ canvas: a.documents.get(body.id).canvas });
      }
    }
    if (url.pathname.startsWith('/api/me/canvases/')) {
      const id = url.pathname.split('/')[4];
      if (a.deleted.has(id)) return failure('CANVAS_DELETED', 410);
      const doc = a.documents.get(id);
      if (!doc) return failure('CANVAS_NOT_FOUND', 404);
      if (method === 'GET') return data(doc);
      if (method === 'PUT') {
        assert.ok(url.pathname.endsWith('/snapshot'));
        if (controls.nextSave === 'fail') { controls.nextSave = null; return failure('CANVAS_INPUT_UNAVAILABLE', 409); }
        const receipt = a.receipts.get(id);
        if (receipt?.saveId === body.saveId) {
          if (receipt.scene !== JSON.stringify(body.scene) || receipt.expectedRevision !== body.expectedRevision) return failure('CANVAS_SAVE_CONFLICT');
          return data(receipt.data);
        }
        if (doc.canvas.revision !== body.expectedRevision) return failure('CANVAS_REVISION_CONFLICT');
        for (const node of body.scene.nodes) if (node.kind === 'reference') {
          assert.equal(node.source.kind, 'imported');
          if (!a.assets.has(node.source.assetId)) return failure('CANVAS_INPUT_UNAVAILABLE');
        }
        doc.scene = clone(body.scene);
        doc.canvas = { ...doc.canvas, revision: body.expectedRevision + 1, lastSavedAt: date, hasSavedSnapshot: true };
        const receiptData = { canvas: clone(doc.canvas), saveId: body.saveId, acknowledgedRevision: doc.canvas.revision, sceneHash: digest(JSON.stringify(body.scene)) };
        a.receipts.set(id, { saveId: body.saveId, expectedRevision: body.expectedRevision, scene: JSON.stringify(body.scene), data: receiptData });
        if (controls.nextSave === 'delay') {
          controls.nextSave = null; const gate = deferred(); pendingGates.push({ kind: 'save', id, ...gate }); await gate.promise;
        }
        return data(receiptData);
      }
      if (doc.canvas.revision !== body.expectedRevision) return failure('CANVAS_REVISION_CONFLICT');
      if (method === 'PATCH') { doc.canvas = { ...doc.canvas, title: body.title, revision: body.expectedRevision + 1 }; return data({ canvas: doc.canvas }); }
      if (method === 'DELETE') { a.deleted.add(id); return data({ id, deleted: true, revision: body.expectedRevision + 1 }); }
    }
    if (url.pathname === '/api/me/canvas-assets' && method === 'POST') {
      const form = await new Request('http://fixture.local/upload', { method: 'POST', headers: { 'content-type': request.headers['content-type'] }, body: bytes }).formData();
      const file = form.get('file'); const original = Buffer.from(await file.arrayBuffer());
      const uploadId = form.get('uploadId'); const id = 'asset-' + uploadId;
      assert.equal(Number(form.get('byteLength')), original.length); assert.equal(form.get('sha256'), digest(original));
      record.body = { uploadId, byteLength: original.length, sha256: digest(original), fileName: file.name };
      if (controls.nextUpload === 'fail') { controls.nextUpload = null; return failure('CANVAS_INPUT_UNAVAILABLE'); }
      const asset = { id, uploadId, state: 'READY', byteLength: original.length, mimeType: form.get('mimeType'), sha256: digest(original), readyAt: date, url: '/fixture-media/' + id + '.png' };
      a.assets.set(id, asset); a.bytes.set(id, original); return data({ asset });
    }
    if (url.pathname.startsWith('/api/me/canvas-assets/')) {
      const value = url.pathname.split('/').at(-1);
      const asset = url.pathname.includes('/uploads/') ? [...a.assets.values()].find((entry) => entry.uploadId === value) : a.assets.get(value);
      return asset ? data({ asset }) : failure('CANVAS_INPUT_UNAVAILABLE', 404);
    }
    if (url.pathname === '/api/me/canvas-runtime/resolve') {
      if (a.deleted.has(body.canvasId)) return failure('CANVAS_DELETED', 410);
      const output = { canvasId: body.canvasId, assets: {}, images: {}, generations: {}, runs: {}, missing: [] };
      for (const id of body.assetIds) {
        if (a.assets.has(id)) output.assets[id] = a.assets.get(id); else output.missing.push({ kind: 'asset', id, code: 'CANVAS_INPUT_UNAVAILABLE' });
      }
      for (const id of [...body.runIds, ...body.runBindings.map((binding) => binding.runId)]) {
        const run = a.runs.get(id);
        if (run) { output.runs[id] = run; output.generations[run.jobId] = run.generation; }
        else output.missing.push({ kind: 'run', id, code: 'CANVAS_RUN_NOT_FOUND' });
      }
      for (const [id, job] of a.jobs) {
        if (body.jobIds.includes(id)) output.generations[id] = job;
        for (const image of job.images) if (body.imageIds.includes(image.id)) output.images[image.id] = { ...image, jobId: id };
      }
      return data(output);
    }
    if (url.pathname.startsWith('/api/me/canvas-runs/')) {
      const run = a.runs.get(url.pathname.split('/').at(-1));
      return run ? data(run) : failure('CANVAS_RUN_NOT_FOUND', 404);
    }
    if (url.pathname === '/api/generate') {
      const wire = body?.canvasRun;
      if (!wire) {
        const job = makeJob('chat-' + randomUUID(), body.prompt, { ...defaults, ...body }, body.conversationId);
        a.jobs.set(job.id, job); return data({ generation: job });
      }
      assert.equal(request.headers['x-narra-canvas-run'], '1');
      assert.ok(!('conversationId' in body));
      assert.ok(wire.input.prompt.text.length >= 2);
      assert.ok(wire.input.references.length <= 16);
      const prior = a.runs.get(wire.runId);
      if (prior) return data({ generation: prior.generation, canvasRun: { ...prior.origin, jobId: prior.jobId } });
      const origin = { canvasId: wire.canvasId, nodeId: wire.nodeId, runId: wire.runId };
      const job = makeJob('canvas-' + wire.runId, wire.input.prompt.text, wire.parameters, null, wire.input.references);
      a.jobs.set(job.id, job); a.runs.set(wire.runId, { state: 'COMMITTED', origin, jobId: job.id, generation: job, unavailable: null });
      if (controls.nextGenerate === 'delay') {
        controls.nextGenerate = null; const gate = deferred(); pendingGates.push({ kind: 'generate', id: wire.runId, ...gate }); await gate.promise;
      }
      if (controls.nextGenerate === 'lose') {
        controls.nextGenerate = null;
        // A truncated acknowledgement body is ambiguous without triggering
        // Chrome's automatic retry of a connection closed before any headers.
        return { status: 200, type: 'application/json', body: Buffer.from('{"data":') };
      }
      return data({ generation: job, canvasRun: { ...origin, jobId: job.id } });
    }
    if (url.pathname.startsWith('/api/me/generations/')) {
      assert.equal(method, 'GET', 'Fixture must never receive cancellation/deletion');
      const job = a.jobs.get(url.pathname.split('/').at(-1));
      return job ? data({ generation: job }) : failure('CANVAS_JOB_UNAVAILABLE', 404);
    }
    if (url.pathname === '/api/me/conversations' && method === 'POST') {
      const conversation = { id: 'chat-' + randomUUID(), title: body.title, generationIds: [], createdAt: date, updatedAt: date };
      a.conversations.set(conversation.id, conversation); return data({ conversation });
    }
    if (url.pathname.startsWith('/api/me/conversations/')) {
      const id = url.pathname.split('/')[4];
      if (method === 'GET') return data({ conversationId: id, generations: [...a.jobs.values()].filter((job) => job.conversationId === id), nextCursor: null });
      if (method === 'PATCH') return data({});
    }
    throw new Error('Unhandled isolated fixture request ' + method + ' ' + url.pathname);
  }
  return { handle, account, accounts, controls, requests, pendingGates, seed, makeJob, releaseAll() { for (const gate of pendingGates) gate.resolve(); } };
}

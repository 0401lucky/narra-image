import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const checks = path.dirname(fileURLToPath(import.meta.url));
const [label, phase] = process.argv.slice(2);
assert.match(label ?? '', /^[a-z0-9-]+$/);
assert.match(phase ?? '', /^[a-z0-9-]+$/);
const evidence = JSON.parse(await fs.readFile(path.join(checks, 'mobile-fixture-source-' + label + '.json'), 'utf8'));
const changed = [];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const identity of evidence.identities) {
  for (const [kind, base] of [['production', evidence.repo], ['copied', evidence.fixture]]) {
    try {
      const bytes = await fs.readFile(path.join(base, identity.path));
      if (digest(bytes) !== identity.sha256) changed.push({ path: identity.path, kind, reason: 'changed bytes' });
    } catch (error) { changed.push({ path: identity.path, kind, reason: error.code }); }
  }
}
for (const identity of evidence.fixtureInputs) {
  const bytes = await fs.readFile(path.join(evidence.fixture, identity.path));
  if (digest(bytes) !== identity.sha256) changed.push({ path: identity.path, kind: 'fixture input', reason: 'changed bytes' });
}
for (const [filename, identity] of Object.entries(evidence.helperIdentities)) {
  const bytes = await fs.readFile(path.join(evidence.root, 'support', filename));
  if (digest(bytes) !== identity.copySha256) changed.push({ path: filename, kind: 'fixture helper', reason: 'changed bytes' });
}
const packages = JSON.parse(await fs.readFile(path.join(evidence.root, 'dependencies.json'), 'utf8')).packages;
const packageLinks = [];
for (const name of ['next', 'react', 'react-dom', '@xyflow/react', 'typescript']) {
  const entry = packages.find((item) => item.name === name);
  assert.ok(entry, 'Required copied installed package: ' + name);
  const actual = await fs.realpath(path.join(evidence.fixture, 'node_modules', name));
  const expected = await fs.realpath(entry.destination);
  const equal = actual.toLowerCase() === expected.toLowerCase();
  packageLinks.push({ name, version: entry.version, actual, expected, equal });
  if (!equal) changed.push({ path: name, kind: 'package link', reason: 'Not the copied installed package' });
}
async function inventory(base, relative) {
  const result = [];
  for (const entry of await fs.readdir(path.join(base, relative), { withFileTypes: true })) {
    const filename = relative + '/' + entry.name;
    if (entry.isDirectory()) result.push(...await inventory(base, filename));
    else { assert.ok(entry.isFile(), 'No symlink source inputs'); result.push(filename); }
  }
  return result.sort();
}
const inventories = {};
for (const directory of ['src/components', 'src/lib', 'contracts']) {
  const production = await inventory(evidence.repo, directory);
  const copied = await inventory(evidence.fixture, directory);
  const recorded = evidence.identities.filter((item) => item.path.startsWith(directory + '/')).map((item) => item.path).sort();
  const equal = JSON.stringify(production) === JSON.stringify(copied) && JSON.stringify(production) === JSON.stringify(recorded);
  inventories[directory] = { productionCount: production.length, copiedCount: copied.length, recordedCount: recorded.length, equal };
  if (!equal) changed.push({ path: directory, reason: 'inventory changed' });
}
const report = { checkedAt: new Date().toISOString(), label, phase, exactSourceIdentityCount: evidence.identities.length, changed, inventories, packageLinks, pass: changed.length === 0, scope: 'Source provenance only; not browser/device/service acceptance' };
const output = path.join(checks, 'mobile-fixture-audit-' + label + '-' + phase + '.json');
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;

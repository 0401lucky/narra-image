import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const checks = path.dirname(fileURLToPath(import.meta.url));
const repo = 'E:/code/narra-image';
const predecessor = 'C:/Users/Administrator/AppData/Local/Temp/narra-canvas-v1-e9e6cb3e34884a1cbeada1b036cfffea';
const configPath = path.join(checks, 'mobile-browser-tooling.json');
const { installedPackagePath } = await import(pathToFileURL(path.join(predecessor, 'react-flow-spike/installed-package.mjs')));
let config;
try { config = JSON.parse(await fs.readFile(configPath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const owner = randomUUID();
  const root = path.join(os.tmpdir(), 'narra-mobile-canvas-20261030-' + owner);
  await fs.mkdir(root, { recursive: false });
  await fs.writeFile(path.join(root, 'mobile-fixture-owner.json'), JSON.stringify({ owner, task: '.trellis/tasks/10-28-studio-mobile-canvas-editor' }));
  config = { owner, root, predecessor, repo, createdAt: new Date().toISOString(), fixtures: [] };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
}
const root = path.resolve(config.root);
assert.ok(root.toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase() + path.sep));
assert.match(path.basename(root), /^narra-mobile-canvas-20261030-[a-f0-9-]+$/);
assert.equal(JSON.parse(await fs.readFile(path.join(root, 'mobile-fixture-owner.json'), 'utf8')).owner, config.owner);
function owned(target) {
  assert.ok(path.resolve(target).toLowerCase().startsWith(root.toLowerCase() + path.sep));
  return target;
}
const modules = owned(path.join(root, 'node_modules'));
const packageStore = owned(path.join(root, '.installed-packages'));
const copied = new Map();
const unavailableOptional = [];
const requireRepo = createRequire(path.join(repo, 'package.json'));
const packageManager = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8')).packageManager;
assert.match(packageManager ?? '', /^pnpm@/);
async function link(target, destination) {
  owned(target); owned(destination);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try { assert.equal((await fs.realpath(destination)).toLowerCase(), (await fs.realpath(target)).toLowerCase()); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await fs.symlink(target, destination, 'junction'); }
}
async function copyPackage(name, scope, optional = false) {
  let metadataPath;
  try { metadataPath = await fs.realpath(installedPackagePath(name, scope)); }
  catch (error) { if (optional) { unavailableOptional.push(name); return null; } throw error; }
  if (copied.has(metadataPath)) return copied.get(metadataPath).destination;
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  const identity = name.replaceAll('/', '+') + '@' + metadata.version + '-' + createHash('sha256').update(metadataPath).digest('hex').slice(0, 8);
  const destination = owned(path.join(packageStore, identity, 'node_modules', name));
  copied.set(metadataPath, { name, version: metadata.version, source: path.dirname(metadataPath), destination });
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(path.dirname(metadataPath), destination, {
    recursive: true, dereference: true, force: true,
    filter: (source) => source === path.dirname(metadataPath) || !['node_modules', '.env'].includes(path.basename(source)),
  });
  const requirePackage = createRequire(metadataPath);
  for (const dependency of Object.keys(metadata.dependencies ?? {})) await link(await copyPackage(dependency, requirePackage), path.join(destination, 'node_modules', dependency));
  for (const dependency of Object.keys(metadata.optionalDependencies ?? {})) {
    const target = await copyPackage(dependency, requirePackage, true);
    if (target) await link(target, path.join(destination, 'node_modules', dependency));
  }
  for (const dependency of Object.keys(metadata.peerDependencies ?? {})) {
    if (metadata.peerDependenciesMeta?.[dependency]?.optional) continue;
    const target = await copyPackage(dependency, requirePackage, true);
    if (target) await link(target, path.join(destination, 'node_modules', dependency));
  }
  return destination;
}
await fs.mkdir(modules, { recursive: true });
try { await fs.access(path.join(root, 'dependencies.json')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  for (const name of ['next', 'react', 'react-dom', '@xyflow/react', 'lucide-react', 'motion', 'class-variance-authority', 'clsx', 'tailwind-merge', 'date-fns', 'zod', '@prisma/client', '@types/node', '@types/react', '@types/react-dom', 'typescript', '@tailwindcss/postcss', 'tailwindcss']) await link(await copyPackage(name, requireRepo), path.join(modules, name));
  const prismaMetadata = installedPackagePath('@prisma/client', requireRepo);
  const generatedMetadata = createRequire(prismaMetadata).resolve('.prisma/client/package.json');
  const generated = owned(path.join(modules, '.prisma/client'));
  await fs.cp(path.dirname(generatedMetadata), generated, { recursive: true, dereference: true, force: true });
  await link(generated, path.join(await fs.realpath(path.join(modules, '@prisma/client')), 'node_modules/.prisma/client'));
  await fs.writeFile(path.join(root, 'dependencies.json'), JSON.stringify({ copiedInstalledPackagesOnly: true, packages: [...copied.values()], unavailableOptional: [...new Set(unavailableOptional)] }, null, 2));
}
await fs.mkdir(owned(path.join(root, 'support')), { recursive: true });
const helperIdentities = {};
for (const filename of ['studio-browser-api.mjs', 'studio-browser-cdp.mjs']) {
  const original = await fs.readFile(path.join(predecessor, filename), 'utf8');
  let source = original.replaceAll("'./react-flow-spike/safe-environment.mjs'", JSON.stringify(pathToFileURL(path.join(predecessor, 'react-flow-spike/safe-environment.mjs')).href));
  if (filename === 'studio-browser-api.mjs') source = source.replace(
    "if (url.pathname === '/api/proxy-image') return { status: 200, type: 'image/png', body: png };",
    "if (url.pathname === '/api/proxy-image') { const target = new URL(url.searchParams.get('url') ?? '', 'http://fixture.local'); const assetId = target.pathname.slice('/fixture-media/'.length).replace(/\\.png$/, ''); return { status: 200, type: 'image/png', body: a.bytes.get(assetId) ?? png }; }",
  );
  await fs.writeFile(path.join(root, 'support', filename), source);
  helperIdentities[filename] = { originalSha256: createHash('sha256').update(original).digest('hex'), copySha256: createHash('sha256').update(source).digest('hex'), change: filename === 'studio-browser-api.mjs' ? 'Fake proxy preserves the requested fixture original bytes' : 'Absolute import of audited isolated environment helper' };
}
if (process.argv.includes('--dependencies-only')) {
  console.log(JSON.stringify({ root, copiedInstalledPackagesOnly: true, dependencyCount: copied.size, helperIdentities }, null, 2));
  process.exit(0);
}
const label = process.argv[2] ?? '01';
assert.match(label, /^[a-z0-9-]+$/);
const fixture = owned(path.join(root, 'fixture-' + label));
await fs.mkdir(fixture, { recursive: false });
await link(modules, path.join(fixture, 'node_modules'));
for (const directory of ['src/components', 'src/lib', 'contracts']) await fs.cp(path.join(repo, directory), owned(path.join(fixture, directory)), { recursive: true, dereference: true, force: false, errorOnExist: true });
await fs.mkdir(path.join(fixture, 'src/app/create'), { recursive: true });
for (const filename of ['src/app/globals.css', 'postcss.config.mjs']) await fs.copyFile(path.join(repo, filename), path.join(fixture, filename));
await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'narra-mobile-real-studio-fixture', private: true, version: '0.0.0', packageManager, scripts: { build: 'next build' }, dependencies: { next: '16.2.4', react: '19.2.4', 'react-dom': '19.2.4' } }, null, 2));
await fs.writeFile(path.join(fixture, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['dom', 'dom.iterable', 'esnext'], allowJs: true, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true, isolatedModules: true, jsx: 'react-jsx', incremental: true, plugins: [{ name: 'next' }], paths: { '@/*': ['./src/*'] } }, include: ['next-env.d.ts', 'src/app/**/*.tsx', '.next/types/**/*.ts'], exclude: ['node_modules', '.installed-packages'] }, null, 2));
await fs.writeFile(path.join(fixture, 'next.config.mjs'), 'export default { devIndicators: false, turbopack: { root: ' + JSON.stringify(root) + ' } };\n');
await fs.writeFile(path.join(fixture, 'src/app/layout.tsx'), `import './globals.css';
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" className="h-full antialiased"><body className="min-h-full bg-[var(--surface)] text-[var(--ink)]">{children}</body></html>;
}
`);
await fs.writeFile(path.join(fixture, 'src/app/create/page.tsx'), `import { FixtureStudio } from './studio';
export default function Page() { return <FixtureStudio />; }
`);
await fs.writeFile(path.join(fixture, 'src/app/create/studio.tsx'), `"use client";
import { useEffect, useState } from 'react';
import { GeneratorStudio } from '@/components/create/generator-studio';
import type { SavedProviderInfo } from '@/components/create/types';
declare global { interface Window { __CANVAS_FIXTURE?: { switchOwner(owner: string): void; setEnabled(enabled: boolean): void; setSavedProvider(provider: SavedProviderInfo | null): void; owner: string; ready: boolean }; } }
const channels = [{ id: 'channel-account', name: 'Fixture channel', defaultModel: 'image-account-default', models: ['image-account-default', 'image-account-second'], creditCost: 1 }];
export function FixtureStudio() {
  const [ownerId, setOwnerId] = useState('fixture-owner-a');
  const [enabled, setEnabled] = useState(true);
  const [savedProvider, setSavedProvider] = useState<SavedProviderInfo | null>(null);
  useEffect(() => {
    document.cookie = 'fixture-owner=' + ownerId + '; path=/; SameSite=Strict';
    window.__CANVAS_FIXTURE = { owner: ownerId, ready: true, setEnabled, setSavedProvider, switchOwner(owner) { document.cookie = 'fixture-owner=' + owner + '; path=/; SameSite=Strict'; setSavedProvider(null); setOwnerId(owner); } };
    return () => { delete window.__CANVAS_FIXTURE; };
  }, [ownerId]);
  return <main className="flex h-[100dvh] flex-col overflow-hidden bg-[var(--surface)]">
    <header className="flex h-14 shrink-0 items-center border-b border-[var(--line)] px-3 font-serif text-lg">Narra / isolated mobile fixture</header>
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden"><GeneratorStudio ownerId={ownerId} canvasEnabled={enabled} savedProvider={savedProvider} currentUser={{ credits: 500, role: 'user' }} checkInSummary={{ checkInReward: 50, checkedInToday: false }} channels={channels} initialPrompt="Chat seed only" /></section>
  </main>;
}
`);
const identities = [];
async function verifySourceTree(relative) {
  const entries = await fs.readdir(path.join(repo, relative), { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    const filename = relative + '/' + entry.name;
    if (entry.isDirectory()) { await verifySourceTree(filename); continue; }
    assert.ok(entry.isFile(), 'Production fixture source must be ordinary files');
    const original = await fs.readFile(path.join(repo, filename));
    assert.deepEqual(await fs.readFile(path.join(fixture, filename)), original);
    identities.push({ path: filename, bytes: original.length, sha256: createHash('sha256').update(original).digest('hex') });
  }
}
for (const directory of ['src/components', 'src/lib', 'contracts']) await verifySourceTree(directory);
for (const filename of ['src/app/globals.css', 'postcss.config.mjs']) {
  const source = await fs.readFile(path.join(repo, filename));
  assert.deepEqual(await fs.readFile(path.join(fixture, filename)), source);
  identities.push({ path: filename, bytes: source.length, sha256: createHash('sha256').update(source).digest('hex') });
}
const fixtureInputs = [];
for (const filename of ['src/app/layout.tsx', 'src/app/create/page.tsx', 'src/app/create/studio.tsx', 'next.config.mjs', 'package.json']) {
  const source = await fs.readFile(path.join(fixture, filename));
  fixtureInputs.push({ path: filename, sha256: createHash('sha256').update(source).digest('hex') });
}
const evidence = { recordedAt: new Date().toISOString(), repo, fixture, root, label, identities, fixtureInputs, helperIdentities, scope: 'Exact current production components/lib/contracts/CSS; actual Next/React Flow/native IndexedDB. Minimal fixture layout, serialized dummy identity/catalogue and loopback fake HTTP only. Not physical phones, native OS IME, real authentication/services/billing or actual CI.' };
await fs.writeFile(path.join(fixture, 'source-evidence.json'), JSON.stringify(evidence, null, 2));
await fs.writeFile(path.join(checks, 'mobile-fixture-source-' + label + '.json'), JSON.stringify(evidence, null, 2));
config.fixtures.push({ label, fixture, sourceIdentityCount: identities.length });
await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
console.log(JSON.stringify({ root, fixture, sourceIdentityCount: identities.length, copiedInstalledPackagesOnly: true }, null, 2));

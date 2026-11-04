import assert from "node:assert/strict";
import { mkdir, readFile, readdir, realpath, rm, writeFile, lstat } from "node:fs/promises";
import path from "node:path";

import { helperIdentity, ownedApp, repository, sha, within, writeJson } from "./identity.mjs";

const { app, ownerRoot } = await ownedApp();
const source = JSON.parse(await readFile(path.join(ownerRoot, "source-manifest.json"), "utf8"));
const manifestFile = path.join(app, "canvas-fixture-manifest.json");
await assert.rejects(readFile(manifestFile), { code: "ENOENT" }, "Prepare only a fresh owned snapshot");
const production = {};
for (const [file, item] of Object.entries(source.files)) {
  if (/^(src\/(components|lib)\/|contracts\/|public\/)/.test(file) || ["src/app/globals.css", "postcss.config.mjs", "package.json", "pnpm-lock.yaml"].includes(file)) {
    assert.equal(sha(await readFile(path.join(repository, file))), item.sha256, `Current source changed: ${file}`);
    assert.equal(sha(await readFile(path.join(app, file))), item.sha256, `Copied source changed: ${file}`);
    production[file] = item.sha256;
  }
}
const globals = await readFile(path.join(app, "src/app/globals.css"));
async function removeOwned(relative) {
  const target = path.resolve(app, relative);
  assert(within(target, app), "Removal must stay inside owned snapshot");
  let info;
  try { info = await lstat(target); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  assert(!info.isSymbolicLink() && await realpath(target) === target, "Refuse linked removal target");
  async function audit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const child = path.join(folder, entry.name);
      assert(within(await realpath(child), app) && !(await lstat(child)).isSymbolicLink(), "Refuse linked snapshot content");
      if (entry.isDirectory()) await audit(child);
    }
  }
  if (info.isDirectory()) await audit(target);
  assert(within(await realpath(target), app), "Final absolute removal target check");
  await rm(target, { recursive: info.isDirectory(), force: false });
}

// Only the copied route shell is replaced; production UI/lib/contracts stay exact.
await removeOwned("src/app");
await removeOwned("src/proxy.ts");
await removeOwned("next.config.ts");
await removeOwned("next.config.mjs");
const put = async (file, bytes) => { const target = path.join(app, file); assert(within(target, app)); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes); };
await put("src/app/globals.css", globals);
await put("src/app/layout.tsx", `import "./globals.css";
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" className="h-full antialiased"><body className="min-h-full bg-[var(--surface)] text-[var(--ink)]">{children}</body></html>;
}
`);
await put("src/app/create/page.tsx", `import { FixtureStudio } from "./studio";
export default function Page() { return <FixtureStudio />; }
`);
await put("src/app/create/studio.tsx", `"use client";
import { useEffect, useState } from "react";
import { GeneratorStudio } from "@/components/create/generator-studio";
declare global { interface Window { __CANVAS_FIXTURE?: { owner: string; ready: boolean; switchOwner(owner: string): void; setEnabled(enabled: boolean): void }; } }
const channels = [{ id: "channel-account", name: "Fixture channel", defaultModel: "image-account-default", models: ["image-account-default", "image-account-second"], creditCost: 1 }];
export function FixtureStudio() {
  const [ownerId, setOwnerId] = useState("fixture-owner-a");
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    document.cookie = "fixture-owner=" + ownerId + "; path=/; SameSite=Strict";
    window.__CANVAS_FIXTURE = { owner: ownerId, ready: true, setEnabled, switchOwner(owner) { document.cookie = "fixture-owner=" + owner + "; path=/; SameSite=Strict"; setOwnerId(owner); } };
    return () => { delete window.__CANVAS_FIXTURE; };
  }, [ownerId]);
  return <main className="flex h-[100dvh] flex-col overflow-hidden bg-[var(--surface)]"><header className="flex h-14 shrink-0 items-center border-b border-[var(--line)] px-3 font-serif text-lg">Narra / isolated canvas fixture</header><section className="relative flex min-h-0 flex-1 flex-col overflow-hidden"><GeneratorStudio ownerId={ownerId} canvasEnabled={enabled} currentUser={{ credits: 500, role: "user" }} checkInSummary={{ checkInReward: 50, checkedInToday: false }} channels={channels} initialPrompt="Chat draft stays independent" /></section></main>;
}
`);
await put("next.config.mjs", `export default { devIndicators: false, turbopack: { root: ${JSON.stringify(app)} } };\n`);
await put("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", lib: ["dom", "dom.iterable", "esnext"], allowJs: true, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: "react-jsx", incremental: true, plugins: [{ name: "next" }], paths: { "@/*": ["./src/*"] } }, include: ["next-env.d.ts", "src/app/**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"], exclude: ["node_modules"] }, null, 2));
const fixtureInputs = {};
for (const file of ["src/app/layout.tsx", "src/app/create/page.tsx", "src/app/create/studio.tsx", "next.config.mjs", "tsconfig.json"]) fixtureInputs[file] = sha(await readFile(path.join(app, file)));
const manifest = { at: new Date().toISOString(), repository, app, production, fixtureInputs, helperInputs: await helperIdentity(), boundaries: "Exact current production UI/lib/contracts/CSS/assets and installed copied dependencies; minimal SSR/lazy route shell, serialized dummy identity/catalogue, loopback fake API, native IndexedDB. No real auth/DB/provider/billing, physical phone/OS IME/chooser/download or remote CI proof." };
await writeJson(manifestFile, manifest);
await writeJson(path.join(ownerRoot, "fixture-preparation.json"), { app, productionCount: Object.keys(production).length, fixtureInputs, helperInputs: manifest.helperInputs, boundaries: manifest.boundaries });
console.log(JSON.stringify({ app, productionCount: Object.keys(production).length, fixtureInputs, boundaries: manifest.boundaries }));

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { assertReleaseContext, currentMainSha, finishRelease, GhcrRegistry, ImageReleaseError, prepareRelease, RELEASE_IMAGES, RELEASE_LICENSE, RELEASE_REPOSITORY, RELEASE_SOURCE } from "../lib/image-release.mjs";
import { main as publishImages } from "../publish-images.mjs";

const sha = "a".repeat(40), laterSha = "b".repeat(40);
const context = { repository: RELEASE_REPOSITORY, eventName: "push", ref: "refs/heads/main", sha,
  gates: Object.fromEntries(["verify-ci", "verify-migrations", "verify-e2e"].map((key) => [key, { result: "success" }])) };
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const bytes = (value) => Buffer.from(JSON.stringify(value));
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });

function fixtureImage(options = {}) {
  const config = bytes({ os: options.os ?? "linux", architecture: options.architecture ?? "amd64", config: { Labels: {
    "org.opencontainers.image.source": options.source ?? RELEASE_SOURCE,
    "org.opencontainers.image.revision": options.sha ?? sha,
    "org.opencontainers.image.licenses": options.license ?? RELEASE_LICENSE,
  } } });
  const manifest = bytes({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: digest(config), size: config.length }, layers: [] });
  return { config, manifest, digest: digest(manifest) };
}
function registryFixture(options = {}) {
  const values = new Map(Object.values(RELEASE_IMAGES).map((image) => [image, fixtureImage()]));
  const requests = [], writes = [], tokens = [];
  const privateImages = new Set(options.privateImages ?? []);
  const fetcher = async (input, init = {}) => {
    const url = new URL(input), headers = new Headers(init.headers);
    requests.push({ url, method: init.method ?? "GET", headers });
    assert.equal(init.redirect, "manual");
    assert(init.signal instanceof AbortSignal);
    if (url.pathname === "/token") {
      const authenticated = headers.has("Authorization");
      const scope = url.searchParams.get("scope"), name = scope.split(":")[1];
      tokens.push({ authenticated, scope });
      if (options.denied || (!authenticated && privateImages.has(`ghcr.io/${name}`))) return json({ errors: [{ code: "DENIED" }] }, 403);
      return json({ token: authenticated ? "authenticated-registry-token" : "anonymous-registry-token" });
    }
    const match = /^\/v2\/(0401lucky\/narra-image-(?:app|worker))\/(manifests|blobs)\/(.+)$/.exec(url.pathname);
    assert(match, url.pathname);
    const image = `ghcr.io/${match[1]}`, item = values.get(image);
    assert.match(headers.get("Authorization"), /^Bearer (authenticated|anonymous)-registry-token$/);
    if (init.method === "PUT") {
      assert.equal(match[3], "latest"); writes.push({ image, bytes: Buffer.from(init.body), digest: digest(init.body) });
      if (options.failSecondPut && writes.length === 2) return json({ message: "unavailable" }, 503);
      return new Response(null, { status: 201, headers: { "docker-content-digest": digest(init.body) } });
    }
    if (!item) return json({ errors: [{ code: options.missingCode ?? "MANIFEST_UNKNOWN" }] }, 404);
    const body = match[2] === "blobs" ? item.config : match[3].startsWith("sha-") ? (item.index ?? item.manifest) : item.manifest;
    return new Response(body, { headers: { "docker-content-digest": options.badDigest ? `sha256:${"c".repeat(64)}` : digest(body) } });
  };
  const registry = new GhcrRegistry({ actor: "maintainer", token: "test-job-token", fetcher });
  const anonymous = new GhcrRegistry({ fetcher });
  const expected = () => Object.fromEntries(Object.entries(RELEASE_IMAGES).map(([key, image]) => [key, digest(values.get(image)?.index ?? values.get(image)?.manifest ?? Buffer.alloc(0))]));
  return { registry, anonymous, expected, values, requests, writes, tokens, fetcher };
}

test("publication rejects PRs, forks, arbitrary refs/SHAs and every non-success gate", () => {
  assert.deepEqual(assertReleaseContext(context), { sha, tag: `sha-${sha}` });
  for (const patch of [{ eventName: "pull_request" }, { eventName: "pull_request_target" }, { repository: "attacker/narra-image" }, { ref: "refs/tags/v1" }, { sha: "main; command" }, { sha: "a".repeat(7) }]) {
    assert.throws(() => assertReleaseContext({ ...context, ...patch }), { code: "UNTRUSTED_RELEASE" });
  }
  for (const name of Object.keys(context.gates)) for (const result of ["failure", "cancelled", "skipped", "", undefined]) {
    assert.throws(() => assertReleaseContext({ ...context, gates: { ...context.gates, [name]: { result } } }), { code: "UNVERIFIED_RELEASE" });
  }
});

test("prepare reuses immutable source digests and builds only genuinely missing manifests", async () => {
  const fixture = registryFixture();
  const both = await prepareRelease(context, fixture.registry);
  assert.equal(both.images.app.build, false); assert.equal(both.images.worker.build, false);
  assert.equal(both.images.app.digest, fixture.expected().app);
  fixture.values.delete(RELEASE_IMAGES.worker);
  const partial = await prepareRelease(context, fixture.registry);
  assert.equal(partial.images.app.digest, both.images.app.digest);
  assert.equal(partial.images.worker.build, true); assert.equal(partial.images.worker.digest, "");
  assert.equal(fixture.writes.length, 0);
});

test("CLI bootstraps two absent package names and carries build or reused digests into the public summary", async (t) => {
  const fixture = registryFixture({ missingCode: "NAME_UNKNOWN" });
  fixture.values.clear();
  const prefix = path.join(tmpdir(), `narra-release-cli-${randomUUID()}`);
  const output = `${prefix}.output`, reusedOutput = `${prefix}.reused`, summary = `${prefix}.summary`;
  t.after(async () => { await Promise.all([output, reusedOutput, summary].map((file) => rm(file, { force: true }))); });
  const logs = [];
  t.mock.method(console, "log", (message) => logs.push(message));
  t.mock.method(globalThis, "fetch", async (url, init) => new URL(url).hostname === "api.github.com"
    ? json({ object: { sha } }) : fixture.fetcher(url, init));
  const environment = {
    GITHUB_REPOSITORY: context.repository, GITHUB_EVENT_NAME: context.eventName, GITHUB_REF: context.ref,
    GITHUB_SHA: sha, GITHUB_ACTOR: "maintainer", GITHUB_TOKEN: "test-job-token",
    RELEASE_GATE_RESULTS: JSON.stringify(context.gates), GITHUB_OUTPUT: output,
  };
  const readOutput = async (file) => Object.fromEntries((await readFile(file, "utf8")).trim().split("\n").map((line) => line.split("=")));
  await publishImages("prepare", environment);
  assert.deepEqual(await readOutput(output), {
    source_tag: `sha-${sha}`, app_image: RELEASE_IMAGES.app, app_build: "true", app_digest: "",
    worker_image: RELEASE_IMAGES.worker, worker_build: "true", worker_digest: "",
  });
  assert.equal(fixture.tokens.length, 2);
  assert(fixture.tokens.every((token) => token.authenticated && token.scope.endsWith(":pull,push")));
  assert.equal(fixture.writes.length, 0);

  // Buildx supplies these new identities; a later rerun must reuse the same pair.
  for (const image of Object.values(RELEASE_IMAGES)) fixture.values.set(image, fixtureImage());
  const expected = fixture.expected();
  await publishImages("finish", {
    ...environment, APP_EXPECTED_DIGEST: expected.app, WORKER_EXPECTED_DIGEST: expected.worker,
    GITHUB_STEP_SUMMARY: summary,
  });
  const result = JSON.parse(logs.at(-1));
  assert.equal(result.status, "published");
  assert.equal(result.anonymousAccess, true);
  assert.deepEqual(result.images.map((image) => image.digest), Object.values(expected));
  const rendered = await readFile(summary, "utf8");
  for (const [name, image] of Object.entries(RELEASE_IMAGES)) assert(rendered.includes(`${image}@${expected[name]}`));
  assert(!rendered.includes(environment.GITHUB_TOKEN));
  assert(!logs.join("\n").includes(environment.GITHUB_TOKEN));

  await publishImages("prepare", { ...environment, GITHUB_OUTPUT: reusedOutput });
  const reused = await readOutput(reusedOutput);
  assert.equal(reused.app_build, "false"); assert.equal(reused.worker_build, "false");
  assert.equal(reused.app_digest, expected.app); assert.equal(reused.worker_digest, expected.worker);
  assert.equal(fixture.writes.length, 2);
});

test("denied, network, malformed and integrity failures never become build-missing", async () => {
  await assert.rejects(prepareRelease(context, registryFixture({ denied: true }).registry), { code: "REGISTRY_DENIED" });
  const network = new GhcrRegistry({ fetcher: async () => { throw new Error("secret=must-not-surface"); } });
  await assert.rejects(prepareRelease(context, network), (error) => error.code === "REGISTRY_REQUEST_FAILED" && !error.message.includes("must-not-surface"));
  const malformed = new GhcrRegistry({ fetcher: async () => new Response("not JSON") });
  await assert.rejects(prepareRelease(context, malformed), { code: "REGISTRY_RESPONSE_INVALID" });
  await assert.rejects(prepareRelease(context, new GhcrRegistry({ fetcher: async () => json(null) })), { code: "REGISTRY_RESPONSE_INVALID" });
  await assert.rejects(prepareRelease(context, registryFixture({ badDigest: true }).registry), { code: "REGISTRY_DIGEST_MISMATCH" });
  const false404 = new GhcrRegistry({ fetcher: async (url) => new URL(url).pathname === "/token" ? json({ token: "token" }) : json({ message: "routing failure" }, 404) });
  await assert.rejects(prepareRelease(context, false404), { code: "REGISTRY_HTTP_ERROR" });
});

test("existing image platform, source, revision and license must match exactly", async () => {
  for (const options of [{ architecture: "arm64" }, { os: "windows" }, { source: "https://attacker.invalid" }, { sha: laterSha }, { license: "MIT" }]) {
    const fixture = registryFixture(); fixture.values.set(RELEASE_IMAGES.app, fixtureImage(options));
    await assert.rejects(prepareRelease(context, fixture.registry), (error) => ["INVALID_PLATFORM", "IMAGE_IDENTITY_MISMATCH"].includes(error.code));
    assert.equal(fixture.writes.length, 0);
  }
});

test("registry blob redirects strip authentication and refuse arbitrary hosts", async () => {
  const fixture = registryFixture(); let blobRequest;
  const fetcher = async (url, init) => {
    if (new URL(url).hostname === "pkg-containers.githubusercontent.com") {
      blobRequest = init;
      return new Response(fixture.values.get(RELEASE_IMAGES.app).config);
    }
    if (new URL(url).pathname.includes("/blobs/")) return new Response(null, { status: 307, headers: { location: "https://pkg-containers.githubusercontent.com/ghcr1/blobs/config?signature=fixture-only" } });
    return fixture.fetcher(url, init);
  };
  const registry = new GhcrRegistry({ actor: "maintainer", token: "test-job-token", fetcher });
  assert.equal((await registry.resolve(RELEASE_IMAGES.app, sha)).digest, fixture.expected().app);
  assert.equal(new Headers(blobRequest.headers).get("Authorization"), null);
  const unsafe = new GhcrRegistry({ fetcher: async (url) => new URL(url).pathname === "/token" ? json({ token: "token" })
    : new URL(url).pathname.includes("/blobs/") ? new Response(null, { status: 307, headers: { location: "https://untrusted.invalid/config" } })
      : new Response(fixture.values.get(RELEASE_IMAGES.app).manifest) });
  await assert.rejects(unsafe.resolve(RELEASE_IMAGES.app, sha), { code: "REGISTRY_REDIRECT" });
});

test("registry metadata reads are bounded for both declared and streamed content", async () => {
  const declared = new GhcrRegistry({ fetcher: async () => new Response("{}", { headers: { "content-length": "3000000" } }) });
  await assert.rejects(declared.resolve(RELEASE_IMAGES.app, sha), { code: "REGISTRY_RESPONSE_SIZE" });
  const streamed = new GhcrRegistry({ fetcher: async () => new Response("x".repeat(2 * 1024 * 1024 + 1)) });
  await assert.rejects(streamed.resolve(RELEASE_IMAGES.app, sha), { code: "REGISTRY_RESPONSE_SIZE" });
});

test("OCI indexes may contain one amd64 image and an attestation, not another runtime architecture", async () => {
  const fixture = registryFixture(), value = fixture.values.get(RELEASE_IMAGES.app);
  const runtime = { digest: value.digest, platform: { os: "linux", architecture: "amd64" } };
  const attestation = { digest: `sha256:${"c".repeat(64)}`, platform: { os: "unknown", architecture: "unknown" }, annotations: { "vnd.docker.reference.type": "attestation-manifest" } };
  value.index = bytes({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json", manifests: [runtime, attestation] });
  assert.equal((await prepareRelease(context, fixture.registry)).images.app.digest, digest(value.index));
  value.index = bytes({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json", manifests: [runtime, { ...runtime, platform: { os: "linux", architecture: "arm64" } }] });
  await assert.rejects(prepareRelease(context, fixture.registry), { code: "INVALID_PLATFORM" });
});

test("both identities and anonymous manifests must verify before any latest write", async () => {
  const fixture = registryFixture(), reports = [];
  const state = await finishRelease(context, { ...fixture, expected: fixture.expected(), mainSha: async () => sha, report: (value) => reports.push(structuredClone(value)) });
  assert.equal(state.status, "published"); assert.equal(state.anonymousAccess, true);
  assert.equal(state.images.length, 2); assert.equal(fixture.writes.length, 2);
  assert.deepEqual(fixture.writes.map((write) => write.digest), Object.values(fixture.expected()));
  assert.equal(fixture.tokens.filter((token) => !token.authenticated).length, 2);
  assert(fixture.tokens.filter((token) => !token.authenticated).every((token) => token.scope.endsWith(":pull")));
  assert(!JSON.stringify(reports).includes("test-job-token"));
  const firstPut = fixture.requests.findIndex((request) => request.method === "PUT");
  assert.equal(fixture.requests.slice(0, firstPut).filter((request) => request.headers.get("Authorization") === "Bearer anonymous-registry-token" && request.url.pathname.includes("/blobs/")).length, 2);
});

test("private first-publication gives package settings instructions and preserves both aliases", async () => {
  const fixture = registryFixture({ privateImages: [RELEASE_IMAGES.worker] }), reports = [];
  await assert.rejects(finishRelease(context, { ...fixture, expected: fixture.expected(), mainSha: async () => sha, report: (value) => reports.push(value) }), (error) => error.code === "PUBLIC_ACCESS_REQUIRED" && error.message.includes("narra-image-worker/settings") && error.message.includes("Public"));
  assert.equal(fixture.writes.length, 0); assert.equal(reports[0].status, "failed");
  assert.equal(reports[0].images.length, 2);
});

test("an anonymous registry outage is not mislabeled as a package visibility change", async () => {
  const fixture = registryFixture();
  const anonymous = { resolve: async () => { throw new ImageReleaseError("REGISTRY_HTTP_ERROR", "Registry unavailable", 503); } };
  await assert.rejects(finishRelease(context, { ...fixture, anonymous, expected: fixture.expected(), mainSha: async () => sha }), { code: "REGISTRY_HTTP_ERROR" });
  assert.equal(fixture.writes.length, 0);
});

test("missing or mutated fixed tags and malformed expected digests cannot reach promotion", async () => {
  for (const mode of ["missing", "mutated", "malformed"]) {
    const fixture = registryFixture(), expected = fixture.expected();
    if (mode === "missing") fixture.values.delete(RELEASE_IMAGES.worker);
    if (mode === "mutated") fixture.values.set(RELEASE_IMAGES.worker, fixtureImage({ sha: laterSha }));
    if (mode === "malformed") expected.worker = "arbitrary-tag";
    await assert.rejects(finishRelease(context, { ...fixture, expected, mainSha: async () => sha }));
    assert.equal(fixture.writes.length, 0);
  }
});

test("a superseded main run skips aliases and a mid-promotion change reports partial state", async () => {
  const fixture = registryFixture();
  const state = await finishRelease(context, { ...fixture, expected: fixture.expected(), mainSha: async () => laterSha });
  assert.equal(state.status, "stale-main-skipped"); assert.equal(fixture.writes.length, 0);
  let queries = 0, failure;
  await assert.rejects(finishRelease(context, { ...fixture, expected: fixture.expected(), mainSha: async () => ++queries < 3 ? sha : laterSha, report: (value) => { failure = value; } }), { code: "STALE_MAIN" });
  assert.equal(fixture.writes.length, 1); assert.equal(failure.status, "failed"); assert.deepEqual(failure.promoted, [RELEASE_IMAGES.app]);
});

test("a second alias failure is not hidden or rolled back destructively", async () => {
  const fixture = registryFixture({ failSecondPut: true }); let failure;
  await assert.rejects(finishRelease(context, { ...fixture, expected: fixture.expected(), mainSha: async () => sha, report: (value) => { failure = value; } }), { code: "REGISTRY_HTTP_ERROR" });
  assert.deepEqual(failure.promoted, [RELEASE_IMAGES.app]); assert.equal(fixture.writes.length, 2);
  assert(fixture.requests.every((request) => request.method !== "DELETE"));
});

test("GitHub main lookup is fixed to the repository, validates SHA and never follows redirects", async () => {
  let request;
  assert.equal(await currentMainSha("test-only", async (url, init) => { request = { url, init }; return json({ object: { sha } }); }), sha);
  assert.equal(request.url, `https://api.github.com/repos/${RELEASE_REPOSITORY}/git/ref/heads/main`);
  assert.equal(request.init.redirect, "manual");
  await assert.rejects(currentMainSha("test-only", async () => json({ object: { sha: "main" } })), { code: "INVALID_SOURCE" });
});

test("workflow publication uses all verification jobs, trusted refs, minimal permissions and immutable tags", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/verify.yml", import.meta.url), "utf8");
  assert.match(workflow, /permissions:\s*\n  contents: read\s*\n\s*jobs:/);
  const publish = workflow.split("  publish-images:")[1]; assert(publish);
  for (const expected of ["needs: [verify-ci, verify-migrations, verify-e2e]", "github.event_name == 'push'", "github.ref == 'refs/heads/main'", "github.repository == '0401lucky/narra-image'", "packages: write", "cancel-in-progress: false", "ref: ${{ github.sha }}", "persist-credentials: false"]) assert(publish.includes(expected), expected);
  assert(!workflow.includes("pull_request_target")); assert(!publish.includes("always()")); assert(!publish.includes("continue-on-error"));
  assert.equal(workflow.match(/packages: write/g).length, 1);
  assert.equal(publish.match(/platforms: linux\/amd64/g).length, 2);
  assert.equal(publish.match(/tags: .*source_tag/g).length, 2);
  assert(!publish.includes(":latest"));
  assert.equal(publish.match(/uses: [^\n]+@[a-f0-9]{40}/g).length, 6);
  assert(publish.indexOf("publish-images.mjs finish") > publish.indexOf("Build and publish Worker"));
});

test("image-only overlay removes inherited builds, requires explicit images and retains base topology", async () => {
  const overlay = await readFile(new URL("../../docker-compose.images.yml", import.meta.url), "utf8");
  assert.equal((overlay.match(/build: !reset null/g) ?? []).length, 2);
  assert.equal((overlay.match(/\$\{APP_IMAGE:\?/g) ?? []).length, 2);
  assert.equal((overlay.match(/\$\{WORKER_IMAGE:\?/g) ?? []).length, 1);
  assert(!/volumes:|environment:|ports:|command:|depends_on:/.test(overlay));
});

test("both public runtime images retain the application and third-party license notices", async () => {
  const app = await readFile(new URL("../../Dockerfile", import.meta.url), "utf8");
  const worker = await readFile(new URL("../../worker/Dockerfile", import.meta.url), "utf8");
  assert.match(app.split("FROM base AS runner")[1], /COPY --from=builder \/app\/LICENSE \/app\/THIRD_PARTY_NOTICES\.md \.\//);
  assert.match(worker.split("WORKDIR /app")[1], /COPY LICENSE THIRD_PARTY_NOTICES\.md \.\//);
});

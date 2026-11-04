import { appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertReleaseContext, currentMainSha, finishRelease, GhcrRegistry, ImageReleaseError, prepareRelease } from "./lib/image-release.mjs";

export async function main(mode, environment = process.env) {
  let gates;
  try { gates = JSON.parse(environment.RELEASE_GATE_RESULTS ?? "{}"); }
  catch { throw new ImageReleaseError("UNVERIFIED_RELEASE", "Invalid verification-job results"); }
  const context = { repository: environment.GITHUB_REPOSITORY, eventName: environment.GITHUB_EVENT_NAME, ref: environment.GITHUB_REF, sha: environment.GITHUB_SHA, gates };
  assertReleaseContext(context);
  if (!environment.GITHUB_TOKEN || !environment.GITHUB_ACTOR) throw new ImageReleaseError("REGISTRY_CREDENTIALS", "Missing repository job identity");
  const registry = new GhcrRegistry({ actor: environment.GITHUB_ACTOR, token: environment.GITHUB_TOKEN });
  if (mode === "prepare") {
    if (!environment.GITHUB_OUTPUT) throw new ImageReleaseError("MISSING_OUTPUT", "Run preparation from the publication job");
    const prepared = await prepareRelease(context, registry);
    const outputs = [`source_tag=${prepared.tag}`];
    for (const [name, image] of Object.entries(prepared.images)) {
      outputs.push(`${name}_image=${image.image}`, `${name}_build=${image.build}`, `${name}_digest=${image.digest}`);
    }
    await appendFile(environment.GITHUB_OUTPUT, outputs.join("\n") + "\n");
    console.log(`Prepared ${prepared.sha}; missing images: ${Object.entries(prepared.images).filter(([, image]) => image.build).map(([name]) => name).join(", ") || "none (reusing fixed tags)"}`);
    return;
  }
  if (mode !== "finish") throw new ImageReleaseError("INVALID_COMMAND", "Use prepare or finish");
  await finishRelease(context, {
    registry, anonymous: new GhcrRegistry(), expected: { app: environment.APP_EXPECTED_DIGEST, worker: environment.WORKER_EXPECTED_DIGEST },
    mainSha: () => currentMainSha(environment.GITHUB_TOKEN),
    report: async (result) => {
      const lines = [`## Container publication: ${result.status}`, "", `Source: \`${result.sha}\` (linux/amd64)`, ""];
      for (const image of result.images) lines.push(`- \`${image.reference}\``, `- Source tag: \`${image.image}:${result.tag}\``, `- Pull: \`docker pull ${image.reference}\``);
      lines.push("", "Use the matching source-tag/digest pair for deployments; two latest aliases are not an atomic update.");
      if (result.promoted.length) lines.push(`Promoted latest: ${result.promoted.join(", ")}`);
      if (result.error) lines.push("", result.error);
      if (environment.GITHUB_STEP_SUMMARY) await appendFile(environment.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
      console.log(JSON.stringify(result));
    },
  });
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((error) => {
    console.error(error instanceof ImageReleaseError ? error.message : "Image publication failed; no credentials or upstream response are logged");
    process.exitCode = 1;
  });
}

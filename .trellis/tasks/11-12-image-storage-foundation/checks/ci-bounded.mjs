import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "../../../../scripts/verify-ci.mjs";
import { runStages } from "../../../../scripts/lib/command-runner.mjs";

// The unchanged CI pipeline failed with multiple V8 OOMs on this workstation.
// Retain every stage and assertion. Bound local concurrency and the test V8
// heap so this host's low available commit does not depend on V8's auto limit.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const nextDefaults = readFileSync(path.join(ROOT, "node_modules/next/dist/server/config-shared.js"), "utf8");
assert(nextDefaults.includes("Number(process.env.CIRCLE_NODE_TOTAL)"), "Re-audit Next's local build concurrency setting");
process.exitCode = await main({
  run: async (stages, options) => {
    assert.equal(stages.length, 10, "Review changes to the complete CI pipeline before adapting it");
    let tests = 0;
    let builds = 0;
    const bounded = stages.map((stage) => {
      if (stage.label === "TypeScript 类型检查") {
        assert.deepEqual(stage.args, ["exec", "tsc", "--noEmit"]);
        return { ...stage, env: { ...options.env, ...stage.env,
          NODE_OPTIONS: `${stage.env?.NODE_OPTIONS ?? options.env?.NODE_OPTIONS ?? ""} --max-old-space-size=1536 --max-semi-space-size=4`.trim(),
        } };
      }
      if (stage.label === "Vitest 全量单测") {
        assert.deepEqual(stage.args.slice(0, 3), ["exec", "vitest", "run"]);
        tests += 1;
        return { ...stage,
          args: [...stage.args, "--reporter=./.trellis/tasks/11-12-image-storage-foundation/checks/ci-test-progress.mjs", "--maxWorkers=2"],
          env: { ...options.env, ...stage.env,
            NODE_OPTIONS: `${stage.env?.NODE_OPTIONS ?? options.env?.NODE_OPTIONS ?? ""} --max-old-space-size=512 --max-semi-space-size=4`.trim(),
          },
        };
      }
      if (stage.label === "Next.js 生产构建") {
        assert.deepEqual(stage.args, ["build"]);
        assert.equal(stage.env.NODE_ENV, "production");
        builds += 1;
        return { ...stage, env: { ...stage.env, CIRCLE_NODE_TOTAL: "2",
          NODE_OPTIONS: `${stage.env?.NODE_OPTIONS ?? options.env?.NODE_OPTIONS ?? ""} --max-old-space-size=1536 --max-semi-space-size=4`.trim(),
        } };
      }
      return stage;
    });
    assert.equal(tests, 1);
    assert.equal(builds, 1);
    console.log(JSON.stringify({ localCiConcurrency: { vitestWorkers: 2, nextBuildWorkers: 1, testOldSpaceMiB: 512, testSemiSpaceMiB: 4, buildOldSpaceMiB: 1536, buildSemiSpaceMiB: 4 }, originalStages: stages.length, skippedStages: 0 }));
    return runStages(bounded, options);
  },
});

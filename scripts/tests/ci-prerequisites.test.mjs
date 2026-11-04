import assert from "node:assert/strict";
import test from "node:test";

import { createCiStages, main } from "../verify-ci.mjs";
import { runStages } from "../lib/command-runner.mjs";
import { waitForPostgres } from "../lib/disposable-postgres.mjs";

test("CI generates a clean Prisma client before TypeScript and never leaks build-only settings into tests", async () => {
  const environment = { PATH: "synthetic-path", AUTH_SECRET: "test-only" };
  const stages = createCiStages(environment);
  const generate = stages.findIndex((stage) => stage.args.join(" ") === "exec prisma generate");
  const types = stages.findIndex((stage) => stage.args.includes("tsc"));
  assert(generate >= 0 && generate < types);
  for (const stage of stages.slice(0, -1)) assert.equal(stage.env, undefined);
  const build = stages.at(-1);
  assert.equal(build.env.APP_URL, "https://narra-build.invalid");
  assert.equal(build.env.NODE_ENV, "production");
  assert.notEqual(build.env.AUTH_SECRET, environment.AUTH_SECRET);
  assert.equal(environment.APP_URL, undefined);
  let captured;
  assert.equal(await main({ environment, run: async (commands, options) => {
    captured = { commands, options }; return 7;
  } }), 7);
  assert.equal(captured.options.env.APP_URL, undefined);
  assert.equal(captured.options.env.NODE_ENV, undefined);
  assert.equal(captured.options.env.CI, "1");
});

test("a failing generation stage stops the actual stage runner before TypeScript", async () => {
  const stages = createCiStages({});
  const start = stages.findIndex((stage) => stage.args.join(" ") === "exec prisma generate");
  const commands = stages.slice(start, start + 2).map((stage, index) => ({
    ...stage, executable: process.execPath,
    args: ["-e", index === 0 ? "process.exit(9)" : "process.exit(99)"],
    capture: true,
  }));
  assert.equal(await runStages(commands, { deadlineMs: 5000, scope: "ci-prerequisite-test" }), 9);
});

test("disposable readiness ignores a live initialization socket until the final TCP server is ready", async () => {
  const resource = { containerName: "narra-test-owned", databaseUser: "release", adminDatabase: "narra_admin_test" };
  let clock = 1000, probes = 0;
  await waitForPostgres(resource, { deadlineAt: 9000 }, {
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    probe: async (actual, args, options) => {
      assert.equal(actual, resource);
      assert.deepEqual(args.slice(0, 8), ["exec", resource.containerName, "pg_isready", "--quiet", "--host", "127.0.0.1", "--port", "5432"]);
      assert.equal(options.deadlineAt, 9000);
      assert.equal(options.timeoutMs, 1000);
      // The initialization server would return zero over its Unix socket.
      probes += 1; return { code: probes < 3 ? 1 : 0 };
    },
  });
  assert.equal(probes, 3);
  assert.equal(clock, 1500);
});

test("disposable readiness keeps its 20s bound and preserves terminal failure", async () => {
  let clock = 0, deadline;
  await assert.rejects(waitForPostgres({}, { deadlineAt: 100_000 }, {
    now: () => clock, sleep: async (ms) => { clock += ms; },
    probe: async (_resource, _args, options) => { deadline = options.deadlineAt; return { code: 1 }; },
  }), /未在期限内 ready/);
  assert.equal(deadline, 20_000);
  assert.equal(clock, 20_000);
  await assert.rejects(waitForPostgres({}, { deadlineAt: 20_000 }, {
    now: () => 0, probe: async () => { throw new Error("owned Docker probe failed"); },
  }), /owned Docker probe failed/);
});

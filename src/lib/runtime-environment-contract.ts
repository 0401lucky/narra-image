import { z } from "zod";

import environmentFixture from "../../contracts/runtime/v1/environment.json";

const runtimeEnvironmentVariableSchema = z.object({
  name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  owner: z.enum(["deployment", "next", "readiness", "shared", "supervisor", "worker"]),
  type: z.enum(["boolean", "csv", "enum", "integer", "number", "string", "url"]),
  default: z.union([z.boolean(), z.number(), z.string(), z.null()]),
  requiredInProduction: z.boolean(),
  secret: z.boolean(),
  phase: z.enum(["build-time", "runtime"]),
  constraints: z.record(z.string(), z.unknown()),
  consumers: z.array(z.enum([
    "compose",
    "docker",
    "next",
    "prisma",
    "supervisor",
    "worker",
  ])).min(1),
  allowedReadPaths: z.array(z.string().min(1)).min(1),
  documentation: z.object({
    envExample: z.boolean(),
    readme: z.boolean(),
  }),
});

const runtimeEnvironmentContractSchema = z.object({
  contract: z.literal("narra.runtime.environment"),
  version: z.literal(1),
  variables: z.array(runtimeEnvironmentVariableSchema).min(1),
}).superRefine((contract, ctx) => {
  const seen = new Set<string>();
  for (const [index, variable] of contract.variables.entries()) {
    if (seen.has(variable.name)) {
      ctx.addIssue({
        code: "custom",
        message: `环境变量 ${variable.name} 重复定义`,
        path: ["variables", index, "name"],
      });
    }
    seen.add(variable.name);
  }
});

const parsed = runtimeEnvironmentContractSchema.safeParse(environmentFixture);
if (!parsed.success) {
  throw new Error(
    `运行时环境契约无效：${z.prettifyError(parsed.error)}`,
  );
}

export const RUNTIME_ENVIRONMENT_CONTRACT = parsed.data;

export function getRuntimeEnvironmentVariable(name: string) {
  return RUNTIME_ENVIRONMENT_CONTRACT.variables.find(
    (variable) => variable.name === name,
  );
}

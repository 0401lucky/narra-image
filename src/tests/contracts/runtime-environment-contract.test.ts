import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseEnv } from "@/lib/env";
import { RUNTIME_ENVIRONMENT_CONTRACT } from "@/lib/runtime-environment-contract";

const PROJECT_ROOT = process.cwd();

function normalizePath(filePath: string) {
  return filePath.replaceAll("\\", "/");
}

function collectFiles(relativeDirectory: string) {
  const absoluteDirectory = path.join(PROJECT_ROOT, relativeDirectory);
  if (!existsSync(absoluteDirectory)) return [];

  const files: string[] = [];
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = normalizePath(path.join(relativeDirectory, entry.name));
    if (entry.isDirectory()) {
      files.push(...collectFiles(relativePath));
      continue;
    }
    files.push(relativePath);
  }
  return files;
}

function auditedRuntimeFiles() {
  return [
    ...collectFiles("src").filter((filePath) =>
      /\.(?:ts|tsx)$/.test(filePath) && !filePath.startsWith("src/tests/"),
    ),
    ...collectFiles("scripts").filter((filePath) =>
      filePath.endsWith(".mjs") &&
      !filePath.includes("/tests/") &&
      !filePath.includes("/fixtures/"),
    ),
    ...collectFiles("worker").filter((filePath) =>
      filePath.endsWith(".go") && !filePath.endsWith("_test.go"),
    ),
    ...collectFiles("prisma").filter((filePath) => filePath.endsWith(".ts")),
    "prisma.config.ts",
  ];
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function directReadPatterns(variableName: string) {
  const escaped = escapeRegex(variableName);
  return [
    new RegExp(`process\\.env\\.${escaped}\\b`, "g"),
    new RegExp(`process\\.env\\[['\"]${escaped}['\"]\\]`, "g"),
    new RegExp(`os\\.(?:Getenv|LookupEnv)\\(['\"]${escaped}['\"]\\)`, "g"),
  ];
}

function lineNumberAt(content: string, offset: number) {
  return content.slice(0, offset).split("\n").length;
}

describe("runtime environment manifest", () => {
  it("keeps the legacy timeout range while bounding managed image write leases", () => {
    const variable = RUNTIME_ENVIRONMENT_CONTRACT.variables.find((entry) => entry.name === "WORKER_JOB_TIMEOUT_SECONDS")!;
    expect(variable.consumers).toEqual(expect.arrayContaining(["next", "worker"]));
    expect(variable.constraints).toMatchObject({ maximum: 86400, maximumWhenManagedImagesEnabled: 3480, managedImagesFlag: "IMAGE_STORAGE_MANAGED_ENABLED", imageWriteLeaseMarginSeconds: 120 });
    const base = { AUTH_SECRET: "unit-test-secret", DATABASE_URL: "postgresql://localhost/test", NODE_ENV: "development" as const };
    expect(parseEnv({ ...base, WORKER_JOB_TIMEOUT_SECONDS: "86400" }).WORKER_JOB_TIMEOUT_SECONDS).toBe(86400);
    expect(parseEnv({ ...base, IMAGE_STORAGE_MANAGED_ENABLED: "true", WORKER_JOB_TIMEOUT_SECONDS: "3480" }).WORKER_JOB_TIMEOUT_SECONDS).toBe(3480);
    expect(() => parseEnv({ ...base, IMAGE_STORAGE_MANAGED_ENABLED: "true", WORKER_JOB_TIMEOUT_SECONDS: "3481" })).toThrow("3480");
  });

  it.each([
    [undefined, false], ["", false], ["true", true], [" YES ", true], ["1", true],
    ["false", false], [" NO ", false], ["0", false],
  ] as const)("数据库存图开关显式解析 %s 为 %s", (value, expected) => {
    const parsed = parseEnv({
      AUTH_SECRET: "unit-test-secret",
      DATABASE_URL: "postgresql://localhost/test",
      NODE_ENV: "test",
      ENABLE_DATABASE_IMAGE_STORAGE: value,
    });
    expect(parsed.ENABLE_DATABASE_IMAGE_STORAGE).toBe(expected);
  });

  it.each(["enabled", " "])("拒绝无效的数据库存图开关 %s", (value) => {
    expect(() => parseEnv({
      AUTH_SECRET: "unit-test-secret",
      DATABASE_URL: "postgresql://localhost/test",
      NODE_ENV: "development",
      ENABLE_DATABASE_IMAGE_STORAGE: value,
    })).toThrow();
  });

  it.each(["s3", "local"] as const)("数据库存图开关保留受管理 %s 配置与限制", (backend) => {
    const base = {
      AUTH_SECRET: "production-test-secret-with-at-least-32-characters",
      DATABASE_URL: "postgresql://127.0.0.1:1/test",
      NODE_ENV: "production" as const,
      APP_URL: "https://narra.example.com",
      ENABLE_DATABASE_IMAGE_STORAGE: "true",
      IMAGE_STORAGE_MANAGED_ENABLED: "true",
      IMAGE_STORAGE_BACKEND: backend,
      IMAGE_STORAGE_PATH: path.resolve("fixture-images"),
      IMAGE_STORAGE_VOLUME_ID: "00112233-4455-4677-8899-aabbccddeeff",
    };
    expect(parseEnv(base)).toMatchObject({
      ENABLE_DATABASE_IMAGE_STORAGE: true,
      IMAGE_STORAGE_MANAGED_ENABLED: true,
      IMAGE_STORAGE_BACKEND: backend,
    });
    expect(() => parseEnv({ ...base, WORKER_JOB_TIMEOUT_SECONDS: "3481" })).toThrow("3480");
    if (backend === "local") {
      expect(() => parseEnv({ ...base, IMAGE_STORAGE_MANAGED_ENABLED: "false" })).toThrow("本地图片存储必须启用受管理存储");
    }
  });

  it("定义唯一变量名且允许读取路径真实存在", () => {
    const names = RUNTIME_ENVIRONMENT_CONTRACT.variables.map((variable) => variable.name);
    expect(new Set(names).size).toBe(names.length);

    for (const variable of RUNTIME_ENVIRONMENT_CONTRACT.variables) {
      for (const allowedPath of variable.allowedReadPaths) {
        expect(
          existsSync(path.join(PROJECT_ROOT, allowedPath)),
          `${variable.name} 的允许读取路径不存在：${allowedPath}`,
        ).toBe(true);
      }
    }
  });

  it("Node loader 覆盖 manifest 声明的全部 Node runtime 变量和默认值", () => {
    const parsed = parseEnv({
      AUTH_SECRET: "unit-test-secret",
      DATABASE_URL: "postgresql://localhost/test",
      NODE_ENV: "development",
      WORKER_RUNTIME_MODE: "embedded",
    });
    const parsedRecord = parsed as unknown as Record<string, unknown>;

    for (const variable of RUNTIME_ENVIRONMENT_CONTRACT.variables) {
      if (!variable.allowedReadPaths.includes("src/lib/env.ts")) continue;
      expect(parsedRecord).toHaveProperty(variable.name);
      if (variable.default !== null && variable.name !== "WORKER_RUNTIME_MODE") {
        expect(
          parsedRecord[variable.name],
          `${variable.name} 的 Node 默认值与 manifest 不一致`,
        ).toEqual(variable.default);
      }
    }
  });

  it("拒绝 manifest owner 路径之外直接读取受管变量", () => {
    const violations: string[] = [];
    for (const filePath of auditedRuntimeFiles()) {
      const content = readFileSync(path.join(PROJECT_ROOT, filePath), "utf8");
      for (const variable of RUNTIME_ENVIRONMENT_CONTRACT.variables) {
        if (variable.allowedReadPaths.includes(filePath)) continue;
        for (const pattern of directReadPatterns(variable.name)) {
          for (const match of content.matchAll(pattern)) {
            violations.push(
              `${filePath}:${lineNumberAt(content, match.index ?? 0)} 直接读取 ${variable.name}`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("Next 生产代码仅在专用 loader 中访问 process.env", () => {
    const allowedNodeLoaders = new Set([
      "src/lib/env.ts",
      "src/lib/public-env.ts",
    ]);
    const violations = collectFiles("src")
      .filter((filePath) =>
        /\.(?:ts|tsx)$/.test(filePath) && !filePath.startsWith("src/tests/"),
      )
      .filter((filePath) =>
        !allowedNodeLoaders.has(filePath) &&
        readFileSync(path.join(PROJECT_ROOT, filePath), "utf8").includes("process.env"),
      );

    expect(violations).toEqual([]);
  });

  it(".env.example 与 README 覆盖 manifest 要求公开的变量", () => {
    const envExample = readFileSync(path.join(PROJECT_ROOT, ".env.example"), "utf8");
    const readme = readFileSync(path.join(PROJECT_ROOT, "README.md"), "utf8");
    const missingEnv: string[] = [];
    const missingReadme: string[] = [];

    for (const variable of RUNTIME_ENVIRONMENT_CONTRACT.variables) {
      if (
        variable.documentation.envExample &&
        !new RegExp(`^${escapeRegex(variable.name)}=`, "m").test(envExample)
      ) {
        missingEnv.push(variable.name);
      }
      if (
        variable.documentation.readme &&
        !readme.includes(`\`${variable.name}\``)
      ) {
        missingReadme.push(variable.name);
      }
    }

    expect(missingEnv, ".env.example 缺少变量").toEqual([]);
    expect(missingReadme, "README 缺少变量").toEqual([]);
  });
});

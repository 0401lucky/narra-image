import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const TIMEOUT_EXIT_CODE = 124;

export function formatCommand(command) {
  return [command.executable, ...(command.args ?? [])].join(" ");
}

export function assertFixedTargets(projectRoot, targets, scope = "verify") {
  const missingTargets = targets.filter(
    (target) => !existsSync(path.resolve(projectRoot, target)),
  );
  if (missingTargets.length === 0) return;

  const details = missingTargets.map((target) => `  - ${target}`).join("\n");
  throw new Error(`[${scope}] 缺少固定验证目标，拒绝假绿：\n${details}`);
}

export function terminateProcessTree(child) {
  if (!child?.pid) return;

  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }

  const forceKillTimer = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, 750);
  forceKillTimer.unref();
}

function resolveExecutable(command) {
  const requiresWindowsCommandShell =
    process.platform === "win32" &&
    ["pnpm", "npm", "npx", "prisma"].includes(command.executable);
  if (!requiresWindowsCommandShell) {
    return {
      executable: command.executable,
      args: command.args ?? [],
    };
  }

  return {
    executable: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", formatCommand(command)],
  };
}

export function runCommand(command, options = {}) {
  const startedAt = Date.now();
  const deadlineAt = options.deadlineAt ?? Number.POSITIVE_INFINITY;
  const remainingMs = deadlineAt - startedAt;
  const timeoutMs = Math.min(
    command.timeoutMs ?? options.timeoutMs ?? remainingMs,
    remainingMs,
  );
  if (!Number.isFinite(timeoutMs) && timeoutMs !== Number.POSITIVE_INFINITY) {
    throw new Error(`命令超时配置无效：${timeoutMs}`);
  }
  if (timeoutMs <= 0) {
    return Promise.resolve({
      code: TIMEOUT_EXIT_CODE,
      signal: null,
      timedOut: true,
      durationMs: 0,
      stdout: "",
      stderr: "启动命令前已超过截止时间",
    });
  }

  const capture = command.capture === true;
  const resolved = resolveExecutable(command);
  return new Promise((resolve) => {
    const child = spawn(resolved.executable, resolved.args, {
      cwd: command.cwd ?? options.cwd ?? process.cwd(),
      detached: process.platform !== "win32",
      env: command.env ?? options.env ?? process.env,
      shell: false,
      stdio: [
        command.input === undefined ? "ignore" : "pipe",
        capture ? "pipe" : "inherit",
        capture ? "pipe" : "inherit",
      ],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timer = Number.isFinite(timeoutMs)
      ? setTimeout(() => {
          timedOut = true;
          terminateProcessTree(child);
        }, timeoutMs)
      : null;

    const finish = (code, signal = null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        code,
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin?.on("error", () => {
      // 子进程提前退出时可能关闭 stdin；退出码承载真实失败。
    });
    if (command.input !== undefined) child.stdin?.end(command.input);

    child.once("error", (error) => {
      stderr += `${error.message}\n`;
      finish(1);
    });
    child.once("exit", (code, signal) => {
      finish(timedOut ? TIMEOUT_EXIT_CODE : (code ?? 1), signal);
    });
  });
}

export async function runStage(command, options = {}) {
  const scope = options.scope ?? "verify";
  const stage = command.label ?? formatCommand(command);
  console.log(`[${scope}] 阶段开始: ${stage}`);
  console.log(`[${scope}] 执行: ${formatCommand(command)}`);

  const result = await runCommand(command, options);
  console.log(
    `[${scope}] 阶段结束: ${stage}; duration_ms=${result.durationMs}; exit_code=${result.code}`,
  );
  if (result.timedOut) {
    console.error(`[${scope}] 阶段超时并已终止子进程树: ${stage}`);
  }
  return result;
}

export async function runStages(commands, options = {}) {
  const deadlineAt =
    options.deadlineAt ??
    (options.deadlineMs
      ? Date.now() + options.deadlineMs
      : Number.POSITIVE_INFINITY);

  for (const command of commands) {
    const result = await runStage(command, { ...options, deadlineAt });
    if (result.code !== 0) return result.code;
  }
  return 0;
}

import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { CanvasContractError, isCanvasErrorCode } from "./contracts";

export type CanvasTransaction = Prisma.TransactionClient;
export type CanvasDatabase = Pick<typeof db, "$transaction">;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

function databaseFailure(error: unknown): { code: unknown; message: unknown } | null {
  const root = record(error);
  if (!root) return null;
  const meta = record(root.meta);
  // Raw queries wrap adapter errors; model writes and deferred guards can
  // surface the same PostgreSQL cause directly from Prisma's pg adapter.
  const adapterCause = record(record(meta?.driverAdapterError)?.cause)
    ?? (root.name === "DriverAdapterError" ? record(root.cause) : null);
  if (adapterCause) return { code: adapterCause.originalCode, message: adapterCause.originalMessage };
  if (root.code === "P2010" && meta) return { code: meta.code, message: meta.message };
  return { code: root.code, message: root.message };
}

export function canvasDatabaseError(error: unknown): CanvasContractError | null {
  const failure = databaseFailure(error);
  // canvas_raise emits a check violation; ordinary 23514 details are not public
  // business errors. Retain P0001 compatibility, always with an exact code match.
  if ((failure?.code !== "23514" && failure?.code !== "P0001") || !isCanvasErrorCode(failure.message)) return null;
  return new CanvasContractError(failure.message);
}

export function isCanvasTransactionRetryable(error: unknown): boolean {
  const root = record(error);
  const failure = databaseFailure(error);
  return root?.code === "P2034" || failure?.code === "40001" || failure?.code === "40P01";
}

// Only retry transactions known to have rolled back, never uncertain commit/connection failures.
export async function canvasTransaction<T>(operation: (tx: CanvasTransaction) => Promise<T>, database: CanvasDatabase = db): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await database.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 3_000,
        timeout: 8_000,
      });
    } catch (error) {
      if (attempt >= 2 || !isCanvasTransactionRetryable(error)) throw canvasDatabaseError(error) ?? error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}

export async function lockCanvasOwner(tx: CanvasTransaction, ownerId: string): Promise<void> {
  // The pg adapter cannot decode PostgreSQL's void result type. Only execute
  // this lock side effect; no returned row is part of the contract.
  await tx.$executeRaw`SELECT canvas_lock_owner(${ownerId}::text)`;
}

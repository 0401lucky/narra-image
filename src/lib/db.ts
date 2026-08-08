import "server-only";

import { PrismaClient } from "@prisma/client";

import { getEnv } from "@/lib/env";
import { createPrismaClient } from "../../prisma/create-prisma-client";

declare global {
  var __narraPrisma__: PrismaClient | undefined;
}

function createAppPrismaClient() {
  const env = getEnv();
  return createPrismaClient({
    connectionString: env.DATABASE_URL,
    log: env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const db = globalThis.__narraPrisma__ ?? createAppPrismaClient();

if (getEnv().NODE_ENV !== "production") {
  globalThis.__narraPrisma__ = db;
}

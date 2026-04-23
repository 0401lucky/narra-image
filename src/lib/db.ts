import "server-only";

import { PrismaClient } from "@prisma/client";

import { getEnv } from "@/lib/env";
import { createPrismaClient } from "../../prisma/create-prisma-client";

declare global {
  var __narraPrisma__: PrismaClient | undefined;
}

function createAppPrismaClient() {
  return createPrismaClient({
    connectionString: getEnv().DATABASE_URL,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const db = globalThis.__narraPrisma__ ?? createAppPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__narraPrisma__ = db;
}

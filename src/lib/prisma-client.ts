import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

type CreatePrismaClientInput = {
  connectionString: string;
  log?: Array<"query" | "info" | "warn" | "error">;
};

export function createPrismaClient({
  connectionString,
  log = ["error"],
}: CreatePrismaClientInput) {
  const pool = new Pool({
    connectionString,
  });

  return new PrismaClient({
    adapter: new PrismaPg(pool),
    log,
  });
}

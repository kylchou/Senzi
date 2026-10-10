import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";

/**
 * Shared Prisma client. Import `db` everywhere instead of constructing a new
 * PrismaClient: each instance owns a connection pool.
 */
function createClient(connectionString = process.env.DATABASE_URL) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as { senziPrisma?: PrismaClient };

export const db: PrismaClient = globalForPrisma.senziPrisma ?? createClient();

// Reuse one client across hot reloads in development.
if (process.env.NODE_ENV !== "production") globalForPrisma.senziPrisma = db;

/** Client handed to `db.$transaction(async (tx) => ...)` callbacks. */
export type TxClient = Prisma.TransactionClient;

/** Either the root client or a transaction client. */
export type DbOrTx = PrismaClient | TxClient;

/** True when `error` is a Postgres unique violation, optionally on `field`. */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  if (!field) return true;
  return JSON.stringify(error.meta ?? {}).includes(field);
}

export { createClient as createDbClient };

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

function createClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    // A connection idle for 10 s is closed (pg's default, kept on purpose): the long-running workers
    // hold no connection between batches, so nothing keeps sessions open on Neon.
    idleTimeoutMillis: 10_000,
    // A database that does not answer (Neon waking a compute takes a few seconds) fails the query
    // after 20 s instead of waiting forever; the workers then wait and retry (lib/worker/db-retry.ts).
    connectionTimeoutMillis: 20_000,
  });
  return new PrismaClient({ adapter });
}

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

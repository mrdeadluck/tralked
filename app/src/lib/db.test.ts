import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";

// These tests need Postgres up and seeded: `pnpm db:up && pnpm db:migrate && pnpm db:seed`.
// They are skipped when the database is not reachable (e.g. CI without a service).
async function databaseReachable(): Promise<boolean> {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 1500,
  });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

const reachable = await databaseReachable();

describe.skipIf(!reachable)("seeded database", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("has the 14 preview games", async () => {
    const { prisma } = await import("@/lib/db");
    expect(await prisma.game.count()).toBe(14);
  });

  it("has the complete Hollow Knight guide with 7 steps", async () => {
    const { prisma } = await import("@/lib/db");
    const guide = await prisma.guide.findFirst({
      where: { game: { slug: "hollow-knight" } },
      include: { steps: true },
    });
    expect(guide?.steps).toHaveLength(7);
  });

  it("has lucas at level 47", async () => {
    const { prisma } = await import("@/lib/db");
    const stats = await prisma.userStats.findFirst({
      where: { user: { handle: "lucas" } },
    });
    expect(stats?.level).toBe(47);
  });
});

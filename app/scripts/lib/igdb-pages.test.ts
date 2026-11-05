import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";

async function databaseReachable(): Promise<boolean> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 1500 });
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

describe.skipIf(!reachable)("igdbPageWhere", () => {
  const tag = `igdbpg${Date.now().toString(36)}`;
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.game.deleteMany({ where: { slug: { startsWith: tag } } });
    await prisma.$disconnect();
  });

  it("never skips games that share one IGDB id across a page boundary", async () => {
    const { prisma } = await import("@/lib/db");
    const { igdbPageWhere, IGDB_PAGE_ORDER } = await import("./igdb-pages");
    const shared = 2_000_000_000;
    await prisma.game.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({ slug: `${tag}-${i}`, name: `${tag} ${i}`, platforms: ["PC"], achievementCount: 0, igdbId: shared })),
    });
    const seen: string[] = [];
    let cursor: { igdbId: number; id: string } | null = null;
    for (;;) {
      const page: { id: string; igdbId: number | null; slug: string }[] = await prisma.game.findMany({
        where: igdbPageWhere(cursor),
        select: { id: true, igdbId: true, slug: true },
        orderBy: IGDB_PAGE_ORDER,
        take: 2, // smaller than the 5 sharing the id: the boundary falls inside the group
      });
      if (page.length === 0) break;
      seen.push(...page.map((g) => g.slug));
      const last = page[page.length - 1];
      cursor = { igdbId: last.igdbId!, id: last.id };
    }
    expect(seen.filter((s) => s.startsWith(tag)).sort()).toEqual([0, 1, 2, 3, 4].map((i) => `${tag}-${i}`));
  });
});

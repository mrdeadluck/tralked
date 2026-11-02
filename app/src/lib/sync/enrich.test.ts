import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";

// Needs Postgres up and migrated (see db.test.ts); skipped when unreachable.
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
const SLUG = "test-enrich-";
const APP = 97_700_000;
const silent = { info: () => {}, error: () => {} };

describe.skipIf(!reachable)("catalog enrichment", () => {
  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.game.deleteMany({ where: { slug: { startsWith: SLUG } } });
  }
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("reads Steam review totals, marks every game read and leaves the failures' totals alone", async () => {
    const { prisma } = await import("@/lib/db");
    const { enrichReviews } = await import("./enrich");
    // Above every seeded game, so they are the first of the queue.
    const ok = await prisma.game.create({
      data: { slug: `${SLUG}ok`, name: "Enrich Ok", steamAppId: APP + 1, achievementCount: 0, popularity: 2e9 },
    });
    const broken = await prisma.game.create({
      data: { slug: `${SLUG}broken`, name: "Enrich Broken", steamAppId: APP + 2, achievementCount: 0, popularity: 2e9 - 1 },
    });
    const politeFetch = async (url: string) =>
      url.includes(`/appreviews/${APP + 1}?`)
        ? new Response(JSON.stringify({ success: 1, query_summary: { total_positive: 80, total_reviews: 100 } }))
        : url.includes(`/appreviews/${APP + 2}?`)
          ? new Response("down", { status: 503 })
          : new Response(JSON.stringify({ success: 1, query_summary: { total_positive: 0, total_reviews: 0 } }));
    // Only the two test games fit before the deadline: the clock passes it after two reads.
    let reads = 0;
    const now = () => (reads >= 2 ? Date.now() + 120_000 : Date.now());
    const counting = async (url: string) => {
      reads++;
      return politeFetch(url);
    };
    const result = await enrichReviews(Date.now() + 60_000, counting, silent, now);
    expect(result).toEqual({ done: 1, failed: 1 });
    const read = (id: string) =>
      prisma.game.findUniqueOrThrow({ where: { id }, select: { steamReviewPositive: true, steamReviewTotal: true, steamReviewsAt: true } });
    expect(await read(ok.id)).toMatchObject({ steamReviewPositive: 80, steamReviewTotal: 100 });
    const failed = await read(broken.id);
    expect(failed.steamReviewTotal).toBeNull();
    expect(failed.steamReviewsAt).not.toBeNull();
  });

  it("marks media attempts, so a game without IGDB media leaves the queue", async () => {
    const { prisma } = await import("@/lib/db");
    const { mediaQueue } = await import("./media");
    const { enrichMedia } = await import("./enrich");
    const game = await prisma.game.create({
      data: { slug: `${SLUG}media`, name: "Enrich Media", achievementCount: 0, popularity: 2e9 },
    });
    const empty = {
      igdb: { findBySteamAppId: async () => null, findByName: async () => null, getMedia: async () => ({ videos: [], screenshots: [], artworks: [] }) },
      sgdb: { getArt: async () => null },
    } as unknown as Parameters<typeof enrichMedia>[2];
    let calls = 0;
    const now = () => (calls++ > 6 ? Date.now() + 120_000 : Date.now());
    await enrichMedia(Date.now() + 60_000, silent, empty, now);
    const inQueue = await prisma.game.count({ where: { id: game.id, ...mediaQueue(new Date()) } });
    expect(inQueue).toBe(0);
  });
});

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

  it("reads Steam review totals in one request per batch, marks every game read and leaves the missing ones' totals alone", async () => {
    const { prisma } = await import("@/lib/db");
    const { enrichReviews } = await import("./enrich");
    // Above every seeded game, so they are the first of the queue.
    const ok = await prisma.game.create({
      data: { slug: `${SLUG}ok`, name: "Enrich Ok", steamAppId: APP + 1, achievementCount: 0, popularity: 2e9 },
    });
    const missing = await prisma.game.create({
      data: { slug: `${SLUG}missing`, name: "Enrich Missing", steamAppId: APP + 2, achievementCount: 0, popularity: 2e9 - 1 },
    });
    const asked: string[] = [];
    const politeFetch = async (url: string) => {
      asked.push(url);
      return new Response(
        JSON.stringify({
          response: {
            store_items: [{ appid: APP + 1, reviews: { summary_filtered: { review_count: 200, percent_positive: 80 } } }],
          },
        }),
      );
    };
    // One batch only: the clock passes the deadline after the first request.
    const now = () => (asked.length >= 1 ? Date.now() + 120_000 : Date.now());
    const result = await enrichReviews(Date.now() + 60_000, politeFetch, silent, now);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("IStoreBrowseService/GetItems");
    expect(decodeURIComponent(asked[0])).toContain(`"appid":${APP + 1}`);
    expect(result.done).toBe(1);
    const read = (id: string) =>
      prisma.game.findUniqueOrThrow({ where: { id }, select: { steamReviewPositive: true, steamReviewTotal: true, steamReviewsAt: true } });
    expect(await read(ok.id)).toMatchObject({ steamReviewPositive: 160, steamReviewTotal: 200 });
    const without = await read(missing.id);
    expect(without.steamReviewTotal).toBeNull();
    expect(without.steamReviewsAt).not.toBeNull();
  });

  it("reads again the next day a game whose last read brought nothing, not a week later", async () => {
    const { prisma } = await import("@/lib/db");
    const { enrichReviews } = await import("./enrich");
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000);
    const failed = await prisma.game.create({
      data: { slug: `${SLUG}retry`, name: "Enrich Retry", steamAppId: APP + 4, achievementCount: 0, popularity: 1, steamReviewsAt: twoDaysAgo },
    });
    const fresh = await prisma.game.create({
      data: {
        slug: `${SLUG}fresh`,
        name: "Enrich Fresh",
        steamAppId: APP + 5,
        achievementCount: 0,
        popularity: 1,
        steamReviewsAt: twoDaysAgo,
        steamReviewTotal: 10,
        steamReviewPositive: 9,
      },
    });
    const asked: number[] = [];
    const politeFetch = async (url: string) => {
      const ids = [...decodeURIComponent(url).matchAll(/"appid":(\d+)/g)].map((m) => Number(m[1]));
      asked.push(...ids);
      return new Response(JSON.stringify({ response: { store_items: [] } }));
    };
    await enrichReviews(Date.now() + 60_000, politeFetch, silent);
    expect(asked).toContain(APP + 4);
    expect(asked).not.toContain(APP + 5);
    expect((await prisma.game.findUniqueOrThrow({ where: { id: failed.id } })).steamReviewsAt!.getTime()).toBeGreaterThan(twoDaysAgo.getTime());
    expect((await prisma.game.findUniqueOrThrow({ where: { id: fresh.id } })).steamReviewTotal).toBe(10);
  });

  it("marks nothing when Steam does not answer: the games stay first in the queue", async () => {
    const { prisma } = await import("@/lib/db");
    const { enrichReviews } = await import("./enrich");
    const game = await prisma.game.create({
      data: { slug: `${SLUG}down`, name: "Enrich Down", steamAppId: APP + 3, achievementCount: 0, popularity: 2_100_000_000 },
    });
    const result = await enrichReviews(Date.now() + 60_000, async () => new Response("down", { status: 503 }), silent);
    expect(result).toEqual({ done: 0, failed: 0 });
    expect((await prisma.game.findUniqueOrThrow({ where: { id: game.id } })).steamReviewsAt).toBeNull();
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

  it("a lost database connection repeats the batch instead of counting the game as failed", async () => {
    const { prisma } = await import("@/lib/db");
    const { mediaQueue } = await import("./media");
    const { enrichMedia } = await import("./enrich");
    const { createDbRetry } = await import("@/lib/worker/db-retry");
    const game = await prisma.game.create({
      data: { slug: `${SLUG}media-lost`, name: "Enrich Media Lost", achievementCount: 0, popularity: 2e9 + 1 },
    });
    let lookups = 0;
    const lost = Object.assign(new Error("Server has closed the connection."), { name: "PrismaClientKnownRequestError", code: "P1017" });
    const deps = {
      igdb: {
        findBySteamAppId: async () => null,
        findByName: async () => {
          if (lookups++ === 0) throw lost;
          return null;
        },
        getMedia: async () => ({ videos: [], screenshots: [], artworks: [] }),
      },
      sgdb: { getArt: async () => null },
    } as unknown as Parameters<typeof enrichMedia>[2];
    const sleeps: number[] = [];
    const withDb = createDbRetry({ log: { info: () => {}, warn: () => {} }, sleep: async (ms) => void sleeps.push(ms) });
    // Two passes over the test game (the lost one and the retry), then the clock runs out.
    let calls = 0;
    const now = () => (calls++ > 8 ? Date.now() + 120_000 : Date.now());
    const result = await enrichMedia(Date.now() + 60_000, silent, deps, now, withDb);
    expect(sleeps).toEqual([5_000]);
    expect(result.failed).toBe(0);
    expect(await prisma.game.count({ where: { id: game.id, ...mediaQueue(new Date()) } })).toBe(0);
  });
});

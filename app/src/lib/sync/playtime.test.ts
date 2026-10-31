import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";

// Needs Postgres up and seeded (see db.test.ts); skipped when unreachable.
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

const HANDLE_PREFIX = "test_playtime_cap_";
const APP_BASE = 95_000_000;
const DAY = 86_400_000;

describe.skipIf(!reachable)("settlePlaytime (hours XP caps)", () => {
  let counter = 0;

  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.user.deleteMany({ where: { handle: { startsWith: HANDLE_PREFIX } } });
    await prisma.game.deleteMany({ where: { steamAppId: { gte: APP_BASE, lt: APP_BASE + 1000 } } });
  }
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  /** A user owning `count` Steam games with `minutes` each. */
  async function userWithGames(count: number, minutes: number) {
    const { prisma } = await import("@/lib/db");
    const { ensureSteamGames } = await import("./steam-games");
    counter++;
    const user = await prisma.user.create({ data: { handle: `${HANDLE_PREFIX}${counter}`, displayName: "Teste" } });
    const apps = Array.from({ length: count }, (_, i) => ({ appId: APP_BASE + counter * 100 + i, name: `Cap ${counter}-${i}` }));
    const ids = await ensureSteamGames(apps);
    const gameIds = apps.map((a) => ids.get(a.appId)!);
    await prisma.userGame.createMany({
      data: gameIds.map((gameId, i) => ({ userId: user.id, gameId, platform: "steam", playtimeMin: minutes + i, unlockedCount: 0 })),
    });
    return { user, gameIds };
  }

  async function settle(userId: string, now: Date, platform: "steam" | "psn" = "steam") {
    const { prisma } = await import("@/lib/db");
    const { settlePlaytime } = await import("./playtime");
    return prisma.$transaction((tx) => settlePlaytime(tx, userId, platform, now));
  }

  async function payingGames(userId: string) {
    const { prisma } = await import("@/lib/db");
    const rows = await prisma.xpLedgerEntry.findMany({ where: { userId, source: "playtime" }, select: { sourceKey: true } });
    return new Set(rows.map((r) => r.sourceKey.split(":")[1]));
  }

  it("nothing below 5 h; 5 h pays its full value once", async () => {
    const { prisma } = await import("@/lib/db");
    const { playtimeXp } = await import("@/lib/engine/playtime");
    const { user, gameIds } = await userWithGames(1, 299);
    const now = new Date("2026-11-01T12:00:00Z");
    expect(await settle(user.id, now)).toEqual({ paid: [], capped: [] });
    await prisma.userGame.updateMany({ where: { userId: user.id }, data: { playtimeMin: 300 } });
    expect(await settle(user.id, now)).toEqual({ paid: [`steam:${gameIds[0]}`], capped: [] });
    const entries = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id } });
    expect(entries).toMatchObject([{ sourceKey: `steam:${gameIds[0]}:5`, xp: playtimeXp(300), platform: null, createdAt: now }]);
    // Settled: offered again only when a new milestone is reached.
    expect(await settle(user.id, now)).toEqual({ paid: [], capped: [] });
  });

  it("at most 10 games start paying per UTC day; the rest pay on a later day, most played first", async () => {
    const { prisma } = await import("@/lib/db");
    const { user, gameIds } = await userWithGames(13, 600);
    const day1 = new Date("2026-11-01T23:00:00Z");
    const first = await settle(user.id, day1);
    expect(first.paid).toHaveLength(10);
    expect(first.capped).toHaveLength(3);
    // The 10 most played (playtime 600 + i) won.
    expect([...(await payingGames(user.id))].sort()).toEqual(gameIds.slice(3).sort());

    // Same UTC day: still capped, but games already paying keep paying new milestones.
    await prisma.userGame.updateMany({ where: { userId: user.id, gameId: gameIds[12] }, data: { playtimeMin: 25 * 60 } });
    const again = await settle(user.id, new Date("2026-11-01T23:30:00Z"));
    expect(again).toEqual({ paid: [`steam:${gameIds[12]}`], capped: gameIds.slice(0, 3).map((id) => `steam:${id}`).reverse() });

    // Next UTC day: the held-back games pay.
    const day2 = await settle(user.id, new Date(day1.getTime() + 2 * 60 * 60_000));
    expect(day2.paid).toHaveLength(3);
    expect((await payingGames(user.id)).size).toBe(13);
  });

  it("at most 150 games ever pay; games already paying keep paying, on any platform", async () => {
    const { prisma } = await import("@/lib/db");
    const { user, gameIds } = await userWithGames(2, 600);
    const [paying, extra] = gameIds;
    const longAgo = new Date(Date.now() - 400 * DAY);
    // History: 149 other games already paid, plus `paying`.
    await prisma.xpLedgerEntry.createMany({
      data: [
        ...Array.from({ length: 149 }, (_, i) => ({ userId: user.id, source: "playtime", sourceKey: `steam:old${i}:5`, xp: 1, skills: [], createdAt: longAgo })),
        { userId: user.id, source: "playtime", sourceKey: `steam:${paying}:5`, xp: 1, skills: [], createdAt: longAgo },
      ],
    });
    await prisma.userGame.updateMany({ where: { userId: user.id, gameId: paying }, data: { playtimePaidMin: 300 } });
    const result = await settle(user.id, new Date());
    expect(result).toEqual({ paid: [`steam:${paying}`], capped: [`steam:${extra}`] });
    // The same game on another platform is the same game: it keeps paying there too.
    await prisma.userGame.create({ data: { userId: user.id, gameId: paying, platform: "psn", playtimeMin: 400, unlockedCount: 0 } });
    expect(await settle(user.id, new Date(), "psn")).toEqual({ paid: [`psn:${paying}`], capped: [] });
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, sourceKey: { startsWith: `steam:${extra}:` } } })).toBe(0);
  });

  it("a voided milestone (unlinked account) neither pays again nor counts as a start", async () => {
    const { prisma } = await import("@/lib/db");
    const { user, gameIds } = await userWithGames(1, 600);
    const now = new Date("2026-11-03T10:00:00Z");
    await prisma.xpLedgerEntry.createMany({
      data: [5, 10].map((h) => ({
        userId: user.id,
        source: "playtime",
        sourceKey: `steam:${gameIds[0]}:${h}`,
        xp: 1,
        skills: [],
        voidedAt: now,
      })),
    });
    expect(await settle(user.id, now)).toEqual({ paid: [], capped: [] });
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, voidedAt: null } })).toBe(0);
  });
});

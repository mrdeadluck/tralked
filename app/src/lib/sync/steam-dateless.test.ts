import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { platinumBonus, xpForAchievement } from "@/lib/engine/xp";
import { env } from "@/lib/env";
import type { SteamApi } from "@/lib/integrations";
import type { SteamPlayerAchievement } from "@/lib/integrations/steam/types";

// Needs Postgres up (test database only, vitest.db-guard.ts); skipped when unreachable.
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

vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidateTag: vi.fn(),
}));

/** appId -> what GetPlayerAchievements answers; `asked` records every call. */
const steamState = vi.hoisted(() => ({
  answers: new Map<number, SteamPlayerAchievement[] | "private">(),
  /** appId -> HTTP statuses Steam answers first, one per call ("always": every call). */
  failures: new Map<number, number[] | "always">(),
  asked: [] as number[],
}));
vi.mock("@/lib/integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations")>();
  const api: Partial<SteamApi> = {
    async getPlayerAchievements(_steamId, appId) {
      steamState.asked.push(appId);
      const failures = steamState.failures.get(appId);
      const status = failures === "always" ? 500 : failures?.shift();
      if (status) throw new Error(`Steam API /ISteamUserStats/GetPlayerAchievements/v1/ failed with HTTP ${status}`);
      return steamState.answers.get(appId) ?? [];
    },
    async getSchemaForGame() {
      return [];
    },
    async getGlobalAchievementPercentages() {
      return {};
    },
    async getOwnedGames(_steamId, options) {
      return [{ appId: options?.appId ?? 0, playtimeMin: 600 }];
    },
  };
  return {
    ...actual,
    getSteam: () => api as SteamApi,
    getIgdb: () => ({ findBySteamAppId: async () => null }),
    getRawg: () => ({ findBySteamAppId: async () => null }),
    getSgdb: () => ({ getArt: async () => ({}) }),
  };
});

const PREFIX = "test-dateless-";
const APP = { gap: 96100001, even: 96100002, done: 96100003, finish: 96100004, flaky: 96100005, broken: 96100006 };
const NO_WAIT = { retryDelaysMs: [1, 1, 1], sleep: async () => {} };
const DATED = new Date("2015-05-05T10:00:00Z");
const got = (apiName: string, unlockedAt: Date | null = null): SteamPlayerAchievement => ({ apiName, achieved: true, unlockedAt });
const locked = (apiName: string): SteamPlayerAchievement => ({ apiName, achieved: false, unlockedAt: null });

describe.skipIf(!reachable)("steam:dateless", () => {
  let userId: string;

  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
    await prisma.game.deleteMany({ where: { steamAppId: { in: Object.values(APP) } } });
  }

  /** A Steam game with achievements A0..A(n-1) at `pct`, and the user's dated unlocks of the first `have`. */
  async function game(appId: number, n: number, have: number, pct = 10, timeToBeatCompleteMin: number | null = null) {
    const { prisma } = await import("@/lib/db");
    const row = await prisma.game.create({
      data: {
        slug: `${PREFIX}${appId}`,
        name: `Dateless ${appId}`,
        steamAppId: appId,
        achievementCount: n,
        platforms: ["PC"],
        timeToBeatCompleteMin,
      },
    });
    const { createAchievements } = await import("@/lib/trophies/test-lists");
    const achievements = await createAchievements(
      row.id,
      Array.from({ length: n }, (_, i) => ({ apiName: `A${i}`, name: `A${i}`, globalPct: pct })),
    );
    const mine = achievements.slice(0, have);
    await prisma.userGame.create({
      data: {
        userId,
        gameId: row.id,
        platform: "steam",
        playtimeMin: 600,
        unlockedCount: have,
        completedAt: have === n ? DATED : null,
      },
    });
    await prisma.userAchievement.createMany({ data: mine.map((a) => ({ userId, achievementId: a.id, unlockedAt: DATED })) });
    await prisma.xpLedgerEntry.createMany({
      data: mine.map((a) => ({ userId, source: "achievement", sourceKey: a.id, xp: xpForAchievement(pct), skills: [], createdAt: DATED })),
    });
    return row;
  }

  beforeAll(async () => {
    const { prisma } = await import("@/lib/db");
    const { recomputeUser } = await import("@/lib/progression/recompute");
    await cleanup();
    const user = await prisma.user.create({
      data: { handle: `${PREFIX}diguzz`, displayName: "diguzz", steamId: `${PREFIX}765` },
    });
    userId = user.id;
    // Team Fortress 2 before the fix: Tralked has the dated one, Steam has two more without a date.
    await game(APP.gap, 4, 1);
    steamState.answers.set(APP.gap, [got("A0", DATED), got("A1"), got("A2"), locked("A3")]);
    // Same count on both sides: nothing to re-read.
    await game(APP.even, 2, 1);
    steamState.answers.set(APP.even, [got("A0", DATED), locked("A1")]);
    // Complete already: Steam is not even asked.
    await game(APP.done, 1, 1);
    // The undated one completes it: the platinum comes too. 600 min against a 100 000 min game
    // would be a speed platinum, but a completion with undated unlocks is exempt.
    await game(APP.finish, 2, 1, 20, 100_000);
    steamState.answers.set(APP.finish, [got("A0", DATED), got("A1")]);
    // Steam rate-limits twice, then answers: a dated unlock Tralked never read.
    await game(APP.flaky, 2, 0);
    steamState.answers.set(APP.flaky, [got("A0", DATED), locked("A1")]);
    steamState.failures.set(APP.flaky, [429, 503]);
    // Steam keeps failing: listed as not read, the rest of the plan stands.
    await game(APP.broken, 2, 0);
    steamState.failures.set(APP.broken, "always");
    await recomputeUser(userId);
  });

  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("plans only the games where Steam has more earned achievements, with the XP before and after", async () => {
    const { prisma } = await import("@/lib/db");
    const { planDateless } = await import("./steam-dateless");
    steamState.asked = [];
    const xpBefore = (await prisma.userStats.findUniqueOrThrow({ where: { userId } })).totalXp;

    const plan = await planDateless(userId, NO_WAIT);

    // Every incomplete game is asked once; the flaky one 3 times (2 retries), the broken one 4.
    const count = (appId: number) => steamState.asked.filter((a) => a === appId).length;
    expect([APP.gap, APP.even, APP.done, APP.finish, APP.flaky, APP.broken].map(count)).toEqual([1, 1, 0, 1, 3, 4]);
    expect(plan.status).toBe("ok");
    const bonus = platinumBonus([xpForAchievement(20), xpForAchievement(20)]);
    expect(
      plan.games.map((g) => ({
        appId: g.appId,
        steam: g.steamEarned,
        tralked: g.tralkedEarned,
        missing: g.missing,
        undated: g.undated,
        completes: g.completes,
        bonus: g.platinumBonus,
      })),
    ).toEqual([
      { appId: APP.gap, steam: 3, tralked: 1, missing: 2, undated: 2, completes: false, bonus: 0 },
      { appId: APP.finish, steam: 2, tralked: 1, missing: 1, undated: 1, completes: true, bonus },
      { appId: APP.flaky, steam: 1, tralked: 0, missing: 1, undated: 0, completes: false, bonus: 0 },
    ]);
    expect(plan.notRead).toEqual([{ appId: APP.broken, name: `Dateless ${APP.broken}`, error: expect.stringContaining("HTTP 500") }]);
    expect(plan.xpBefore).toBe(xpBefore);
    expect(plan.xpAfter).toBe(xpBefore + 3 * xpForAchievement(10) + xpForAchievement(20) + bonus);
    // Planning writes nothing.
    expect(await prisma.userAchievement.count({ where: { userId } })).toBe(4);
  });

  it("records what is missing and recomputes; a second run finds nothing", async () => {
    const { prisma } = await import("@/lib/db");
    const { applyDateless, planDateless } = await import("./steam-dateless");
    const plan = await planDateless(userId, NO_WAIT);

    const result = await applyDateless(userId, plan);

    expect(result).toEqual({ recorded: 4, failed: [], xpAfter: plan.xpAfter });
    // The completion through an undated unlock was not taken for a speed platinum.
    expect(await prisma.userAchievement.count({ where: { userId, suspicious: true } })).toBe(0);
    expect((await prisma.userStats.findUniqueOrThrow({ where: { userId } })).totalXp).toBe(plan.xpAfter);
    const undated = await prisma.userAchievement.findMany({ where: { userId, unlockedAt: null } });
    expect(undated).toHaveLength(3);
    const entries = await prisma.xpLedgerEntry.findMany({ where: { userId, dateUnknown: true } });
    expect(entries.map((e) => e.source).sort()).toEqual(["achievement", "achievement", "achievement", "platinum"]);
    expect((await planDateless(userId, NO_WAIT)).games).toEqual([]);
  });

  it("a private profile is reported, not read further", async () => {
    const { planDateless } = await import("./steam-dateless");
    steamState.answers.set(APP.even, "private");
    expect((await planDateless(userId, NO_WAIT)).status).toBe("private");
    steamState.answers.set(APP.even, [got("A0", DATED), locked("A1")]);
  });
});

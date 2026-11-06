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
  asked: [] as number[],
}));
vi.mock("@/lib/integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations")>();
  const api: Partial<SteamApi> = {
    async getPlayerAchievements(_steamId, appId) {
      steamState.asked.push(appId);
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
const APP = { gap: 96100001, even: 96100002, done: 96100003, finish: 96100004 };
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
  async function game(appId: number, n: number, have: number, pct = 10) {
    const { prisma } = await import("@/lib/db");
    const row = await prisma.game.create({
      data: {
        slug: `${PREFIX}${appId}`,
        name: `Dateless ${appId}`,
        steamAppId: appId,
        achievementCount: n,
        platforms: ["PC"],
        achievements: { create: Array.from({ length: n }, (_, i) => ({ apiName: `A${i}`, name: `A${i}`, globalPct: pct })) },
      },
      include: { achievements: { orderBy: { apiName: "asc" } } },
    });
    const mine = row.achievements.slice(0, have);
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
    // The undated ones complete it: the platinum comes too.
    await game(APP.finish, 2, 1, 20);
    steamState.answers.set(APP.finish, [got("A0", DATED), got("A1")]);
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

    const plan = await planDateless(userId);

    expect(steamState.asked.sort()).toEqual([APP.gap, APP.even, APP.finish].sort());
    expect(plan.status).toBe("ok");
    expect(plan.games.map((g) => ({ appId: g.appId, steam: g.steamEarned, tralked: g.tralkedEarned, missing: g.missing, undated: g.undated }))).toEqual([
      { appId: APP.finish, steam: 2, tralked: 1, missing: 1, undated: 1 },
      { appId: APP.gap, steam: 3, tralked: 1, missing: 2, undated: 2 },
    ].sort((a, b) => a.appId - b.appId));
    const finishXp = xpForAchievement(20) + platinumBonus([xpForAchievement(20), xpForAchievement(20)]);
    expect(plan.xpBefore).toBe(xpBefore);
    expect(plan.xpAfter).toBe(xpBefore + 2 * xpForAchievement(10) + finishXp);
    // Planning writes nothing.
    expect(await prisma.userAchievement.count({ where: { userId } })).toBe(4);
  });

  it("records what is missing and recomputes; a second run finds nothing", async () => {
    const { prisma } = await import("@/lib/db");
    const { applyDateless, planDateless } = await import("./steam-dateless");
    const plan = await planDateless(userId);

    const result = await applyDateless(userId, plan);

    expect(result).toEqual({ recorded: 3, failed: [], xpAfter: plan.xpAfter });
    expect((await prisma.userStats.findUniqueOrThrow({ where: { userId } })).totalXp).toBe(plan.xpAfter);
    const undated = await prisma.userAchievement.findMany({ where: { userId, unlockedAt: null } });
    expect(undated).toHaveLength(3);
    const entries = await prisma.xpLedgerEntry.findMany({ where: { userId, dateUnknown: true } });
    expect(entries.map((e) => e.source).sort()).toEqual(["achievement", "achievement", "achievement", "platinum"]);
    expect((await planDateless(userId)).games).toEqual([]);
  });

  it("a private profile is reported, not read further", async () => {
    const { planDateless } = await import("./steam-dateless");
    steamState.answers.set(APP.even, "private");
    expect((await planDateless(userId)).status).toBe("private");
    steamState.answers.set(APP.even, [got("A0", DATED), locked("A1")]);
  });
});

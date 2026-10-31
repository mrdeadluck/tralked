import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { platinumBonus, xpForAchievement } from "@/lib/engine/xp";
import { env } from "@/lib/env";
import type { SteamApi } from "@/lib/integrations";

// Needs Postgres up and seeded (see db.test.ts); skipped when unreachable.
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

// The pipeline talks to Steam through getSteam(); the other sources return nothing so
// that games are created from Steam data alone.
const steamState = vi.hoisted(() => ({ api: null as unknown as SteamApi }));
vi.mock("@/lib/integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations")>();
  return {
    ...actual,
    getSteam: () => steamState.api,
    getIgdb: () => ({ findBySteamAppId: async () => null }),
    getRawg: () => ({ findBySteamAppId: async () => null }),
    getSgdb: () => ({ getArt: async () => ({}) }),
  };
});

const STEAM_PREFIX = "test-sync-";
const APP_BASE = 98000000;
const DAY = 86_400_000;

type FakeGame = {
  /** apiName -> global percentage */
  pcts: Record<string, number>;
  /** apiName -> unlock time (null/absent = locked) */
  unlocks: Record<string, Date | null>;
  playtimeMin?: number;
};

type FakeSteam = {
  api: SteamApi;
  games: Map<number, FakeGame>;
  profilePublic: boolean;
  /** Public profile with "Game details" private: GetOwnedGames answers `{"response":{}}`. */
  ownedPrivate: boolean;
  privateGames: Set<number>;
};

function fakeSteam(games: Record<number, FakeGame>): FakeSteam {
  const state: FakeSteam = {
    games: new Map(Object.entries(games).map(([id, g]) => [Number(id), g])),
    profilePublic: true,
    ownedPrivate: false,
    privateGames: new Set(),
    api: undefined as unknown as SteamApi,
  };
  state.api = {
    async getPlayerSummary(steamId) {
      return { steamId, personaName: "Test", avatarUrl: "", profilePublic: state.profilePublic };
    },
    async getOwnedGames() {
      if (state.ownedPrivate) return "private";
      return [...state.games.entries()].map(([appId, g]) => ({
        appId,
        playtimeMin: g.playtimeMin ?? 600,
      }));
    },
    async getSchemaForGame(appId) {
      const g = state.games.get(appId);
      return Object.keys(g?.pcts ?? {}).map((apiName) => ({
        apiName,
        name: apiName,
        hidden: false,
      }));
    },
    async getGlobalAchievementPercentages(appId) {
      return { ...(state.games.get(appId)?.pcts ?? {}) };
    },
    async getPlayerAchievements(_steamId, appId) {
      if (state.privateGames.has(appId)) return "private";
      const g = state.games.get(appId);
      if (!g) return [];
      return Object.keys(g.pcts).map((apiName) => ({
        apiName,
        unlockedAt: g.unlocks[apiName] ?? null,
      }));
    },
  };
  return state;
}

/** `{ A0: 10, A1: 10, ... }` with `count` achievements at the given rarity. */
const pctsOf = (count: number, pct = 10) =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [`A${i}`, pct]));

describe.skipIf(!reachable)("syncUser", () => {
  let counter = 0;
  let appIdCounter = 0;
  const newAppId = () => APP_BASE + ++appIdCounter;

  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.user.deleteMany({ where: { steamId: { startsWith: STEAM_PREFIX } } });
    await prisma.game.deleteMany({
      where: { steamAppId: { gte: APP_BASE, lt: APP_BASE + 1000 } },
    });
  }

  async function newUser() {
    const { prisma } = await import("@/lib/db");
    counter++;
    return prisma.user.create({
      data: {
        steamId: `${STEAM_PREFIX}${counter}`,
        handle: `test_sync_${counter}`,
        displayName: "Test sync",
        profilePublic: true,
      },
    });
  }

  async function totalXp(userId: string) {
    const { prisma } = await import("@/lib/db");
    const sum = await prisma.xpLedgerEntry.aggregate({ where: { userId }, _sum: { xp: true } });
    return sum._sum.xp ?? 0;
  }

  beforeAll(cleanup);
  beforeEach(() => {
    steamState.api = fakeSteam({}).api;
  });
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("imports history: creates the game on demand, keeps Steam unlock times and grants XP", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    const base = new Date("2023-03-01T12:00:00Z");
    const steam = fakeSteam({
      [appId]: {
        pcts: pctsOf(6, 10),
        unlocks: Object.fromEntries(
          [0, 1, 2, 3, 4].map((i) => [`A${i}`, new Date(base.getTime() + i * DAY)]),
        ),
      },
    });
    steamState.api = steam.api;
    const user = await newUser();

    const result = await syncUser(user.id);

    expect(result).toMatchObject({ status: "ok", newUnlocks: 5, levelBefore: 1 });
    expect(result.levelAfter).toBeGreaterThanOrEqual(1);
    const game = await prisma.game.findUniqueOrThrow({
      where: { steamAppId: appId },
      include: { achievements: true },
    });
    expect(game.achievements).toHaveLength(6);
    expect(game.achievementCount).toBe(6);

    const unlocks = await prisma.userAchievement.findMany({
      where: { userId: user.id },
      include: { achievement: true },
    });
    expect(unlocks).toHaveLength(5);
    for (const u of unlocks) {
      const i = Number(u.achievement.apiName.slice(1));
      expect(u.unlockedAt).toEqual(new Date(base.getTime() + i * DAY));
      expect(u.suspicious).toBe(false);
    }

    const ledger = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id } });
    expect(ledger.filter((e) => e.source === "achievement")).toHaveLength(5);
    expect(await totalXp(user.id)).toBeGreaterThanOrEqual(5 * xpForAchievement(10));
    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stats.totalXp).toBe(await totalXp(user.id));
    const userGame = await prisma.userGame.findUniqueOrThrow({
      where: { userId_gameId_platform: { userId: user.id, gameId: game.id, platform: "steam" } },
    });
    expect(userGame).toMatchObject({ unlockedCount: 5, completedAt: null, playtimeMin: 600 });
    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(refreshed.lastSyncedAt).not.toBeNull();
  });

  it("running twice does not change totalXp or the ledger", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    steamState.api = fakeSteam({
      [appId]: {
        pcts: pctsOf(4, 5),
        unlocks: { A0: new Date("2024-01-01T10:00:00Z"), A1: new Date("2024-02-01T10:00:00Z") },
      },
    }).api;
    const user = await newUser();

    await syncUser(user.id);
    const first = { xp: await totalXp(user.id), count: await prisma.xpLedgerEntry.count({ where: { userId: user.id } }) };
    const second = await syncUser(user.id);

    expect(second.newUnlocks).toBe(0);
    expect(await totalXp(user.id)).toBe(first.xp);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id } })).toBe(first.count);
    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stats.totalXp).toBe(first.xp);
  });

  it("freezes XP at the rarity of the moment it was recorded", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    const steam = fakeSteam({
      [appId]: { pcts: pctsOf(3, 40), unlocks: { A0: new Date("2024-01-01T10:00:00Z") } },
    });
    steamState.api = steam.api;
    const user = await newUser();

    await syncUser(user.id);
    const before = await totalXp(user.id);
    expect(before).toBe(xpForAchievement(40));

    // The achievement became legendary, and the player unlocks another one.
    steam.games.get(appId)!.pcts = { A0: 1, A1: 40, A2: 40 };
    steam.games.get(appId)!.unlocks.A1 = new Date("2024-03-01T10:00:00Z");
    await prisma.achievement.updateMany({ where: { game: { steamAppId: appId }, apiName: "A0" }, data: { globalPct: 1 } });
    const result = await syncUser(user.id);

    expect(result.newUnlocks).toBe(1);
    expect(await totalXp(user.id)).toBe(before + xpForAchievement(40));
  });

  it("flags 10 unlocks within 30 seconds as suspicious and keeps them out of the ledger", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    const burstAt = new Date("2024-05-05T20:00:00Z");
    const unlocks: Record<string, Date> = {};
    for (let i = 0; i < 10; i++) unlocks[`A${i}`] = new Date(burstAt.getTime() + i * 3000);
    unlocks.A10 = new Date("2024-05-01T20:00:00Z"); // a legitimate unlock days earlier
    steamState.api = fakeSteam({ [appId]: { pcts: pctsOf(12, 10), unlocks } }).api;
    const user = await newUser();

    const result = await syncUser(user.id);

    expect(result.newUnlocks).toBe(11);
    const rows = await prisma.userAchievement.findMany({
      where: { userId: user.id },
      include: { achievement: true },
    });
    const suspicious = rows.filter((r) => r.suspicious).map((r) => r.achievement.apiName).sort();
    expect(suspicious).toEqual(Array.from({ length: 10 }, (_, i) => `A${i}`).sort());
    const ledger = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].xp).toBe(xpForAchievement(10));
  });

  it("returns { status: 'private' } without throwing for private profiles", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    const steam = fakeSteam({
      [appId]: { pcts: pctsOf(2), unlocks: { A0: new Date("2024-01-01T10:00:00Z") } },
    });
    steamState.api = steam.api;

    const privateProfile = await newUser();
    steam.profilePublic = false;
    expect(await syncUser(privateProfile.id)).toMatchObject({ status: "private", newUnlocks: 0 });

    const privateDetails = await newUser();
    steam.profilePublic = true;
    steam.privateGames.add(appId);
    expect(await syncUser(privateDetails.id)).toMatchObject({ status: "private", newUnlocks: 0 });

    expect(await prisma.xpLedgerEntry.count({ where: { userId: { in: [privateProfile.id, privateDetails.id] } } })).toBe(0);
    expect(await prisma.userAchievement.count({ where: { userId: { in: [privateProfile.id, privateDetails.id] } } })).toBe(0);
  });

  it("grants exactly one platinum entry when every achievement is unlocked", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    const pcts = { A0: 2, A1: 15, A2: 70 };
    steamState.api = fakeSteam({
      [appId]: {
        pcts,
        unlocks: {
          A0: new Date("2024-01-01T10:00:00Z"),
          A1: new Date("2024-01-05T10:00:00Z"),
          A2: new Date("2024-01-09T10:00:00Z"),
        },
      },
    }).api;
    const user = await newUser();

    await syncUser(user.id);
    await syncUser(user.id);

    const game = await prisma.game.findUniqueOrThrow({ where: { steamAppId: appId } });
    const platinum = await prisma.xpLedgerEntry.findMany({
      where: { userId: user.id, source: "platinum" },
    });
    expect(platinum).toHaveLength(1);
    expect(platinum[0].sourceKey).toBe(game.id);
    expect(platinum[0].xp).toBe(platinumBonus(Object.values(pcts).map(xpForAchievement)));
    const userGame = await prisma.userGame.findUniqueOrThrow({
      where: { userId_gameId_platform: { userId: user.id, gameId: game.id, platform: "steam" } },
    });
    expect(userGame.completedAt).toEqual(new Date("2024-01-09T10:00:00Z"));
    expect(userGame.unlockedCount).toBe(3);
  });

  it("treats a completion far faster than the IGDB time as suspicious (no XP, no platinum)", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    await prisma.game.create({
      data: {
        slug: `test-sync-speed-${appId}`,
        name: "Speed game",
        steamAppId: appId,
        achievementCount: 3,
        platforms: ["PC"],
        timeToBeatCompleteMin: 6000,
        achievements: {
          create: ["A0", "A1", "A2"].map((apiName) => ({ apiName, name: apiName, globalPct: 10 })),
        },
      },
    });
    steamState.api = fakeSteam({
      [appId]: {
        pcts: pctsOf(3),
        playtimeMin: 100, // < 5% of 6000
        unlocks: {
          A0: new Date("2024-01-01T10:00:00Z"),
          A1: new Date("2024-01-05T10:00:00Z"),
          A2: new Date("2024-01-09T10:00:00Z"),
        },
      },
    }).api;
    const user = await newUser();

    await syncUser(user.id);

    const rows = await prisma.userAchievement.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.suspicious)).toBe(true);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id } })).toBe(0);
  });

  it("skips games without achievements and does not catalog them", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const withAch = newAppId();
    const without = newAppId();
    steamState.api = fakeSteam({
      [withAch]: { pcts: pctsOf(2), unlocks: { A0: new Date("2024-01-01T10:00:00Z") } },
      [without]: { pcts: {}, unlocks: {} },
    }).api;
    const user = await newUser();

    const result = await syncUser(user.id);

    expect(result.newUnlocks).toBe(1);
    expect(await prisma.game.count({ where: { steamAppId: without } })).toBe(0);
    expect(await prisma.game.count({ where: { steamAppId: withAch } })).toBe(1);
  });

  it("reports skill-ups for the skills of the game", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    await prisma.game.create({
      data: {
        slug: `test-sync-rpg-${appId}`,
        name: "RPG game",
        steamAppId: appId,
        achievementCount: 5,
        platforms: ["PC"],
        skills: { create: [{ skill: "rpg" }] },
        achievements: {
          create: Array.from({ length: 5 }, (_, i) => ({ apiName: `A${i}`, name: `A${i}`, globalPct: 2 })),
        },
      },
    });
    steamState.api = fakeSteam({
      [appId]: {
        pcts: pctsOf(5, 2),
        unlocks: Object.fromEntries(
          [0, 1, 2].map((i) => [`A${i}`, new Date(`2024-01-0${i + 1}T10:00:00Z`)]),
        ),
      },
    }).api;
    const user = await newUser();

    const result = await syncUser(user.id);

    expect(result.skillUps).toContain("rpg");
    const rpg = await prisma.skillProgress.findUniqueOrThrow({
      where: { userId_skill: { userId: user.id, skill: "rpg" } },
    });
    expect(rpg.level).toBeGreaterThan(1);
    const again = await syncUser(user.id);
    expect(again.skillUps).toEqual([]);
  });

  it("derives skill points from the game's current skills, so unlocks recorded without skills catch up", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const { recomputeUser } = await import("@/lib/progression/recompute");
    const appId = newAppId();
    steamState.api = fakeSteam({
      [appId]: {
        pcts: pctsOf(2, 2),
        unlocks: { A0: new Date("2024-01-01T10:00:00Z"), A1: new Date("2024-01-04T10:00:00Z") },
      },
    }).api;
    const user = await newUser();

    // IGDB found nothing: the game is created without skills, so the unlocks earn XP only.
    await syncUser(user.id);
    const game = await prisma.game.findUniqueOrThrow({ where: { steamAppId: appId }, include: { skills: true } });
    expect(game.skills).toHaveLength(0);
    const statsBefore = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    const rpgBefore = await prisma.skillProgress.findUniqueOrThrow({
      where: { userId_skill: { userId: user.id, skill: "rpg" } },
    });
    expect(rpgBefore).toMatchObject({ level: 1, points: 0 });
    const ledger = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id } });
    expect(ledger.map((e) => e.source).sort()).toEqual(["achievement", "achievement", "platinum"]);

    // Later the catalog (or an admin override) gives the game its skills.
    await prisma.gameSkill.create({ data: { gameId: game.id, skill: "rpg" } });
    await recomputeUser(user.id);

    const rpgAfter = await prisma.skillProgress.findUniqueOrThrow({
      where: { userId_skill: { userId: user.id, skill: "rpg" } },
    });
    expect(rpgAfter.level > 1 || rpgAfter.points > 0).toBe(true);
    const statsAfter = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    expect(statsAfter.totalXp).toBe(statsBefore.totalXp);
    expect(await totalXp(user.id)).toBe(statsBefore.totalXp);
  });

  it("keeps XP correct when two syncs of the same user run at once", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    steamState.api = fakeSteam({
      [appId]: {
        pcts: pctsOf(6, 8),
        unlocks: Object.fromEntries(
          [0, 1, 2, 3, 4, 5].map((i) => [`A${i}`, new Date(`2024-02-0${i + 1}T10:00:00Z`)]),
        ),
      },
    }).api;
    const user = await newUser();

    await Promise.all([syncUser(user.id), syncUser(user.id)]);

    const ledger = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id } });
    expect(ledger.filter((e) => e.source === "achievement")).toHaveLength(6);
    expect(ledger.filter((e) => e.source === "platinum")).toHaveLength(1);
    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stats.totalXp).toBe(ledger.reduce((sum, e) => sum + e.xp, 0));
  });

  it("stores the private verdict and imports again when Steam turns public, keeping the user's visibility", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncStaleUsers } = await import("./user");
    const appId = newAppId();
    const steam = fakeSteam({
      [appId]: { pcts: pctsOf(3), unlocks: { A0: new Date("2024-01-01T10:00:00Z") } },
    });
    steamState.api = steam.api;
    const user = await newUser();
    await prisma.user.update({ where: { id: user.id }, data: { profilePublic: false } });
    const only = { id: user.id };

    steam.profilePublic = false;
    expect(await syncStaleUsers(10, only)).toEqual({ processed: 1, failed: 0 });
    let row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ profilePublic: false, lastSyncedAt: null });
    expect(row.lastSyncAttemptAt).not.toBeNull();

    steam.profilePublic = true;
    expect(await syncStaleUsers(10, only)).toEqual({ processed: 1, failed: 0 });
    row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // Tralked visibility is the user's choice (/conta): a public Steam profile never flips it on.
    expect(row.profilePublic).toBe(false);
    expect(row.lastSyncedAt).not.toBeNull();
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id } })).toBe(1);
  });

  it("marks a public profile with private game details as private", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    const steam = fakeSteam({ [appId]: { pcts: pctsOf(2), unlocks: {} } });
    steam.privateGames.add(appId);
    steamState.api = steam.api;
    const user = await newUser(); // created public

    expect((await syncUser(user.id)).status).toBe("private");

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.profilePublic).toBe(false);
    expect(row.lastSyncedAt).toBeNull();
  });

  it("marks the user private when Steam hides the owned games list (game details private)", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    const steam = fakeSteam({
      [appId]: { pcts: pctsOf(2), unlocks: { A0: new Date("2024-01-01T10:00:00Z") } },
    });
    steam.ownedPrivate = true;
    steamState.api = steam.api;
    const user = await newUser(); // created public

    expect(await syncUser(user.id)).toMatchObject({ status: "private", newUnlocks: 0 });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.profilePublic).toBe(false);
    expect(row.lastSyncedAt).toBeNull();
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id } })).toBe(0);
  });

  it("imports every owned game when Steam hides playtime (all zero), without the speed-platinum flag", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const partial = newAppId();
    const complete = newAppId();
    // Known time to beat: with playtime 0 the speed-platinum rule would flag a real completion.
    await prisma.game.create({
      data: {
        slug: `test-sync-hidden-${complete}`,
        name: "Hidden playtime game",
        steamAppId: complete,
        achievementCount: 2,
        platforms: ["PC"],
        timeToBeatCompleteMin: 6000,
        achievements: {
          create: ["A0", "A1"].map((apiName) => ({ apiName, name: apiName, globalPct: 10 })),
        },
      },
    });
    steamState.api = fakeSteam({
      [partial]: { pcts: pctsOf(3), playtimeMin: 0, unlocks: { A0: new Date("2024-01-01T10:00:00Z") } },
      [complete]: {
        pcts: pctsOf(2),
        playtimeMin: 0,
        unlocks: { A0: new Date("2024-02-01T10:00:00Z"), A1: new Date("2024-02-09T10:00:00Z") },
      },
    }).api;
    const user = await newUser();

    const result = await syncUser(user.id);

    expect(result).toMatchObject({ status: "ok", newUnlocks: 3 });
    const rows = await prisma.userAchievement.findMany({ where: { userId: user.id } });
    expect(rows.every((r) => !r.suspicious)).toBe(true);
    const ledger = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id } });
    expect(ledger.filter((e) => e.source === "achievement")).toHaveLength(3);
    expect(ledger.filter((e) => e.source === "platinum")).toHaveLength(1);
  });

  it("still skips never-played games when at least one game reports playtime", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const played = newAppId();
    const unplayed = newAppId();
    steamState.api = fakeSteam({
      [played]: { pcts: pctsOf(2), playtimeMin: 300, unlocks: { A0: new Date("2024-01-01T10:00:00Z") } },
      [unplayed]: { pcts: pctsOf(2), playtimeMin: 0, unlocks: { A0: new Date("2024-01-02T10:00:00Z") } },
    }).api;
    const user = await newUser();

    expect(await syncUser(user.id)).toMatchObject({ status: "ok", newUnlocks: 1 });
    expect(await prisma.game.count({ where: { steamAppId: unplayed } })).toBe(0);
  });

  it("does not let a failing user starve the cron batch", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncStaleUsers } = await import("./user");
    const failing = await newUser();
    const healthy = await newUser();
    // Never attempted sorts first, so the failing user is picked first; the healthy one was attempted long ago.
    await prisma.user.update({
      where: { id: healthy.id },
      data: { lastSyncAttemptAt: new Date("2020-01-01T00:00:00Z") },
    });
    const base = fakeSteam({}).api;
    steamState.api = {
      ...base,
      getPlayerSummary: async (steamId) => {
        if (steamId === failing.steamId) throw new Error("Steam is down for this user");
        return base.getPlayerSummary(steamId);
      },
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const candidates = { id: { in: [failing.id, healthy.id] } };

    expect(await syncStaleUsers(1, candidates)).toEqual({ processed: 0, failed: 1 });
    expect(await syncStaleUsers(1, candidates)).toEqual({ processed: 1, failed: 0 });
    errors.mockRestore();

    const healthyRow = await prisma.user.findUniqueOrThrow({ where: { id: healthy.id } });
    const failingRow = await prisma.user.findUniqueOrThrow({ where: { id: failing.id } });
    expect(healthyRow.lastSyncedAt).not.toBeNull();
    expect(failingRow.lastSyncedAt).toBeNull();
    expect(failingRow.lastSyncAttemptAt).not.toBeNull();
  });
});

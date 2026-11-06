import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { platinumBonus, xpForAchievement } from "@/lib/engine/xp";
import { env } from "@/lib/env";
import type { SteamApi } from "@/lib/integrations";
import type { SteamWishlistItem } from "@/lib/integrations/steam/types";

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

// Cache invalidation is recorded (there is no Next.js cache in tests).
const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidateTag,
}));

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
/** Ledger filter leaving out the hours milestones (the fake library plays every game 10 h by default). */
const NOT_PLAYTIME = { source: { not: "playtime" } } as const;
const APP_BASE = 98000000;
const DAY = 86_400_000;

type FakeGame = {
  /** apiName -> global percentage */
  pcts: Record<string, number>;
  /** apiName -> unlock time (null/absent = locked; "undated": achieved, unlocktime 0) */
  unlocks: Record<string, Date | "undated" | null>;
  playtimeMin?: number;
  /** Library name (default `Jogo de Teste <appid>`; null: none). */
  name?: string | null;
  /** Steam's rtime_last_played (absent: Steam gives none, as for Phantom Blade Zero on 2026-11-03). */
  lastPlayedAt?: Date;
  /** Steam's playtime_2weeks (absent: 0). */
  playtime2WeeksMin?: number;
};

type FakeSteam = {
  api: SteamApi;
  games: Map<number, FakeGame>;
  profilePublic: boolean;
  /** Public profile with "Game details" private: GetOwnedGames answers `{"response":{}}`. */
  ownedPrivate: boolean;
  /** Keyless community adapter: no library list, the sync probes the catalog. */
  ownedUnsupported: boolean;
  privateGames: Set<number>;
  wishlist: SteamWishlistItem[] | "private";
};

function fakeSteam(games: Record<number, FakeGame>): FakeSteam {
  const state: FakeSteam = {
    games: new Map(Object.entries(games).map(([id, g]) => [Number(id), g])),
    profilePublic: true,
    ownedPrivate: false,
    ownedUnsupported: false,
    privateGames: new Set(),
    wishlist: [],
    api: undefined as unknown as SteamApi,
  };
  state.api = {
    async getPlayerSummary(steamId) {
      return { steamId, personaName: "Test", avatarUrl: "", profilePublic: state.profilePublic };
    },
    async getOwnedGames() {
      if (state.ownedPrivate) return "private";
      if (state.ownedUnsupported) return "unsupported";
      return [...state.games.entries()].map(([appId, g]) => ({
        appId,
        // Steam's include_appinfo name; `null` plays an app Steam lists without one.
        ...(g.name !== null && { name: g.name ?? `Jogo de Teste ${appId}` }),
        playtimeMin: g.playtimeMin ?? 600,
        playtime2WeeksMin: g.playtime2WeeksMin ?? 0,
        lastPlayedAt: g.lastPlayedAt ?? null,
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
      return Object.keys(g.pcts).map((apiName) => {
        const unlock = g.unlocks[apiName] ?? null;
        return { apiName, achieved: unlock !== null, unlockedAt: unlock === "undated" ? null : unlock };
      });
    },
    async getWishlist() {
      return state.wishlist;
    },
    async getAppList() {
      return "unsupported";
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
    // By handle too: a user whose Steam was disconnected has no steamId left.
    await prisma.user.deleteMany({
      where: { OR: [{ steamId: { startsWith: STEAM_PREFIX } }, { handle: { startsWith: "test_sync_" } }] },
    });
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

  /** XP of everything but the hours milestones. */
  async function achievementXp(userId: string) {
    const { prisma } = await import("@/lib/db");
    const sum = await prisma.xpLedgerEntry.aggregate({ where: { userId, ...NOT_PLAYTIME }, _sum: { xp: true } });
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

  it("a Steam disconnected (or claimed by another profile) while the sync reads stops it: nothing is written", async () => {
    const { prisma } = await import("@/lib/db");
    const { unlink } = await import("@/lib/accounts/link");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    const steam = fakeSteam({ [appId]: { pcts: pctsOf(3), unlocks: { A0: new Date("2024-01-02T10:00:00Z") } } });
    const user = await newUser();
    const read = steam.api.getPlayerAchievements;
    // The account goes away between reading Steam and recording the games.
    steam.api.getPlayerAchievements = async (steamId, id) => {
      const achievements = await read(steamId, id);
      await unlink(user.id, "steam");
      return achievements;
    };
    steamState.api = steam.api;

    expect(await syncUser(user.id)).toMatchObject({ status: "unlinked", newUnlocks: 0 });
    expect(await prisma.userGame.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.userAchievement.count({ where: { userId: user.id } })).toBe(0);
    // The library (and its playtime XP) was recorded before the unlink, which voided it.
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, voidedAt: null } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lastSyncedAt).toBeNull();
  });

  it("a Steam disconnected and linked again while the sync reads also stops it (another link)", async () => {
    const { prisma } = await import("@/lib/db");
    const { unlink } = await import("@/lib/accounts/link");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    const steam = fakeSteam({ [appId]: { pcts: pctsOf(3), unlocks: { A0: new Date("2024-01-02T10:00:00Z") } } });
    const user = await newUser();
    const read = steam.api.getPlayerAchievements;
    steam.api.getPlayerAchievements = async (steamId, id) => {
      const achievements = await read(steamId, id);
      await unlink(user.id, "steam");
      // Linked again at once (same SteamID, a new active row).
      await prisma.user.update({ where: { id: user.id }, data: { steamId } });
      await prisma.linkedAccount.upsert({
        where: { userId_platform: { userId: user.id, platform: "steam" } },
        create: { userId: user.id, platform: "steam", externalId: steamId, handle: "Test" },
        update: { externalId: steamId, linkedAt: new Date() },
      });
      return achievements;
    };
    steamState.api = steam.api;

    expect(await syncUser(user.id)).toMatchObject({ status: "unlinked", newUnlocks: 0 });
    expect(await prisma.userGame.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, voidedAt: null } })).toBe(0);
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

  it("without a library list it probes the catalog and keeps only games with an unlock", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const { syncGame } = await import("./catalog");
    const [played, untouched, outside] = [newAppId(), newAppId(), newAppId()];
    const steam = fakeSteam({
      [played]: { pcts: pctsOf(3, 20), unlocks: { A0: new Date("2022-05-01T10:00:00Z"), A2: new Date("2022-06-01T10:00:00Z") } },
      [untouched]: { pcts: pctsOf(2, 20), unlocks: {} },
      // Has unlocks on Steam but is not in the catalog: a probe never finds it.
      [outside]: { pcts: pctsOf(2, 20), unlocks: { A0: new Date("2022-05-01T10:00:00Z") } },
    });
    steamState.api = steam.api;
    await syncGame(played);
    await syncGame(untouched);
    steam.ownedUnsupported = true;
    const user = await newUser();

    const result = await syncUser(user.id);

    expect(result).toMatchObject({ status: "ok", newUnlocks: 2 });
    const library = await prisma.userGame.findMany({ where: { userId: user.id }, include: { game: true } });
    expect(library.map((g) => g.game.steamAppId)).toEqual([played]);
    expect(library[0]).toMatchObject({ unlockedCount: 2, playtimeMin: 0 });
    expect(await prisma.game.count({ where: { steamAppId: outside } })).toBe(0);
    const unlocks = await prisma.userAchievement.findMany({ where: { userId: user.id }, include: { achievement: true } });
    expect(unlocks.map((u) => u.unlockedAt?.toISOString()).sort()).toEqual([
      "2022-05-01T10:00:00.000Z",
      "2022-06-01T10:00:00.000Z",
    ]);
  });

  it("completion and the platinum bonus ignore catalog rows Steam no longer lists (old seed rows)", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const { syncGame } = await import("./catalog");
    const appId = newAppId();
    const steam = fakeSteam({
      [appId]: { pcts: pctsOf(2, 30), unlocks: { A0: new Date("2023-01-01T10:00:00Z"), A1: new Date("2023-02-01T10:00:00Z") } },
    });
    steamState.api = steam.api;
    const game = await syncGame(appId);
    // A leftover row (e.g. a seed fixture id) that Steam does not list for this game.
    await prisma.achievement.create({ data: { gameId: game!.id, platform: "steam", apiName: "SEED_ONLY", name: "Seed", globalPct: 1 } });
    const user = await newUser();

    await syncUser(user.id);

    const userGame = await prisma.userGame.findUniqueOrThrow({
      where: { userId_gameId_platform: { userId: user.id, gameId: game!.id, platform: "steam" } },
    });
    expect(userGame).toMatchObject({ unlockedCount: 2, completedAt: new Date("2023-02-01T10:00:00Z") });
    const platinum = await prisma.xpLedgerEntry.findFirstOrThrow({ where: { userId: user.id, source: "platinum" } });
    expect(platinum.xp).toBe(platinumBonus([xpForAchievement(30), xpForAchievement(30)]));
  });

  it("probing stops at the time budget and after consecutive failures", async () => {
    const { syncUser } = await import("./user");
    const { syncGame } = await import("./catalog");
    const apps = Array.from({ length: 12 }, () => newAppId());
    const steam = fakeSteam(Object.fromEntries(apps.map((id) => [id, { pcts: pctsOf(1), unlocks: {} }])));
    steamState.api = steam.api;
    for (const id of apps) await syncGame(id);
    steam.ownedUnsupported = true;

    // A spent budget probes nothing (the next sync resumes).
    const calls: number[] = [];
    const counting = steam.api.getPlayerAchievements;
    steam.api.getPlayerAchievements = async (steamId, appId) => {
      calls.push(appId);
      return counting(steamId, appId);
    };
    const user = await newUser();
    await expect(syncUser(user.id, { probeBudgetMs: 0 })).resolves.toMatchObject({ status: "ok", newUnlocks: 0 });
    expect(calls).toHaveLength(0);

    // Steam keeps refusing: the breaker stops well before the whole catalog is tried.
    steam.api.getPlayerAchievements = async (_steamId, appId) => {
      calls.push(appId);
      throw new Error("Steam community achievements failed with HTTP 429");
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(syncUser(user.id)).rejects.toThrow(/429/);
    } finally {
      errors.mockRestore();
    }
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(calls.length).toBeLessThan(10);
  });

  it("probe order: library games only when due, then the rest of the catalog as a ring by time slot", async () => {
    const { prisma } = await import("@/lib/db");
    const { catalogProbeCandidates } = await import("./user");
    const { syncGame } = await import("./catalog");
    const [owned, other] = [newAppId(), newAppId()];
    steamState.api = fakeSteam({
      [owned]: { pcts: pctsOf(1), unlocks: {} },
      [other]: { pcts: pctsOf(1), unlocks: {} },
    }).api;
    const ownedGame = await syncGame(owned);
    await syncGame(other);
    const user = await newUser();
    await prisma.userGame.create({
      data: { userId: user.id, gameId: ownedGame!.id, platform: "steam", playtimeMin: 0, unlockedCount: 1 },
    });
    const ids = (list: { appId: number }[]) => list.map((c) => c.appId);

    const syncedAt = new Date();
    const now = syncedAt.getTime() + 1;
    // Synced just now and the game did not change since: not due.
    const quiet = await catalogProbeCandidates(user.id, syncedAt, now);
    expect(ids(quiet)).not.toContain(owned);
    expect(ids(quiet)).toContain(other);
    // Never synced, forced (imports), or a new 7-day period: due, and probed first.
    expect(ids(await catalogProbeCandidates(user.id, null, now))[0]).toBe(owned);
    expect(ids(await catalogProbeCandidates(user.id, syncedAt, now, true))[0]).toBe(owned);
    expect(ids(await catalogProbeCandidates(user.id, syncedAt, now + 7 * DAY))[0]).toBe(owned);
    // Its catalog data changed after the last sync: due.
    await prisma.game.update({ where: { id: ownedGame!.id }, data: { lastSyncAttemptAt: new Date(now + 1000) } });
    expect(ids(await catalogProbeCandidates(user.id, syncedAt, now))[0]).toBe(owned);

    // The ring covers every other game once, starting at a slot-dependent offset.
    const a = ids(await catalogProbeCandidates(user.id, syncedAt, now));
    const b = ids(await catalogProbeCandidates(user.id, syncedAt, now + 2 * 60_000));
    const ringA = a.slice(1);
    const ringB = b.slice(1);
    expect(new Set(ringA).size).toBe(ringA.length);
    // The next slot walks the same ring from another point.
    const k = ringA.indexOf(ringB[0]);
    expect([...ringA.slice(k), ...ringA.slice(0, k)]).toEqual(ringB);
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
    const before = await achievementXp(user.id);
    expect(before).toBe(xpForAchievement(40));

    // The achievement became legendary, and the player plays again and unlocks another one.
    steam.games.get(appId)!.pcts = { A0: 1, A1: 40, A2: 40 };
    steam.games.get(appId)!.unlocks.A1 = new Date("2024-03-01T10:00:00Z");
    steam.games.get(appId)!.playtimeMin = 660;
    await prisma.achievement.updateMany({ where: { game: { steamAppId: appId }, apiName: "A0" }, data: { globalPct: 1 } });
    const result = await syncUser(user.id);

    expect(result.newUnlocks).toBe(1);
    expect(await achievementXp(user.id)).toBe(before + xpForAchievement(40));
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
    const ledger = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id, ...NOT_PLAYTIME } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].xp).toBe(xpForAchievement(10));
  });

  it("an unlock the admin released (fraudReview cleared) is not flagged again by the next sync", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const { releaseFraud } = await import("@/lib/admin/fraud");
    const appId = newAppId();
    const burstAt = new Date("2024-06-06T20:00:00Z");
    const unlocks: Record<string, Date> = {};
    for (let i = 0; i < 10; i++) unlocks[`A${i}`] = new Date(burstAt.getTime() + i * 3000);
    steamState.api = fakeSteam({ [appId]: { pcts: pctsOf(12, 10), unlocks } }).api;
    const user = await newUser();
    await syncUser(user.id);
    const game = await prisma.game.findUniqueOrThrow({ where: { steamAppId: appId } });
    expect(await prisma.userAchievement.count({ where: { userId: user.id, suspicious: true } })).toBe(10);

    expect(await releaseFraud({ userId: user.id, gameId: game.id, platform: "steam" })).toMatchObject({ ok: true, entries: 10 });
    await syncUser(user.id);

    expect(await prisma.userAchievement.count({ where: { userId: user.id, suspicious: true } })).toBe(0);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, source: "achievement", voidedAt: null } })).toBe(10);
  });

  it("a resync never re-judges stored unlocks: an old burst stays valid, a new unlock in it is flagged", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    const unlocks: Record<string, Date> = {};
    // Ten valid unlocks on separate days, then Steam reports them within 30 s (an old burst).
    for (let i = 0; i < 10; i++) unlocks[`A${i}`] = new Date(Date.UTC(2024, 0, 1 + i, 20));
    const steam = fakeSteam({ [appId]: { pcts: pctsOf(12, 10), unlocks } });
    steamState.api = steam.api;
    const user = await newUser();
    await syncUser(user.id);
    expect(await prisma.userAchievement.count({ where: { userId: user.id, suspicious: true } })).toBe(0);
    const ledger = () => prisma.xpLedgerEntry.count({ where: { userId: user.id, source: "achievement", voidedAt: null } });
    const validBefore = await ledger();
    expect(validBefore).toBe(10);

    const burstAt = new Date("2024-05-05T20:00:00Z");
    const game = steam.games.get(appId)!;
    for (let i = 0; i < 10; i++) game.unlocks[`A${i}`] = new Date(burstAt.getTime() + i * 3000);
    await prisma.userAchievement.updateMany({ where: { userId: user.id }, data: { unlockedAt: burstAt } });
    game.playtimeMin = 660;
    await syncUser(user.id);
    expect(await prisma.userAchievement.count({ where: { userId: user.id, suspicious: true } })).toBe(0);
    expect(await ledger()).toBe(validBefore);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, voidedAt: { not: null } } })).toBe(0);

    // A new unlock inside that burst is still judged by the rules.
    game.unlocks.A10 = new Date(burstAt.getTime() + 15000);
    game.playtimeMin = 700;
    await syncUser(user.id);
    const flagged = await prisma.userAchievement.findMany({
      where: { userId: user.id, suspicious: true },
      include: { achievement: true },
    });
    expect(flagged.map((r) => r.achievement.apiName)).toEqual(["A10"]);
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

    expect(
      await prisma.xpLedgerEntry.count({ where: { userId: { in: [privateProfile.id, privateDetails.id] }, ...NOT_PLAYTIME } }),
    ).toBe(0);
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
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, ...NOT_PLAYTIME } })).toBe(0);
  });

  it("a completion that includes undated unlocks is exempt from the speed-platinum rule: nothing gets flagged", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    await prisma.game.create({
      data: {
        slug: `test-sync-speed-undated-${appId}`,
        name: "Old speed game",
        steamAppId: appId,
        achievementCount: 3,
        platforms: ["PC"],
        timeToBeatCompleteMin: 6000,
        achievements: { create: ["A0", "A1", "A2"].map((apiName) => ({ apiName, name: apiName, globalPct: 10 })) },
      },
    });
    // Valid dated unlocks first, the game not complete; Steam's playtime is tiny (< 5% of 6000).
    const fake = fakeSteam({
      [appId]: {
        pcts: pctsOf(3),
        playtimeMin: 100,
        unlocks: { A0: new Date("2010-01-01T10:00:00Z"), A1: new Date("2010-01-05T10:00:00Z") },
      },
    });
    steamState.api = fake.api;
    const user = await newUser();
    await syncUser(user.id);
    expect(await prisma.userAchievement.count({ where: { userId: user.id, suspicious: false } })).toBe(2);

    // The undated one (unlocktime 0) completes it.
    fake.games.get(appId)!.unlocks.A2 = "undated";
    fake.games.get(appId)!.playtimeMin = 110;
    await syncUser(user.id);

    const rows = await prisma.userAchievement.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !r.suspicious)).toBe(true);
    const game = await prisma.game.findUniqueOrThrow({ where: { steamAppId: appId } });
    const platinum = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id, source: "platinum", sourceKey: game.id } });
    expect(platinum).toHaveLength(1);
    expect(platinum[0].dateUnknown).toBe(true);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, source: "achievement", voidedAt: null } })).toBe(3);
  });

  it("keeps games without achievements in the library as name-only stubs (playtime, no unlocks)", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const withAch = newAppId();
    const without = newAppId();
    steamState.api = fakeSteam({
      [withAch]: { pcts: pctsOf(2), unlocks: { A0: new Date("2024-01-01T10:00:00Z") } },
      [without]: { pcts: {}, unlocks: {}, playtimeMin: 125 },
    }).api;
    const user = await newUser();

    const result = await syncUser(user.id);

    expect(result.newUnlocks).toBe(1);
    const stub = await prisma.game.findUniqueOrThrow({ where: { steamAppId: without } });
    expect(stub).toMatchObject({ stub: true, achievementCount: 0 });
    expect(await prisma.game.findUniqueOrThrow({ where: { steamAppId: withAch } })).toMatchObject({ stub: false });
    expect(
      await prisma.userGame.findUniqueOrThrow({
        where: { userId_gameId_platform: { userId: user.id, gameId: stub.id, platform: "steam" } },
      }),
    ).toMatchObject({ playtimeMin: 125, unlockedCount: 0, checkedPlaytimeMin: 125 });
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
    const ledger = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id, ...NOT_PLAYTIME } });
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
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, ...NOT_PLAYTIME } })).toBe(1);
  });

  it("marks a public profile with private game details as private", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    const steam = fakeSteam({ [appId]: { pcts: pctsOf(2), unlocks: {} } });
    steam.privateGames.add(appId);
    steamState.api = steam.api;
    const user = await newUser(); // created public
    revalidateTag.mockClear();

    expect((await syncUser(user.id)).status).toBe("private");

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.profilePublic).toBe(false);
    expect(row.lastSyncedAt).toBeNull();
    // Going private reaches the cached public pages at once.
    for (const tag of ["gallery", "forum", `player:${row.handle.toLowerCase()}`]) {
      expect(revalidateTag).toHaveBeenCalledWith(tag, { expire: 0 });
    }
    // Already private: nothing to invalidate on the next sync.
    revalidateTag.mockClear();
    expect((await syncUser(user.id)).status).toBe("private");
    expect(revalidateTag).not.toHaveBeenCalled();
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

  it("reads a game Steam reports at 0 minutes once (old games have unlocks), then not again", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const played = newAppId();
    const unplayed = newAppId();
    const fake = fakeSteam({
      [played]: { pcts: pctsOf(2), playtimeMin: 300, unlocks: { A0: new Date("2024-01-01T10:00:00Z") } },
      [unplayed]: { pcts: pctsOf(2), playtimeMin: 0, unlocks: { A0: new Date("2024-01-02T10:00:00Z") } },
    });
    steamState.api = fake.api;
    const user = await newUser();

    // Both games' unlocks come in: the one at 0 minutes is read once.
    expect(await syncUser(user.id)).toMatchObject({ status: "ok", newUnlocks: 2 });
    const game = await prisma.game.findUniqueOrThrow({ where: { steamAppId: unplayed } });
    const owned = await prisma.userGame.findUniqueOrThrow({
      where: { userId_gameId_platform: { userId: user.id, gameId: game.id, platform: "steam" } },
    });
    expect(owned).toMatchObject({ playtimeMin: 0, checkedPlaytimeMin: 0 });
    // Still no hours and no playtime XP for it.
    expect(
      await prisma.xpLedgerEntry.count({ where: { userId: user.id, source: "playtime", sourceKey: { contains: game.id } } }),
    ).toBe(0);
    // Next sync: nothing new, the game at 0 is not read again.
    expect(await syncUser(user.id)).toMatchObject({ status: "ok", newUnlocks: 0 });
  });

  it("a game Steam lists without a last-played date still gets one: newest unlock, then hours that grew", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const { getRecentlyPlayed } = await import("@/lib/library/queries");
    const noDate = newAppId();
    const dated = newAppId();
    const steamDate = new Date("2024-06-01T12:00:00Z");
    const fake = fakeSteam({
      [noDate]: {
        pcts: pctsOf(3),
        playtimeMin: 1080,
        unlocks: { A0: new Date("2024-05-01T10:00:00Z"), A1: new Date("2024-05-03T10:00:00Z") },
      },
      [dated]: { pcts: pctsOf(2), playtimeMin: 120, lastPlayedAt: steamDate, unlocks: { A0: new Date("2024-05-02T10:00:00Z") } },
    });
    steamState.api = fake.api;
    const user = await newUser();
    const rowOf = async (appId: number) => {
      const game = await prisma.game.findUniqueOrThrow({ where: { steamAppId: appId } });
      return prisma.userGame.findUniqueOrThrow({
        where: { userId_gameId_platform: { userId: user.id, gameId: game.id, platform: "steam" } },
      });
    };

    await syncUser(user.id);
    // No date from Steam: the newest unlock. Steam's own date is kept as it is.
    expect((await rowOf(noDate)).lastPlayedAt).toEqual(new Date("2024-05-03T10:00:00Z"));
    expect((await rowOf(dated)).lastPlayedAt).toEqual(steamDate);
    expect((await getRecentlyPlayed(user.id)).map((g) => g.name)).toEqual([
      `Jogo de Teste ${dated}`,
      `Jogo de Teste ${noDate}`,
    ]);

    // Same hours, still no date: the date is not erased.
    await syncUser(user.id);
    expect((await rowOf(noDate)).lastPlayedAt).toEqual(new Date("2024-05-03T10:00:00Z"));

    // More hours, still no date: played now, so it comes first.
    fake.games.get(noDate)!.playtimeMin = 1140;
    const before = Date.now();
    await syncUser(user.id);
    expect((await rowOf(noDate)).lastPlayedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect((await getRecentlyPlayed(user.id))[0].name).toBe(`Jogo de Teste ${noDate}`);
  });

  it("an achievement Steam gives as earned without a date is kept: no date, counts, pays XP dated at record time and marked", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const { weeklyXpOf } = await import("@/lib/highscores/queries");
    const appId = newAppId();
    const dated = new Date("2019-03-01T10:00:00Z");
    // Team Fortress 2 on 2026-11-05: achieved=1 with unlocktime 0 for its old achievements.
    steamState.api = fakeSteam({
      [appId]: { pcts: pctsOf(4, 10), playtimeMin: 60, unlocks: { A0: dated, A1: "undated", A2: "undated" } },
    }).api;
    const user = await newUser();
    const started = Date.now();

    const result = await syncUser(user.id);

    expect(result.newUnlocks).toBe(3);
    const unlocks = await prisma.userAchievement.findMany({
      where: { userId: user.id },
      include: { achievement: { select: { apiName: true } } },
    });
    expect(Object.fromEntries(unlocks.map((u) => [u.achievement.apiName, u.unlockedAt]))).toEqual({
      A0: dated,
      A1: null,
      A2: null,
    });
    const game = await prisma.game.findUniqueOrThrow({ where: { steamAppId: appId } });
    const userGame = await prisma.userGame.findUniqueOrThrow({
      where: { userId_gameId_platform: { userId: user.id, gameId: game.id, platform: "steam" } },
    });
    // The newest dated unlock dates the game, not the record time.
    expect(userGame).toMatchObject({ unlockedCount: 3, completedAt: null, lastPlayedAt: dated });

    const ledger = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id, source: "achievement" } });
    expect(ledger).toHaveLength(3);
    const idOf = new Map(unlocks.map((u) => [u.achievementId, u.achievement.apiName]));
    for (const entry of ledger) {
      expect(entry.xp).toBe(xpForAchievement(10));
      if (idOf.get(entry.sourceKey) === "A0") {
        expect(entry).toMatchObject({ dateUnknown: false, createdAt: dated });
      } else {
        expect(entry.dateUnknown).toBe(true);
        expect(entry.createdAt.getTime()).toBeGreaterThanOrEqual(started - 1000);
      }
    }
    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stats.totalXp).toBe(3 * xpForAchievement(10));
    // Recorded today, but not earned today: no streak, and no XP of the week.
    expect(stats).toMatchObject({ streakCurrent: 0 });
    expect(await weeklyXpOf(user.id)).toBe(0);
    // The trophy-lists snapshot tells the undated part of the Steam numbers apart.
    const { userNumbers } = await import("@/lib/trophies/numbers");
    expect(await userNumbers([user.id])).toEqual([
      expect.objectContaining({
        steamUnlocks: 3,
        steamXp: 3 * xpForAchievement(10),
        steamUndatedUnlocks: 2,
        steamUndatedXp: 2 * xpForAchievement(10),
      }),
    ]);
  });

  it("a date Steam gives later fills the unknown one in without paying again; a known date is never erased", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    const known = new Date("2020-01-01T10:00:00Z");
    const fake = fakeSteam({ [appId]: { pcts: pctsOf(3, 10), playtimeMin: 60, unlocks: { A0: "undated", A1: known } } });
    steamState.api = fake.api;
    const user = await newUser();
    await syncUser(user.id);
    const ledgerBefore = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } });

    // Steam now dates A0 and (oddly) loses A1's date; more hours so the game is read again.
    const later = new Date("2021-06-01T10:00:00Z");
    fake.games.get(appId)!.unlocks = { A0: later, A1: "undated" };
    fake.games.get(appId)!.playtimeMin = 120;
    const second = await syncUser(user.id);

    expect(second.newUnlocks).toBe(0);
    const unlocks = await prisma.userAchievement.findMany({
      where: { userId: user.id },
      include: { achievement: { select: { apiName: true } } },
    });
    expect(Object.fromEntries(unlocks.map((u) => [u.achievement.apiName, u.unlockedAt]))).toEqual({ A0: later, A1: known });
    expect(await prisma.xpLedgerEntry.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } })).toEqual(ledgerBefore);
  });

  it("a completion with undated unlocks pays the platinum once, marked; completion is the newest dated unlock", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const [mixed, allUndated] = [newAppId(), newAppId()];
    const dated = new Date("2012-02-02T10:00:00Z");
    steamState.api = fakeSteam({
      [mixed]: { pcts: { A0: 10, A1: 20 }, playtimeMin: 60, unlocks: { A0: "undated", A1: dated } },
      [allUndated]: { pcts: { A0: 10, A1: 20 }, playtimeMin: 60, unlocks: { A0: "undated", A1: "undated" } },
    }).api;
    const user = await newUser();
    const started = Date.now();

    await syncUser(user.id);
    await syncUser(user.id);

    for (const appId of [mixed, allUndated]) {
      const game = await prisma.game.findUniqueOrThrow({ where: { steamAppId: appId } });
      const platinum = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id, source: "platinum", sourceKey: game.id } });
      expect(platinum).toHaveLength(1);
      expect(platinum[0]).toMatchObject({ dateUnknown: true, xp: platinumBonus([xpForAchievement(10), xpForAchievement(20)]) });
      expect(platinum[0].createdAt.getTime()).toBeGreaterThanOrEqual(started - 1000);
      const userGame = await prisma.userGame.findUniqueOrThrow({
        where: { userId_gameId_platform: { userId: user.id, gameId: game.id, platform: "steam" } },
      });
      expect(userGame.unlockedCount).toBe(2);
      if (appId === mixed) expect(userGame.completedAt).toEqual(dated);
      else expect(userGame.completedAt!.getTime()).toBeGreaterThanOrEqual(started - 1000);
    }
  });

  it("an all-undated completion keeps the completedAt Tralked recorded when the game is read again", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const appId = newAppId();
    const fake = fakeSteam({ [appId]: { pcts: { A0: 10, A1: 20 }, playtimeMin: 60, unlocks: { A0: "undated", A1: "undated" } } });
    steamState.api = fake.api;
    const user = await newUser();
    await syncUser(user.id);
    const game = await prisma.game.findUniqueOrThrow({ where: { steamAppId: appId } });
    const where = { userId_gameId_platform: { userId: user.id, gameId: game.id, platform: "steam" } };
    const recorded = new Date("2026-01-15T10:00:00Z");
    await prisma.userGame.update({ where, data: { completedAt: recorded } });

    fake.games.get(appId)!.playtimeMin = 120; // more hours: the game is read again
    await syncUser(user.id);

    expect((await prisma.userGame.findUniqueOrThrow({ where })).completedAt).toEqual(recorded);
  });

  it("probing without a key keeps a game whose only unlocks are undated", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const { syncGame } = await import("./catalog");
    const appId = newAppId();
    const fake = fakeSteam({ [appId]: { pcts: pctsOf(2, 20), unlocks: { A1: "undated" } } });
    fake.ownedUnsupported = true;
    steamState.api = fake.api;
    await syncGame(appId);
    const user = await newUser();

    await syncUser(user.id);

    const unlocks = await prisma.userAchievement.findMany({ where: { userId: user.id } });
    expect(unlocks).toHaveLength(1);
    expect(unlocks[0].unlockedAt).toBeNull();
  });

  it("a game without a Steam date but with hours in the last two weeks is dated now, once per two weeks", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const { getRecentlyPlayed } = await import("@/lib/library/queries");
    // Castlevania: Belmont's Curse for a player on 2026-11-05: 1,939 min, 307 in two weeks, no
    // rtime_last_played, hours unchanged since the last sync (so its achievements are not re-read).
    const recent = newAppId();
    const old = newAppId();
    const fake = fakeSteam({
      [recent]: { pcts: pctsOf(2), playtimeMin: 1939, unlocks: {} },
      [old]: { pcts: pctsOf(2), playtimeMin: 600, unlocks: {} },
    });
    steamState.api = fake.api;
    const user = await newUser();
    const rowOf = async (appId: number) => {
      const game = await prisma.game.findUniqueOrThrow({ where: { steamAppId: appId } });
      return prisma.userGame.findUniqueOrThrow({
        where: { userId_gameId_platform: { userId: user.id, gameId: game.id, platform: "steam" } },
      });
    };
    await syncUser(user.id);
    expect((await rowOf(recent)).lastPlayedAt).toBeNull();

    fake.games.get(recent)!.playtime2WeeksMin = 307;
    const startedAt = Date.now();
    await syncUser(user.id);
    const dated = (await rowOf(recent)).lastPlayedAt!;
    expect(dated.getTime()).toBeGreaterThanOrEqual(startedAt - 1000);
    // No hours in the last two weeks and no date: nothing to go on.
    expect((await rowOf(old)).lastPlayedAt).toBeNull();
    expect((await getRecentlyPlayed(user.id))[0].name).toBe(`Jogo de Teste ${recent}`);

    // Still within the two weeks: the date is not moved on every sync.
    await syncUser(user.id);
    expect((await rowOf(recent)).lastPlayedAt).toEqual(dated);
  });

  it("asks once about games other players own that Steam leaves out of the list (Family Sharing)", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const mine = newAppId();
    const shared = newAppId();
    // A friend owns `shared`; this user's Steam list does not show it, but Steam answers its unlocks.
    const friendFake = fakeSteam({ [shared]: { pcts: pctsOf(2), playtimeMin: 60, unlocks: { A0: new Date("2024-03-01T10:00:00Z") } } });
    steamState.api = friendFake.api;
    const friend = await newUser();
    await syncUser(friend.id);

    const fake = fakeSteam({ [mine]: { pcts: pctsOf(2), playtimeMin: 120, unlocks: { A0: new Date("2024-01-01T10:00:00Z") } } });
    const listed = fake.api.getPlayerAchievements;
    fake.api.getPlayerAchievements = async (steamId, appId) =>
      appId === shared ? friendFake.api.getPlayerAchievements(steamId, appId) : listed(steamId, appId);
    steamState.api = fake.api;
    const user = await newUser();
    await syncUser(user.id);
    const game = await prisma.game.findUniqueOrThrow({ where: { steamAppId: shared } });
    expect(
      await prisma.userGame.findUnique({ where: { userId_gameId_platform: { userId: user.id, gameId: game.id, platform: "steam" } } }),
    ).toMatchObject({ unlockedCount: 1 });
  });

  it("a borrowed game Steam shows among the recently played enters the library with its hours, even one asked before", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const { getRecentlyPlayed } = await import("@/lib/library/queries");
    const mine = newAppId();
    const shared = newAppId();
    const sharedLocked = newAppId();
    // Phantom Blade Zero through Family Sharing (2026-11-05): not in GetOwnedGames, in
    // GetRecentlyPlayedGames with 148 min, 5 unlocks Steam answers when asked by appid.
    const borrowed = fakeSteam({
      [shared]: { pcts: pctsOf(3), unlocks: { A0: new Date("2024-03-01T10:00:00Z"), A1: new Date("2024-03-02T10:00:00Z") } },
      [sharedLocked]: { pcts: pctsOf(2), unlocks: {} },
    });
    const fake = fakeSteam({
      [mine]: { pcts: pctsOf(2), playtimeMin: 120, lastPlayedAt: new Date("2024-01-01T10:00:00Z"), unlocks: {} },
    });
    const listed = fake.api.getPlayerAchievements;
    fake.api.getPlayerAchievements = async (steamId, appId) =>
      appId === mine ? listed(steamId, appId) : borrowed.api.getPlayerAchievements(steamId, appId);
    const ownSchema = fake.api.getSchemaForGame;
    fake.api.getSchemaForGame = async (appId, lang) =>
      appId === mine ? ownSchema(appId, lang) : borrowed.api.getSchemaForGame(appId, lang);
    fake.api.getGlobalAchievementPercentages = async (appId) =>
      appId === mine ? { ...pctsOf(2) } : borrowed.api.getGlobalAchievementPercentages(appId);
    const recent = [
      { appId: shared, name: "Emprestado Com Conquistas", playtimeMin: 148, playtime2WeeksMin: 148, lastPlayedAt: null },
      { appId: sharedLocked, name: "Emprestado Sem Conquistas", playtimeMin: 118, playtime2WeeksMin: 118, lastPlayedAt: null },
      // A recent game that is also owned keeps its library entry (and Steam's date).
      { appId: mine, name: `Jogo de Teste ${mine}`, playtimeMin: 120, playtime2WeeksMin: 30, lastPlayedAt: null },
    ];
    fake.api.getRecentlyPlayedGames = async () => recent;
    steamState.api = fake.api;
    const user = await newUser();
    // Asked once before, when they had no unlocks yet: the borrowed probe never asks again.
    await prisma.syncCursor.create({ data: { key: `steam-borrowed:${user.id}`, value: [shared, sharedLocked] } });
    const rowOf = async (appId: number) => {
      const game = await prisma.game.findUniqueOrThrow({ where: { steamAppId: appId } });
      return prisma.userGame.findUnique({
        where: { userId_gameId_platform: { userId: user.id, gameId: game.id, platform: "steam" } },
      });
    };

    const startedAt = Date.now();
    await syncUser(user.id);
    const played = await rowOf(shared);
    expect(played).toMatchObject({ playtimeMin: 148, playtime2WeeksMin: 148, unlockedCount: 2 });
    expect(played!.lastPlayedAt!.getTime()).toBeGreaterThanOrEqual(startedAt - 1000);
    const locked = await rowOf(sharedLocked);
    expect(locked).toMatchObject({ playtimeMin: 118, unlockedCount: 0 });
    expect(locked!.lastPlayedAt!.getTime()).toBeGreaterThanOrEqual(startedAt - 1000);
    expect((await rowOf(mine))!.lastPlayedAt).toEqual(new Date("2024-01-01T10:00:00Z"));
    expect((await getRecentlyPlayed(user.id)).map((g) => g.name).slice(0, 2).sort()).toEqual([
      "Emprestado Com Conquistas",
      "Emprestado Sem Conquistas",
    ]);

    // Same hours on the next sync: the date stays. More hours: played now.
    const firstDate = locked!.lastPlayedAt!;
    await syncUser(user.id);
    expect((await rowOf(sharedLocked))!.lastPlayedAt).toEqual(firstDate);
    recent[1] = { ...recent[1], playtimeMin: 178, playtime2WeeksMin: 178 };
    const later = Date.now();
    await syncUser(user.id);
    expect(await rowOf(sharedLocked)).toMatchObject({ playtimeMin: 178 });
    expect((await rowOf(sharedLocked))!.lastPlayedAt!.getTime()).toBeGreaterThanOrEqual(later - 1000);
  });

  it("pays each hours milestone once, only for real playtime, and survives re-syncs", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const { playtimeXp } = await import("@/lib/engine/playtime");
    const longGame = newAppId();
    const noAch = newAppId();
    const idle = newAppId();
    const steam = fakeSteam({
      [longGame]: { pcts: pctsOf(2), playtimeMin: 3000 * 60, unlocks: {} },
      [noAch]: { pcts: {}, playtimeMin: 330, unlocks: {} },
      // Under 5 h: no XP at all.
      [idle]: { pcts: {}, playtimeMin: 299, unlocks: {} },
    });
    steamState.api = steam.api;
    const user = await newUser();

    await syncUser(user.id);
    const entries = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id, source: "playtime" } });
    const games = await prisma.game.findMany({ where: { steamAppId: { in: [longGame, noAch, idle] } } });
    const long = games.find((g) => g.steamAppId === longGame)!;
    const short = games.find((g) => g.steamAppId === noAch)!;
    const idleGame = games.find((g) => g.steamAppId === idle)!;
    expect(entries.filter((e) => e.sourceKey.startsWith(`steam:${long.id}:`))).toHaveLength(9); // 5 h … 2500 h
    expect(entries.filter((e) => e.sourceKey.startsWith(`steam:${short.id}:`)).map((e) => e.sourceKey)).toEqual([
      `steam:${short.id}:5`,
    ]);
    expect(entries.filter((e) => e.sourceKey.startsWith(`steam:${idleGame.id}:`))).toEqual([]);
    // Steam entries keep the Plan 1 convention: no platform column.
    expect(entries.every((e) => e.platform === null)).toBe(true);
    const paid = entries.reduce((sum, e) => sum + e.xp, 0);
    expect(paid).toBe(playtimeXp(3000 * 60) + playtimeXp(330));
    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stats.totalXp).toBe(paid);

    // Same hours again: nothing new. More hours: only the milestones crossed since.
    await syncUser(user.id);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, source: "playtime" } })).toBe(10);
    steam.games.get(noAch)!.playtimeMin = 610;
    await syncUser(user.id);
    expect(
      (await prisma.xpLedgerEntry.findMany({ where: { userId: user.id, source: "playtime", sourceKey: { startsWith: `steam:${short.id}:` } } }))
        .map((e) => e.sourceKey)
        .sort(),
    ).toEqual([`steam:${short.id}:10`, `steam:${short.id}:5`]);

    // Resistência and Acervo come from the library.
    const attrs = await prisma.attributeProgress.findMany({ where: { userId: user.id, attribute: { in: ["resistencia", "acervo"] } } });
    expect(attrs.find((a) => a.attribute === "acervo")?.points).toBe(30);
    expect(attrs.find((a) => a.attribute === "resistencia")?.points).toBeGreaterThan(2000);
  });

  it("a game Steam lists without a name keeps its placeholder as an unlisted stub, even with achievements", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const app = newAppId();
    steamState.api = fakeSteam({
      [app]: { pcts: pctsOf(2), name: null, unlocks: { A0: new Date("2024-01-01T10:00:00Z") } },
    }).api;
    const user = await newUser();
    expect(await syncUser(user.id)).toMatchObject({ newUnlocks: 1 });
    // IGDB knows nothing either: the name is still the placeholder, so the game stays a stub.
    expect(await prisma.game.findUniqueOrThrow({ where: { steamAppId: app } })).toMatchObject({
      name: `Jogo ${app} da Steam`,
      slug: `jogo-${app}-da-steam`,
      stub: true,
      achievementCount: 2,
    });
  });

  it("a legacy `Steam App <n>` game takes its library name and slug; without a name it is unlisted", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const named = newAppId();
    const nameless = newAppId();
    for (const appId of [named, nameless]) {
      await prisma.game.create({
        data: { steamAppId: appId, name: `Steam App ${appId}`, slug: `steam-app-${appId}`, platforms: ["PC"], achievementCount: 2 },
      });
    }
    steamState.api = fakeSteam({
      [named]: { pcts: {}, name: "Silent Hill 2", unlocks: {} },
      [nameless]: { pcts: pctsOf(2), name: null, unlocks: { A0: new Date("2024-01-01T10:00:00Z") } },
    }).api;
    const user = await newUser();
    await syncUser(user.id);

    const renamed = await prisma.game.findUniqueOrThrow({ where: { steamAppId: named } });
    expect(renamed).toMatchObject({ name: "Silent Hill 2", stub: false, detailsRequestedAt: expect.any(Date) });
    expect(renamed.slug).toMatch(/^silent-hill-2(-\d+)?$/);
    // No name anywhere (library, IGDB): the catalog sync keeps it out of listings.
    expect(await prisma.game.findUniqueOrThrow({ where: { steamAppId: nameless } })).toMatchObject({
      name: `Steam App ${nameless}`,
      stub: true,
    });
  });

  it("a re-sync reads achievements only of games played since the last read", async () => {
    const { syncUser } = await import("./user");
    const a = newAppId();
    const b = newAppId();
    const steam = fakeSteam({
      [a]: { pcts: pctsOf(2), playtimeMin: 100, unlocks: { A0: new Date("2024-01-01T10:00:00Z") } },
      [b]: { pcts: pctsOf(2), playtimeMin: 200, unlocks: {} },
    });
    const reads: number[] = [];
    const read = steam.api.getPlayerAchievements;
    steam.api.getPlayerAchievements = async (steamId, appId) => {
      // Only this library's games: games other players own are also asked once (borrowed games).
      if (appId === a || appId === b) reads.push(appId);
      return read(steamId, appId);
    };
    steamState.api = steam.api;
    const user = await newUser();

    await syncUser(user.id);
    expect(reads.sort()).toEqual([a, b].sort());
    reads.length = 0;
    await syncUser(user.id);
    expect(reads).toEqual([]);
    steam.games.get(b)!.playtimeMin = 260;
    steam.games.get(b)!.unlocks.A1 = new Date("2024-02-01T10:00:00Z");
    expect(await syncUser(user.id)).toMatchObject({ newUnlocks: 1 });
    expect(reads).toEqual([b]);
  });

  it("stops reading achievements at the time budget and finishes on the next sync", async () => {
    const { steamBacklogKey, syncUser } = await import("./user");
    const a = newAppId();
    steamState.api = fakeSteam({
      [a]: { pcts: pctsOf(2), playtimeMin: 100, unlocks: { A0: new Date("2024-01-01T10:00:00Z") } },
    }).api;
    const user = await newUser();
    expect(await syncUser(user.id, { probeBudgetMs: 0 })).toMatchObject({ status: "ok", newUnlocks: 0, partial: true });
    // The unfinished library is marked for the first-import worker, and unmarked once read whole.
    const { prisma } = await import("@/lib/db");
    const marker = { where: { key: steamBacklogKey(user.id) } };
    expect(await prisma.syncCursor.findUnique(marker)).not.toBeNull();
    expect(await syncUser(user.id)).toMatchObject({ status: "ok", newUnlocks: 1, partial: false });
    expect(await prisma.syncCursor.findUnique(marker)).toBeNull();
  });

  it("imports the wishlist (unknown apps as stubs queued for details) and replaces it on every sync", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const owned = newAppId();
    const wished = newAppId();
    const steam = fakeSteam({ [owned]: { pcts: {}, unlocks: {} } });
    steam.wishlist = [
      { appId: wished, priority: 0, addedAt: new Date("2025-01-01T00:00:00Z") },
      { appId: owned, priority: 1, addedAt: null },
    ];
    steamState.api = steam.api;
    const user = await newUser();

    await syncUser(user.id);
    const items = await prisma.wishlistItem.findMany({ where: { userId: user.id }, include: { game: true }, orderBy: { priority: "asc" } });
    expect(items.map((i) => [i.game.steamAppId, i.priority])).toEqual([
      [wished, 0],
      [owned, 1],
    ]);
    expect(items[0].game).toMatchObject({ stub: true, detailsRequestedAt: expect.any(Date) });

    steam.wishlist = [{ appId: owned, priority: 0, addedAt: null }];
    await syncUser(user.id);
    expect(await prisma.wishlistItem.count({ where: { userId: user.id } })).toBe(1);

    // A broken wishlist read never fails the sync.
    steam.api.getWishlist = async () => {
      throw new Error("wishlist down");
    };
    expect((await syncUser(user.id)).status).toBe("ok");
    expect(await prisma.wishlistItem.count({ where: { userId: user.id } })).toBe(1);
  });

  it("unlinking Steam voids its playtime XP and clears the wishlist; relinking does not pay it again", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncUser } = await import("./user");
    const { unlink } = await import("@/lib/accounts/link");
    const app = newAppId();
    const steam = fakeSteam({ [app]: { pcts: {}, playtimeMin: 600, unlocks: {} } });
    steam.wishlist = [{ appId: app, priority: 0, addedAt: null }];
    steamState.api = steam.api;
    const user = await newUser();
    const steamId = user.steamId!;

    await syncUser(user.id);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, source: "playtime", voidedAt: null } })).toBe(2);
    expect(await unlink(user.id, "steam")).toBe(true);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, source: "playtime", voidedAt: null } })).toBe(0);
    expect(await prisma.wishlistItem.count({ where: { userId: user.id } })).toBe(0);
    expect((await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } })).totalXp).toBe(0);

    await prisma.user.update({ where: { id: user.id }, data: { steamId } });
    await syncUser(user.id);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, source: "playtime", voidedAt: null } })).toBe(0);
    expect(await prisma.userGame.count({ where: { userId: user.id } })).toBe(1);
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

  it("cron run shares one deadline: no user starts after it, probing gets only the time left", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncStaleUsers, PROBE_BUDGET_MS } = await import("./user");
    const first = await newUser();
    const second = await newUser();
    await prisma.user.update({ where: { id: second.id }, data: { lastSyncAttemptAt: new Date("2020-01-01T00:00:00Z") } });
    const candidates = { id: { in: [first.id, second.id] } };
    let clock = 1_000_000;
    const now = () => clock;
    const base = fakeSteam({}).api;
    // Probing mode (no API key): reading each user's profile takes 40 s of the clock.
    let probes = 0;
    steamState.api = {
      ...base,
      getOwnedGames: async () => "unsupported",
      getPlayerSummary: async (steamId) => {
        clock += 40_000;
        return base.getPlayerSummary(steamId);
      },
      getPlayerAchievements: async (steamId, appId) => {
        probes++;
        return base.getPlayerAchievements(steamId, appId);
      },
    };

    // No time at all: nobody is touched.
    expect(await syncStaleUsers(10, candidates, { budgetMs: 0, now })).toEqual({ processed: 0, failed: 0 });
    expect(await prisma.user.count({ where: { ...candidates, lastSyncAttemptAt: null } })).toBe(1);

    // 30 s: the first user starts, but its probing gets 30 s (not PROBE_BUDGET_MS), all spent
    // reading the profile, so no catalog game is probed; the second user starts past the deadline.
    expect(await syncStaleUsers(10, candidates, { budgetMs: 30_000, now })).toEqual({ processed: 1, failed: 0 });
    expect(probes).toBe(0);
    const rows = await prisma.user.findMany({ where: candidates, select: { id: true, lastSyncedAt: true } });
    expect(rows.filter((r) => r.lastSyncedAt !== null)).toHaveLength(1);

    // 50 s: probing gets min(45 s, 50 s) and 5 s are left after the profile, so it probes.
    expect(await syncStaleUsers(1, candidates, { budgetMs: 50_000, now })).toEqual({ processed: 1, failed: 0 });
    expect(probes).toBeGreaterThan(0);
    expect(PROBE_BUDGET_MS).toBe(45_000);
  });
});

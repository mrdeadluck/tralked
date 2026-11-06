import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { xpForPlatformAchievement } from "@/lib/engine/trophies";
import { platinumBonus } from "@/lib/engine/xp";
import { env } from "@/lib/env";
import type { PsnTrophy } from "@/lib/integrations/psn/types";

// Uses the offline PSN/Xbox/RA fixtures (no keys in tests) against the seeded catalog.
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

const HANDLE_PREFIX = "test_platform_";
const FAKE_TITLE_PREFIX = "TESTRESUME_";
// Titles the fixtures have that the seeded catalog does not: the sync creates these games.
const CREATED_TITLES = [
  { platform: "psn", externalId: "NPWR90004_00" },
  { platform: "psn", externalId: "PPSA90005_00" },
  { platform: "xbox", externalId: "90000005" },
  { platform: "retro", externalId: "990001" },
  // Grand Theft Auto V of the PSN fixture account `Tres-Consoles` (PS3, PS4 and PS5 lists).
  { platform: "psn", externalId: "NPWR90011_00" },
  { platform: "psn", externalId: "NPWR90012_00" },
  { platform: "psn", externalId: "NPWR90013_00" },
  // An Xbox 360 title and its One title (spied library).
  { platform: "xbox", externalId: "90000771" },
  { platform: "xbox", externalId: "90000772" },
  // A 360 title remembered empty before the 360 routes.
  { platform: "xbox", externalId: "90000773" },
  // A 360 title whose read fails, then works.
  { platform: "xbox", externalId: "90000774" },
  { platform: "xbox", externalId: "90000781" },
  { platform: "psn", externalId: "NPWR99901_00" },
  // The only trophy-list link of the adoption-guard test's game.
  { platform: "psn", externalId: "NPWR99902_00" },
];
const GTA_LISTS = ["NPWR90011_00", "NPWR90012_00", "NPWR90013_00"];
// Lists and store title ids of the PSN concept tests (spied library).
const CONCEPT_IDS = ["NPWR_EN", "NPWR_JP", "PPSA_EN_TEST_00", "PPSA_JP_TEST_00", "CUSA_GTA_TEST_00"];
CREATED_TITLES.push(...CONCEPT_IDS.map((externalId) => ({ platform: "psn", externalId })));
const CONCEPT_EN_NAME = "Grand Theft Auto V Conceito Teste";
const CONCEPT_CATALOG_SLUG = "test-concept-catalog-game";

describe.skipIf(!reachable)("syncPlatformAccount", () => {
  let counter = 0;

  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.user.deleteMany({ where: { handle: { startsWith: HANDLE_PREFIX } } });
    await prisma.game.deleteMany({ where: { platformLinks: { some: { OR: CREATED_TITLES } } } });
    await prisma.game.deleteMany({
      where: { platformLinks: { some: { platform: "psn", externalId: { startsWith: FAKE_TITLE_PREFIX } } } },
    });
    await prisma.game.deleteMany({ where: { slug: "test-burst-filler" } });
  }

  /** Replaces the PSN fixture's library with `count` one-trophy titles (one failing, optionally). */
  async function fakePsnLibrary(count: number, failing?: string) {
    const { getPsn } = await import("@/lib/integrations");
    const psn = getPsn();
    const id = (i: number) => `${FAKE_TITLE_PREFIX}${String(i).padStart(2, "0")}`;
    const earnedAt = (i: number) => new Date(Date.UTC(2026, 0, 1 + i, 20));
    const titles = vi.spyOn(psn, "getTitles").mockResolvedValue(
      Array.from({ length: count }, (_, i) => ({
        npTitleId: id(i),
        serviceName: "trophy2" as const,
        name: `Resumo Teste ${id(i)}`,
        platform: "PS5",
        progress: 50,
        trophyCounts: { bronze: 2, silver: 0, gold: 0, platinum: 0 },
        earnedCounts: { bronze: 1, silver: 0, gold: 0, platinum: 0 },
        lastPlayed: earnedAt(i),
      })),
    );
    const trophies = vi.spyOn(psn, "getTrophies").mockImplementation(async (_account, npTitleId) => {
      if (npTitleId === failing) throw new Error("PSN title trophies failed with HTTP 500");
      const i = Number(npTitleId.slice(FAKE_TITLE_PREFIX.length));
      return [
        { trophyId: "1", name: "Um", description: null, iconUrl: null, hidden: false, tier: "bronze" as const, earned: true, earnedAt: earnedAt(i), rarityPct: 50 },
        { trophyId: "2", name: "Dois", description: null, iconUrl: null, hidden: false, tier: "bronze" as const, earned: false, earnedAt: null, rarityPct: 30 },
      ];
    });
    return {
      trophies,
      id,
      restore: () => {
        titles.mockRestore();
        trophies.mockRestore();
      },
    };
  }

  async function userWith(platform: string, externalId: string, handle: string, verified = true) {
    const { prisma } = await import("@/lib/db");
    counter++;
    // The fixtures have one public test account per platform: free it from earlier test users.
    await prisma.linkedAccount.deleteMany({
      where: { platform, externalId, user: { handle: { startsWith: HANDLE_PREFIX } } },
    });
    return prisma.user.create({
      data: {
        handle: `${HANDLE_PREFIX}${counter}`,
        displayName: "Teste",
        linkedAccounts: {
          create: { platform, externalId, handle, verifiedAt: verified ? new Date() : null },
        },
      },
    });
  }

  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("imports PSN trophies: XP by rarity, platinum bonus, games mapped and created, attributes", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const user = await userWith("psn", "9000000000000000002", "Tralked-Teste");

    const result = await syncPlatformAccount(user.id, "psn");
    expect(result.status).toBe("ok");
    expect(result.newUnlocks).toBe(8 + 4 + 2); // Hollow Knight (all), Hades, Astro Bot
    expect(result.levelBefore).toBe(1);
    expect(result.levelAfter).toBeGreaterThan(1);

    // Hollow Knight comes from the seeded platform link; Astro Bot is new to the catalog.
    const hk = await prisma.game.findUniqueOrThrow({ where: { slug: "hollow-knight" } });
    const hkGame = await prisma.userGame.findUniqueOrThrow({
      where: { userId_gameId_platform: { userId: user.id, gameId: hk.id, platform: "psn" } },
    });
    expect(hkGame.unlockedCount).toBe(8);
    expect(hkGame.completedAt).not.toBeNull();
    const astro = await prisma.gamePlatformLink.findUniqueOrThrow({
      where: { platform_externalId: { platform: "psn", externalId: "NPWR90004_00" } },
      include: { game: true },
    });
    expect(astro.game.name).toBe("Astro Bot");
    expect(astro.game.steamAppId).toBeNull();

    const ledger = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id } });
    expect(ledger.every((e) => e.platform === "psn")).toBe(true);
    expect(ledger.filter((e) => e.source === "achievement")).toHaveLength(14);

    // Exact XP of one trophy (gold at 4.8%) and of the platinum bonus.
    const hkTrophies = await prisma.achievement.findMany({ where: { gameId: hk.id, platform: "psn" } });
    const gold = hkTrophies.find((a) => a.apiName === "2")!;
    const goldEntry = ledger.find((e) => e.sourceKey === gold.id)!;
    expect(goldEntry.xp).toBe(
      xpForPlatformAchievement({ platform: "psn", globalPct: 4.8, points: null, trophyTier: "gold", hardcore: false }),
    );
    const platinum = ledger.find((e) => e.source === "platinum")!;
    // One platinum per version: the seeded Hollow Knight list is the PS4 one.
    expect(platinum.sourceKey).toBe(`psn:PS4:${hk.id}`);
    expect(platinum.xp).toBe(
      platinumBonus(
        hkTrophies.map((a) =>
          xpForPlatformAchievement({ platform: "psn", globalPct: a.globalPct, points: null, trophyTier: null, hardcore: false }),
        ),
      ),
    );

    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stats.totalXp).toBe(ledger.reduce((sum, e) => sum + e.xp, 0));
    const attributes = await prisma.attributeProgress.findMany({ where: { userId: user.id } });
    expect(attributes).toHaveLength(9);
    const gloria = attributes.find((a) => a.attribute === "gloria")!;
    // Native tiers: HK platinum 15 + 2 gold 10 + 2 silver 4 + 3 bronze 3 = 32;
    // Hades 1 silver + 3 bronze = 5; Astro Bot 2 bronze = 2 -> 39 glory points x 10.
    expect(gloria.points).toBe(390);

    const account = await prisma.linkedAccount.findUniqueOrThrow({
      where: { userId_platform: { userId: user.id, platform: "psn" } },
    });
    expect(account.lastSyncedAt).not.toBeNull();
  });

  it("records PSN play time of every played game (with or without trophies) and pays its hours once", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const { playtimeXp } = await import("@/lib/engine/playtime");
    const user = await userWith("psn", "9000000000000000002", "Tralked-Teste");
    await syncPlatformAccount(user.id, "psn");

    const hk = await prisma.game.findUniqueOrThrow({ where: { slug: "hollow-knight" } });
    const re4 = await prisma.game.findUniqueOrThrow({ where: { slug: "resident-evil-4" } });
    const library = await prisma.userGame.findMany({ where: { userId: user.id, platform: "psn" }, include: { game: true } });
    const byName = new Map(library.map((g) => [g.game.name, g]));
    expect(byName.get("Hollow Knight")).toMatchObject({ playtimeMin: 1500, unlockedCount: 8, lastPlayedAt: expect.any(Date) });
    // Played without a trophy, and a game the trophy list does not have at all.
    expect(byName.get("Resident Evil 4")).toMatchObject({ playtimeMin: 200, unlockedCount: 0 });
    expect(byName.get("Jornada Submersa")).toMatchObject({ playtimeMin: 75, unlockedCount: 0 });

    const hours = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id, source: "playtime" } });
    expect(hours.every((e) => e.platform === "psn")).toBe(true);
    expect(hours.filter((e) => e.sourceKey.startsWith(`psn:${hk.id}:`))).toHaveLength(3); // 5, 10, 25 h
    // Under 5 h pays nothing (3 h 20 min).
    expect(hours.filter((e) => e.sourceKey.startsWith(`psn:${re4.id}:`))).toEqual([]);
    expect(hours.reduce((s, e) => s + e.xp, 0)).toBe([1500, 905, 200, 610, 75].reduce((s, m) => s + playtimeXp(m), 0));

    // A second sync pays nothing new; unlinking voids the hours with the rest of the platform's XP.
    await syncPlatformAccount(user.id, "psn");
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, source: "playtime" } })).toBe(hours.length);
    const { unlink } = await import("@/lib/accounts/link");
    await unlink(user.id, "psn");
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, source: "playtime", voidedAt: null } })).toBe(0);
    expect(await prisma.userGame.count({ where: { userId: user.id } })).toBe(0);
  });

  it("records Xbox minutes played, also of titles without achievements", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const user = await userWith("xbox", "2535400000000002", "Tralked Teste");
    await syncPlatformAccount(user.id, "xbox");
    const library = await prisma.userGame.findMany({ where: { userId: user.id, platform: "xbox" }, include: { game: true } });
    const byName = new Map(library.map((g) => [g.game.name, g]));
    expect(byName.get("Hollow Knight")).toMatchObject({ playtimeMin: 720, unlockedCount: 3 });
    expect(byName.get("Resident Evil 4")).toMatchObject({ playtimeMin: 1830 });
    expect(byName.get("Forja Abissal")).toMatchObject({ playtimeMin: 140, unlockedCount: 0 });
    const hours = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id, source: "playtime" } });
    expect(hours.length).toBe(2 + 3 + 0); // 12 h, 30.5 h, 2.3 h
    expect(hours.every((e) => e.platform === "xbox")).toBe(true);

    // Nothing played since: the minutes are not asked again.
    const { getXbox } = await import("@/lib/integrations");
    const spy = vi.spyOn(getXbox(), "getMinutesPlayed");
    await syncPlatformAccount(user.id, "xbox");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("play time respects the deadline (resumes next run) and never asks IGDB for play-time-only titles", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const { getIgdb } = await import("@/lib/integrations");
    const findByName = vi.spyOn(getIgdb(), "findByName");
    const user = await userWith("psn", "9000000000000000002", "Tralked-Teste");

    // Out of time from the start: nothing read, the run is partial and not marked synced.
    const cut = await syncPlatformAccount(user.id, "psn", { deadline: 0 });
    expect(cut).toMatchObject({ status: "ok", partial: true });
    expect(await prisma.userGame.count({ where: { userId: user.id } })).toBe(0);
    expect((await prisma.linkedAccount.findFirstOrThrow({ where: { userId: user.id, platform: "psn" } })).lastSyncedAt).toBeNull();

    // The next run finishes it.
    expect(await syncPlatformAccount(user.id, "psn")).toMatchObject({ partial: false });
    expect(await prisma.userGame.count({ where: { userId: user.id, game: { name: "Jornada Submersa" } } })).toBe(1);
    // "Jornada Submersa" only has play time: created from the platform's name, IGDB never asked.
    expect(findByName.mock.calls.map(([name]) => name)).not.toContain("Jornada Submersa");
    findByName.mockRestore();
  });

  it("a play-time title named exactly like a catalog stub links to the stub, no duplicate game", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const { getPsn } = await import("@/lib/integrations");
    const stub = await prisma.game.findUniqueOrThrow({ where: { slug: "lanterna-do-farol" } });
    expect(stub.stub).toBe(true);
    // The indexed lookup (lower(name) on stubs) ignores case and trademark signs, nothing else.
    const { findStubByName } = await import("./platform-games");
    expect(await findStubByName("lanterna DO farol™")).toBe(stub.id);
    expect(await findStubByName("Lanterna")).toBeNull();
    expect(await findStubByName("Hollow Knight")).toBeNull(); // a listed game, not a stub
    const played = vi.spyOn(getPsn(), "getPlayedGames").mockResolvedValue([
      {
        titleId: "PPSATEST9_00",
        name: "LANTERNA DO FAROL",
        category: "ps5_native_game",
        playtimeMin: 400,
        firstPlayedAt: null,
        lastPlayedAt: new Date("2026-09-20T20:00:00Z"),
        conceptId: null,
        conceptTitleIds: [],
        conceptName: null,
      },
    ]);
    try {
      const user = await userWith("psn", "9000000000000000002", "Tralked-Teste");
      await syncPlatformAccount(user.id, "psn");
      expect(await prisma.game.count({ where: { name: { equals: "Lanterna do Farol", mode: "insensitive" } } })).toBe(1);
      expect(
        await prisma.userGame.findUniqueOrThrow({
          where: { userId_gameId_platform: { userId: user.id, gameId: stub.id, platform: "psn" } },
        }),
      ).toMatchObject({ playtimeMin: 400 });
    } finally {
      played.mockRestore();
      await prisma.gamePlatformLink.deleteMany({ where: { platform: "psn", externalId: "PPSATEST9_00" } });
    }
  });

  it("Xbox titles without minutes are remembered and not asked again until played again", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const { getXbox } = await import("@/lib/integrations");
    const xbox = getXbox();
    const user = await userWith("xbox", "2535400000000002", "Tralked Teste");
    // Xbox has no number for any title (0 or missing).
    const minutes = vi.spyOn(xbox, "getMinutesPlayed").mockResolvedValue(new Map([["90000005", 0]]));
    try {
      await syncPlatformAccount(user.id, "xbox");
      expect(minutes).toHaveBeenCalledTimes(1);
      expect(await prisma.userGame.count({ where: { userId: user.id, game: { name: "Forja Abissal" } } })).toBe(0);
      await syncPlatformAccount(user.id, "xbox");
      expect(minutes).toHaveBeenCalledTimes(1);

      // Played again (later last play): asked again, for that title only.
      const titles = await xbox.getTitles("2535400000000002");
      if (titles === "private") throw new Error("public fixture");
      const later = vi.spyOn(xbox, "getTitles").mockResolvedValue(
        titles.map((t) => (t.titleId === "90000005" ? { ...t, lastPlayed: new Date("2026-10-30T20:00:00Z") } : t)),
      );
      await syncPlatformAccount(user.id, "xbox");
      expect(minutes).toHaveBeenCalledTimes(2);
      expect(minutes.mock.calls[1][1]).toEqual(["90000005"]);
      later.mockRestore();
    } finally {
      minutes.mockRestore();
    }
  });

  it("an Xbox title that returns no achievements is read once, and not on the next sync", async () => {
    const { syncPlatformAccount } = await import("./platform-user");
    const { getXbox } = await import("@/lib/integrations");
    const xbox = getXbox();
    const user = await userWith("xbox", "2535400000000002", "Tralked Teste");
    const titles = await xbox.getTitles("2535400000000002");
    if (titles === "private") throw new Error("public fixture");
    const listed = titles.filter((t) => t.currentAchievements > 0).length;
    expect(listed).toBeGreaterThan(0);
    const read = vi.spyOn(xbox, "getAchievements").mockResolvedValue([]);
    try {
      await syncPlatformAccount(user.id, "xbox");
      expect(read).toHaveBeenCalledTimes(listed);
      await syncPlatformAccount(user.id, "xbox");
      expect(read).toHaveBeenCalledTimes(listed);
    } finally {
      read.mockRestore();
    }
  });

  it("a remembered empty Xbox title is read again when its listed count changes", async () => {
    const { syncPlatformAccount } = await import("./platform-user");
    const { getXbox } = await import("@/lib/integrations");
    const xbox = getXbox();
    const user = await userWith("xbox", "2535400000000002", "Tralked Teste");
    const titles = await xbox.getTitles("2535400000000002");
    if (titles === "private") throw new Error("public fixture");
    const listed = titles.filter((t) => t.currentAchievements > 0);
    const read = vi.spyOn(xbox, "getAchievements").mockResolvedValue([]);
    try {
      await syncPlatformAccount(user.id, "xbox");
      await syncPlatformAccount(user.id, "xbox");
      expect(read).toHaveBeenCalledTimes(listed.length);
      const bumped = vi.spyOn(xbox, "getTitles").mockResolvedValue(
        titles.map((t) => (t.titleId === listed[0].titleId ? { ...t, currentAchievements: t.currentAchievements + 1 } : t)),
      );
      await syncPlatformAccount(user.id, "xbox");
      expect(read).toHaveBeenCalledTimes(listed.length + 1);
      expect(read.mock.calls.at(-1)?.[1]).toBe(listed[0].titleId);
      bumped.mockRestore();
    } finally {
      read.mockRestore();
    }
  });

  it("a 360 title remembered empty before 360 lists were read is read once more, with its real total", async () => {
    // Until the 360 routes were joined, a 360 title came back empty from the player route and was
    // remembered as "read, no achievements" (version 1): those entries are stale now.
    const { prisma } = await import("@/lib/db");
    const { getXbox } = await import("@/lib/integrations");
    const { syncPlatformAccount, titleMemoryKey } = await import("./platform-user");
    const xbox = getXbox();
    const devices = ["Xbox360", "XboxOne", "XboxSeries"];
    const titles = vi.spyOn(xbox, "getTitles").mockResolvedValue([
      {
        titleId: "90000773",
        name: "Trezentos e Sessenta Teste",
        currentAchievements: 2,
        totalAchievements: 5,
        currentGamerscore: 20,
        totalGamerscore: 50,
        progress: 40,
        lastPlayed: new Date("2011-03-01T20:00:00Z"),
        devices,
      },
    ]);
    const achievements = vi.spyOn(xbox, "getAchievements").mockImplementation(async () =>
      ["1", "2", "3", "4", "5"].map((id, i) => ({
        id,
        name: `Conquista ${id}`,
        description: null,
        iconUrl: null,
        hidden: false,
        gamerscore: 10,
        unlocked: i < 2,
        unlockedAt: i < 2 ? new Date(Date.UTC(2011, 1, 1 + i * 30, 20)) : null,
        rarityPct: 30,
      })),
    );
    const user = await userWith("xbox", "2535400000000002", "Tralked Teste");
    const account = await prisma.linkedAccount.findUniqueOrThrow({ where: { userId_platform: { userId: user.id, platform: "xbox" } } });
    await prisma.syncCursor.create({
      data: {
        key: titleMemoryKey(account.id),
        value: { externalId: account.externalId, linkedAt: account.linkedAt!.toISOString(), titles: {}, empty: { "90000773": { c: [2], v: 1 } } },
      },
    });
    try {
      await expect(syncPlatformAccount(user.id, "xbox")).resolves.toMatchObject({ status: "ok", newUnlocks: 2 });
      expect(achievements.mock.calls.map((c) => [c[1], c[2]])).toEqual([["90000773", devices]]);
      const list = await prisma.trophyList.findUniqueOrThrow({ where: { platform_externalId: { platform: "xbox", externalId: "90000773" } } });
      expect([list.console, list.trophyCount]).toEqual(["360", 5]);
      await expect(
        prisma.userTrophyList.findUniqueOrThrow({ where: { userId_listId: { userId: user.id, listId: list.id } } }),
      ).resolves.toMatchObject({ unlockedCount: 2, completedAt: null });
      // The 360 title is its own version: its two trophies pay XP, with the dates Xbox gave.
      const ledger = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id, voidedAt: null, platform: "xbox", source: "achievement" } });
      expect(ledger).toHaveLength(2);
      const unlocks = await prisma.userAchievement.findMany({ where: { userId: user.id }, orderBy: { unlockedAt: "asc" } });
      expect(unlocks.map((u) => [u.unlockedAt?.toISOString(), u.suspicious])).toEqual([
        ["2011-02-01T20:00:00.000Z", false],
        ["2011-03-03T20:00:00.000Z", false],
      ]);
      await expect(syncPlatformAccount(user.id, "xbox")).resolves.toMatchObject({ titles: { read: 0, upToDate: 1 } });
      expect(achievements).toHaveBeenCalledTimes(1);
    } finally {
      titles.mockRestore();
      achievements.mockRestore();
      await prisma.syncCursor.deleteMany({ where: { key: titleMemoryKey(account.id) } });
    }
  });

  it("a 360 title whose read failed is retried at most once a day, and forgotten once read", async () => {
    // Two requests per try on OpenXBL's shared 150-an-hour quota: a title that keeps failing waits.
    const { prisma } = await import("@/lib/db");
    const { getXbox } = await import("@/lib/integrations");
    const { syncPlatformAccount, titleMemoryKey } = await import("./platform-user");
    const xbox = getXbox();
    const titles = vi.spyOn(xbox, "getTitles").mockResolvedValue([
      {
        titleId: "90000774",
        name: "Trezentos Falhando Teste",
        currentAchievements: 1,
        totalAchievements: 2,
        currentGamerscore: 10,
        totalGamerscore: 20,
        progress: 50,
        lastPlayed: new Date("2011-03-01T20:00:00Z"),
        devices: ["Xbox360"],
      },
      {
        titleId: "90000001",
        name: "Hollow Knight",
        currentAchievements: 1,
        totalAchievements: 0,
        currentGamerscore: 0,
        totalGamerscore: 0,
        progress: 0,
        lastPlayed: new Date("2026-01-12T20:00:00Z"),
        devices: ["XboxOne"],
      },
    ]);
    let failing = true;
    const achievements = vi.spyOn(xbox, "getAchievements").mockImplementation(async (_xuid, titleId) => {
      if (titleId !== "90000774") {
        return [{ id: "1", name: "Um", description: null, iconUrl: null, hidden: false, gamerscore: 5, unlocked: true, unlockedAt: new Date("2026-01-12T20:00:00Z"), rarityPct: null }];
      }
      if (failing) throw new Error("Xbox 360 title 90000774: earned achievement(s) 9 not in its list");
      return ["1", "2"].map((id, i) => ({
        id,
        name: `Conquista ${id}`,
        description: null,
        iconUrl: null,
        hidden: false,
        gamerscore: 10,
        unlocked: i === 0,
        unlockedAt: i === 0 ? new Date("2011-02-01T20:00:00Z") : null,
        rarityPct: null,
      }));
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const reads = () => achievements.mock.calls.filter((c) => c[1] === "90000774").length;
    const user = await userWith("xbox", "2535400000000002", "Tralked Teste");
    const account = await prisma.linkedAccount.findUniqueOrThrow({ where: { userId_platform: { userId: user.id, platform: "xbox" } } });
    const t0 = new Date("2026-11-06T12:00:00Z");
    const hours = (h: number) => new Date(t0.getTime() + h * 3_600_000);
    try {
      await syncPlatformAccount(user.id, "xbox", { now: t0 });
      expect(reads()).toBe(1);
      await syncPlatformAccount(user.id, "xbox", { now: hours(1) });
      await syncPlatformAccount(user.id, "xbox", { now: hours(23) });
      expect(reads()).toBe(1);
      await syncPlatformAccount(user.id, "xbox", { now: hours(25) });
      expect(reads()).toBe(2);
      failing = false;
      await syncPlatformAccount(user.id, "xbox", { now: hours(26) });
      expect(reads()).toBe(2);
      await syncPlatformAccount(user.id, "xbox", { now: hours(50) });
      expect(reads()).toBe(3);
      const list = await prisma.trophyList.findUniqueOrThrow({ where: { platform_externalId: { platform: "xbox", externalId: "90000774" } } });
      expect(list.trophyCount).toBe(2);
      const memory = await prisma.syncCursor.findUniqueOrThrow({ where: { key: titleMemoryKey(account.id) } });
      expect((memory.value as { failed?: Record<string, number> }).failed ?? {}).toEqual({});
      await syncPlatformAccount(user.id, "xbox", { now: hours(51) });
      expect(reads()).toBe(3);
    } finally {
      titles.mockRestore();
      achievements.mockRestore();
      errors.mockRestore();
      await prisma.syncCursor.deleteMany({ where: { key: titleMemoryKey(account.id) } });
    }
  });

  it("the Xbox 360 memory change leaves remembered empty PSN titles alone", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount, titleMemoryKey } = await import("./platform-user");
    const fake = await fakePsnLibrary(1);
    const user = await userWith("psn", "test-empty-psn-memory", "Vazio-Teste");
    const account = await prisma.linkedAccount.findUniqueOrThrow({ where: { userId_platform: { userId: user.id, platform: "psn" } } });
    // Remembered "read, no achievements" before the Xbox 360 change (version 1).
    await prisma.syncCursor.create({
      data: {
        key: titleMemoryKey(account.id),
        value: { externalId: account.externalId, linkedAt: account.linkedAt!.toISOString(), titles: {}, empty: { [fake.id(0)]: { c: [1], v: 1 } } },
      },
    });
    try {
      await syncPlatformAccount(user.id, "psn");
      expect(fake.trophies).not.toHaveBeenCalled();
    } finally {
      fake.restore();
      await prisma.syncCursor.deleteMany({ where: { key: titleMemoryKey(account.id) } });
    }
  });

  it("an Xbox title whose read failed (404, unexpected body) is not remembered and is retried", async () => {
    const { syncPlatformAccount } = await import("./platform-user");
    const { getXbox } = await import("@/lib/integrations");
    const xbox = getXbox();
    const user = await userWith("xbox", "2535400000000002", "Tralked Teste");
    const titles = await xbox.getTitles("2535400000000002");
    if (titles === "private") throw new Error("public fixture");
    const listed = titles.filter((t) => t.currentAchievements > 0).length;
    const read = vi.spyOn(xbox, "getAchievements").mockRejectedValue(new Error("Xbox achievements: not found"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await syncPlatformAccount(user.id, "xbox").catch(() => {});
      await syncPlatformAccount(user.id, "xbox").catch(() => {});
      expect(read).toHaveBeenCalledTimes(listed * 2);
    } finally {
      read.mockRestore();
      errors.mockRestore();
    }
  });

  it("Xbox titles with minutes left unwritten by the deadline are asked again next run", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const { getXbox } = await import("@/lib/integrations");
    const xbox = getXbox();
    const real = xbox.getMinutesPlayed.bind(xbox);
    const user = await userWith("xbox", "2535400000000002", "Tralked Teste");
    // The minutes arrive after the run's deadline: nothing can be written this run.
    const minutes = vi.spyOn(xbox, "getMinutesPlayed").mockImplementation(async (xuid, ids) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return real(xuid, ids);
    });
    try {
      const cut = await syncPlatformAccount(user.id, "xbox", { deadline: Date.now() + 250 });
      expect(cut.partial).toBe(true);
      expect(await prisma.userGame.count({ where: { userId: user.id, playtimeMin: { gt: 0 } } })).toBe(0);
      const row = await prisma.linkedAccount.findFirstOrThrow({ where: { userId: user.id, platform: "xbox" } });
      // Every fixture title had minutes, none was written: none is remembered.
      expect(Object.keys((row.minutesChecked ?? {}) as object)).toEqual([]);

      await syncPlatformAccount(user.id, "xbox");
      expect(minutes).toHaveBeenCalledTimes(2);
      expect([...minutes.mock.calls[1][1]].sort()).toEqual(["90000001", "90000003", "90000005"]);
      expect(await prisma.userGame.count({ where: { userId: user.id, playtimeMin: { gt: 0 } } })).toBe(3);
    } finally {
      minutes.mockRestore();
    }
  });

  it("a full resync in passes (skipTitles) does not ask again the minutes already asked", async () => {
    const { syncPlatformAccount } = await import("./platform-user");
    const { getXbox } = await import("@/lib/integrations");
    const user = await userWith("xbox", "2535400000000002", "Tralked Teste");
    await syncPlatformAccount(user.id, "xbox");
    const spy = vi.spyOn(getXbox(), "getMinutesPlayed");
    try {
      // Every title was asked: a pass of the finish resync moves on (more than 250 titles would
      // otherwise keep every pass partial).
      await expect(syncPlatformAccount(user.id, "xbox", { full: true, skipTitles: new Set() })).resolves.toMatchObject({ partial: false });
      expect(spy).not.toHaveBeenCalled();
      // A plain full sync still asks them all.
      await syncPlatformAccount(user.id, "xbox", { full: true });
      expect([...spy.mock.calls[0][1]].sort()).toEqual(["90000001", "90000003", "90000005"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("unlinking Xbox clears the titles already asked (a relink asks them again); deleting the account removes them", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const { unlink } = await import("@/lib/accounts/link");
    const { exportUserData } = await import("@/lib/accounts/export");
    const { getXbox } = await import("@/lib/integrations");
    const user = await userWith("xbox", "2535400000000002", "Tralked Teste");
    await syncPlatformAccount(user.id, "xbox");
    const linked = await prisma.linkedAccount.findFirstOrThrow({ where: { userId: user.id, platform: "xbox" } });
    expect(Object.keys((linked.minutesChecked ?? {}) as object).sort()).toEqual(["90000001", "90000003", "90000005"]);
    // LGPD export carries it with the connection.
    const exported = await exportUserData(user.id);
    expect(JSON.stringify(exported)).toContain("90000005");

    expect(await unlink(user.id, "xbox")).toBe(true);
    expect((await prisma.linkedAccount.findFirstOrThrow({ where: { userId: user.id, platform: "xbox" } })).minutesChecked).toBeNull();

    // Linked again: every title is asked again (its hours come back).
    await prisma.linkedAccount.update({
      where: { id: linked.id },
      data: { externalId: "2535400000000002", linkedAt: new Date(), handle: "Tralked Teste" },
    });
    const spy = vi.spyOn(getXbox(), "getMinutesPlayed");
    try {
      await syncPlatformAccount(user.id, "xbox");
      expect([...spy.mock.calls[0][1]].sort()).toEqual(["90000001", "90000003", "90000005"]);
    } finally {
      spy.mockRestore();
    }

    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.linkedAccount.count({ where: { id: linked.id } })).toBe(0);
  });

  it("is idempotent: a second sync adds nothing", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const first = await userWith("xbox", "2535400000000002", "Tralked Teste");
    await syncPlatformAccount(first.id, "xbox");
    const before = await prisma.xpLedgerEntry.findMany({ where: { userId: first.id } });
    const again = await syncPlatformAccount(first.id, "xbox");
    expect(again.newUnlocks).toBe(0);
    const after = await prisma.xpLedgerEntry.findMany({ where: { userId: first.id } });
    expect(after).toHaveLength(before.length);
  });

  it("pays Xbox achievements with the gamerscore rule", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const user = await userWith("xbox", "2535400000000002", "Tralked Teste");
    await syncPlatformAccount(user.id, "xbox");

    const re4 = await prisma.game.findUniqueOrThrow({ where: { slug: "resident-evil-4" } });
    const firm = await prisma.achievement.findFirstOrThrow({
      where: { gameId: re4.id, platform: "xbox", apiName: "2" },
    });
    expect(firm.points).toBe(80);
    const entry = await prisma.xpLedgerEntry.findUniqueOrThrow({
      where: { userId_source_sourceKey: { userId: user.id, source: "achievement", sourceKey: firm.id } },
    });
    // max(xpForAchievement(5.3) = 10324, 80 G x 120 = 9600)
    expect(entry.xp).toBe(10324);
    expect(entry.xp).toBe(
      xpForPlatformAchievement({ platform: "xbox", globalPct: 5.3, points: 80, trophyTier: null, hardcore: false }),
    );
    expect(entry.platform).toBe("xbox");
  });

  it("records RetroAchievements hardcore unlocks with the hardcore bonus", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const user = await userWith("retro", "01JTRALKED00000000000TESTE", "TralkedTeste");
    const result = await syncPlatformAccount(user.id, "retro");
    expect(result.newUnlocks).toBe(3);

    const unlocks = await prisma.userAchievement.findMany({
      where: { userId: user.id },
      include: { achievement: true },
    });
    const byName = new Map(unlocks.map((u) => [u.achievement.name, u]));
    expect(byName.get("Sem anéis")?.hardcore).toBe(true);
    expect(byName.get("Esmeralda")?.hardcore).toBe(false);

    const hardcoreEntry = await prisma.xpLedgerEntry.findUniqueOrThrow({
      where: {
        userId_source_sourceKey: { userId: user.id, source: "achievement", sourceKey: byName.get("Sem anéis")!.achievementId },
      },
    });
    expect(hardcoreEntry.xp).toBe(
      xpForPlatformAchievement({ platform: "retro", globalPct: 3.2, points: 25, trophyTier: null, hardcore: true }),
    );
    // Precisão: one rare (3.2% <= 5%) hardcore unlock -> 30 + 15.
    const precisao = await prisma.attributeProgress.findUniqueOrThrow({
      where: { userId_attribute: { userId: user.id, attribute: "precisao" } },
    });
    expect(precisao.points).toBe(45);
    const sonic = await prisma.userGame.findFirstOrThrow({ where: { userId: user.id, platform: "retro" } });
    expect(sonic.playtimeMin).toBe(300);
  });

  it("reports private profiles, syncs active links even when unverified, and skips inactive rows", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount, syncStalePlatformAccounts } = await import("./platform-user");
    const closed = await userWith("psn", "9000000000000000003", "Perfil-Fechado");
    await expect(syncPlatformAccount(closed.id, "psn")).resolves.toMatchObject({ status: "private", newUnlocks: 0 });

    // Linked by typing the gamertag (Exophase model): no proof, but it syncs and pays XP.
    const typed = await userWith("xbox", "2535400000000002", "Tralked Teste", false);
    const result = await syncPlatformAccount(typed.id, "xbox");
    expect(result).toMatchObject({ status: "ok" });
    expect(result.newUnlocks).toBeGreaterThan(0);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: typed.id, voidedAt: null } })).toBeGreaterThan(0);

    // An inactive row (unlinked, or a claim waiting for its code) is never read.
    counter++;
    const inactive = await prisma.user.create({ data: { handle: `${HANDLE_PREFIX}${counter}`, displayName: "Teste" } });
    await prisma.linkedAccount.create({
      data: { userId: inactive.id, platform: "xbox", externalId: `pending:${inactive.id}`, handle: "Tralked Teste", linkedAt: null, verifyCode: "TRK-AAAAAA" },
    });
    await expect(syncPlatformAccount(inactive.id, "xbox")).resolves.toMatchObject({ status: "unlinked" });
    expect(await prisma.xpLedgerEntry.count({ where: { userId: inactive.id } })).toBe(0);
    // Nor picked by the cron.
    await expect(syncStalePlatformAccounts({ where: { userId: inactive.id } })).resolves.toEqual({ processed: 0, failed: 0 });
  });

  it("the cron skips platforms without a credential in production (never their fixtures)", async () => {
    const { syncStalePlatformAccounts } = await import("./platform-user");
    const user = await userWith("psn", "9000000000000000002", "Tralked-Teste");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLATFORM_FIXTURES", "");
    try {
      await expect(syncStalePlatformAccounts({ where: { userId: user.id } })).resolves.toEqual({ processed: 0, failed: 0 });
    } finally {
      vi.unstubAllEnvs();
    }
    await expect(syncStalePlatformAccounts({ where: { userId: user.id } })).resolves.toEqual({ processed: 1, failed: 0 });
  });

  it("voids confirmed fraud: XP, platinum and level drop and stay down after a new sync", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const { voidFraudEntries } = await import("@/lib/progression/recompute");
    const user = await userWith("psn", "9000000000000000002", "Tralked-Teste");
    await syncPlatformAccount(user.id, "psn");
    const before = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });

    const hk = await prisma.game.findUniqueOrThrow({ where: { slug: "hollow-knight" } });
    const platinumTrophy = await prisma.achievement.findFirstOrThrow({
      where: { gameId: hk.id, platform: "psn", apiName: "1" },
    });
    const voided = await voidFraudEntries(user.id, [platinumTrophy.id]);
    expect(voided).toBe(2); // the trophy and the game's platinum bonus

    const after = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    const lost = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id, voidedAt: { not: null } } });
    expect(after.totalXp).toBe(before.totalXp - lost.reduce((sum, e) => sum + e.xp, 0));
    expect(after.level).toBeLessThanOrEqual(before.level);

    // The tainted 100% is no completion: no Coleção, and Glória loses the voided platinum
    // trophy without getting a synthetic one (390 - 150).
    const attribute = async (id: string) =>
      (await prisma.attributeProgress.findUniqueOrThrow({
        where: { userId_attribute: { userId: user.id, attribute: id } },
      })).points;
    const hkGame = () =>
      prisma.userGame.findUniqueOrThrow({
        where: { userId_gameId_platform: { userId: user.id, gameId: hk.id, platform: "psn" } },
      });
    expect((await hkGame()).completedAt).toBeNull();
    expect(await attribute("colecao")).toBe(0);
    expect(await attribute("gloria")).toBe(240);

    // A full re-read of every title changes nothing: the verdict and the voids are sticky.
    await syncPlatformAccount(user.id, "psn", { full: true });
    const resynced = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    expect(resynced.totalXp).toBe(after.totalXp);
    const unlock = await prisma.userAchievement.findUniqueOrThrow({
      where: { userId_achievementId: { userId: user.id, achievementId: platinumTrophy.id } },
    });
    expect(unlock.suspicious).toBe(true);
    expect((await hkGame()).completedAt).toBeNull();
    expect(await attribute("colecao")).toBe(0);
  });

  it("gives undated unlocks their first-seen time once: later syncs move neither date nor active days", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const user = await userWith("psn", "9000000000000000004", "Sem-Data");
    const t1 = new Date("2026-10-20T12:00:00Z");
    const t2 = new Date("2026-10-22T12:00:00Z");

    await syncPlatformAccount(user.id, "psn", { now: t1 });
    const first = await prisma.userAchievement.findMany({ where: { userId: user.id } });
    expect(first).toHaveLength(14);
    expect(first.every((u) => u.unlockedAt?.getTime() === t1.getTime())).toBe(true);
    // 14 unlocks at one instant would be a burst, but undated unlocks are not burst evidence.
    expect(first.every((u) => !u.suspicious)).toBe(true);
    const constancia = () =>
      prisma.attributeProgress.findUniqueOrThrow({
        where: { userId_attribute: { userId: user.id, attribute: "constancia" } },
      });
    const before = await constancia();

    await syncPlatformAccount(user.id, "psn", { now: t2, full: true });
    const second = await prisma.userAchievement.findMany({ where: { userId: user.id } });
    expect(second.every((u) => u.unlockedAt?.getTime() === t1.getTime())).toBe(true);
    expect((await constancia()).points).toBe(before.points);
  });

  it("is incremental: titles without activity since the last sync are not read again", async () => {
    const { prisma } = await import("@/lib/db");
    const { getPsn } = await import("@/lib/integrations");
    const { syncPlatformAccount } = await import("./platform-user");
    const user = await userWith("psn", "9000000000000000002", "Tralked-Teste");
    await syncPlatformAccount(user.id, "psn");
    const account = await prisma.linkedAccount.findUniqueOrThrow({
      where: { userId_platform: { userId: user.id, platform: "psn" } },
    });
    expect(account.lastSyncedAt).not.toBeNull();

    const reads = vi.spyOn(getPsn(), "getTrophies");
    await syncPlatformAccount(user.id, "psn");
    expect(reads).not.toHaveBeenCalled();
    await syncPlatformAccount(user.id, "psn", { full: true });
    expect(reads).toHaveBeenCalledTimes(3);
    reads.mockRestore();
  });

  it("resumes interrupted runs: 12 titles at 5 per run finish in 3 runs", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const fake = await fakePsnLibrary(12);
    try {
      const user = await userWith("psn", "test-resume-account", "Resumo-Teste");
      const synced = async () => {
        const account = await prisma.linkedAccount.findUniqueOrThrow({
          where: { userId_platform: { userId: user.id, platform: "psn" } },
        });
        const games = await prisma.userGame.count({ where: { userId: user.id, platform: "psn" } });
        return { games, lastSyncedAt: account.lastSyncedAt };
      };

      await expect(syncPlatformAccount(user.id, "psn", { maxTitles: 5 })).resolves.toMatchObject({ partial: true, newUnlocks: 5 });
      await expect(synced()).resolves.toEqual({ games: 5, lastSyncedAt: null });
      await expect(syncPlatformAccount(user.id, "psn", { maxTitles: 5 })).resolves.toMatchObject({ partial: true, newUnlocks: 5 });
      await expect(synced()).resolves.toEqual({ games: 10, lastSyncedAt: null });
      await expect(syncPlatformAccount(user.id, "psn", { maxTitles: 5 })).resolves.toMatchObject({ partial: false, newUnlocks: 2 });
      const done = await synced();
      expect(done.games).toBe(12);
      expect(done.lastSyncedAt).not.toBeNull();
      // Oldest first, never the same title twice.
      const order = fake.trophies.mock.calls.map((c) => c[1]);
      expect(order).toEqual(Array.from({ length: 12 }, (_, i) => fake.id(i)));

      fake.trophies.mockClear();
      await syncPlatformAccount(user.id, "psn", { maxTitles: 5 });
      expect(fake.trophies).not.toHaveBeenCalled();
    } finally {
      fake.restore();
    }
  });

  it("reports the titles it recorded and those it could not read; skipTitles are not read", async () => {
    const { syncPlatformAccount } = await import("./platform-user");
    const fake = await fakePsnLibrary(3, `${FAKE_TITLE_PREFIX}01`);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const user = await userWith("psn", "test-skip-account", "Pula-Teste");
      const first = await syncPlatformAccount(user.id, "psn", { full: true, skipTitles: new Set([fake.id(2)]) });
      expect(first).toMatchObject({ status: "ok", partial: false, recordedTitles: [fake.id(0)], failedTitles: [fake.id(1)] });
      expect(fake.trophies.mock.calls.map((c) => c[1])).toEqual([fake.id(0), fake.id(1)]);
    } finally {
      logged.mockRestore();
      fake.restore();
    }
  });

  it("a permanently failing title is retried but does not block lastSyncedAt", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const fake = await fakePsnLibrary(3, `${FAKE_TITLE_PREFIX}01`);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const user = await userWith("psn", "test-resume-account", "Resumo-Teste");
      const lastSyncedAt = async () =>
        (await prisma.linkedAccount.findUniqueOrThrow({
          where: { userId_platform: { userId: user.id, platform: "psn" } },
        })).lastSyncedAt;

      await expect(syncPlatformAccount(user.id, "psn", { now: new Date("2026-10-30T10:00:00Z") })).resolves.toMatchObject({
        status: "ok",
        partial: false,
        newUnlocks: 2,
      });
      expect(await lastSyncedAt()).toEqual(new Date("2026-10-30T10:00:00Z"));

      fake.trophies.mockClear();
      await syncPlatformAccount(user.id, "psn", { now: new Date("2026-10-31T10:00:00Z") });
      // Only the failing title is read again, and the account still counts as synced.
      expect(fake.trophies.mock.calls.map((c) => c[1])).toEqual([`${FAKE_TITLE_PREFIX}01`]);
      expect(await lastSyncedAt()).toEqual(new Date("2026-10-31T10:00:00Z"));
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
      fake.restore();
    }
  });

  it("an answer with another list's trophies is a failed read; a list stored with them is read again and rebuilt", async () => {
    // Production, 11-05: Sony answered Guns, Gore and Cannoli's definitions with The Crew 2's list
    // (in Arabic); the sync wrote it as the list's own (35 rows, a platinum) and never read it again.
    const { prisma } = await import("@/lib/db");
    const { getPsn } = await import("@/lib/integrations");
    const { syncPlatformAccount } = await import("./platform-user");
    const psn = getPsn();
    const id = `${FAKE_TITLE_PREFIX}GGC`;
    const at = new Date(Date.UTC(2026, 0, 6, 20));
    const title = {
      npTitleId: id,
      serviceName: "trophy" as const,
      name: "Canhões Teste",
      platform: "PS4",
      progress: 66,
      trophyCounts: { bronze: 3, silver: 0, gold: 0, platinum: 0 },
      earnedCounts: { bronze: 2, silver: 0, gold: 0, platinum: 0 },
      lastPlayed: at,
    };
    const trophy = (tid: string, i: number) => ({
      trophyId: tid,
      description: null,
      hidden: false,
      earned: i < 2,
      earnedAt: i < 2 ? at : null,
      rarityPct: 40 - i,
    });
    const right = ["0", "1", "2"].map((tid, i) => ({ ...trophy(tid, i), name: `Certo ${tid}`, iconUrl: null, tier: "bronze" as const }));
    // Another list's definitions; the earned part (asked per user) is still this list's.
    const wrongTiers = ["platinum", "gold", "silver", "silver"] as const;
    const wrong = ["0", "1", "2", "3"].map((tid, i) => ({
      ...trophy(tid, i),
      name: `Errado ${tid}`,
      iconUrl: `https://image.api.playstation.com/trophy/np/NPWR99904_00_00D20733C8935EA453/${tid}.PNG`,
      tier: wrongTiers[i],
    }));
    // A second, sound title: a sync whose every title fails is an outage (it throws).
    const other = { ...title, npTitleId: `${id}_OK`, name: "Outro Teste", lastPlayed: new Date(at.getTime() - 86_400_000) };
    let answer: PsnTrophy[] = wrong;
    const titles = vi.spyOn(psn, "getTitles").mockResolvedValue([title, other]);
    const trophies = vi.spyOn(psn, "getTrophies").mockImplementation(async (_account, npTitleId) => (npTitleId === id ? answer : right));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const user = await userWith("psn", "test-foreign-list-account", "Lista-Alheia-Teste");
      const where = { platform_externalId: { platform: "psn", externalId: id } };

      // 1. The wrong answer is a failed read: nothing written, retried on the next run.
      await expect(syncPlatformAccount(user.id, "psn")).resolves.toMatchObject({ status: "ok", recordedTitles: [other.npTitleId], failedTitles: [id] });
      expect(await prisma.trophyList.findUnique({ where })).toBeNull();
      const line = logged.mock.calls.find((c) => String(c[0]).includes(id));
      expect(String((line?.[1] as Error).message)).toMatch(/do not match.*4 trophies.*defines 3.*icons of NPWR99904_00/);
      trophies.mockClear();
      await syncPlatformAccount(user.id, "psn");
      expect(trophies.mock.calls.map((c) => c[1])).toEqual([id]);

      // 2. Sony answers right: the list is recorded.
      answer = right;
      await expect(syncPlatformAccount(user.id, "psn")).resolves.toMatchObject({ recordedTitles: [id], failedTitles: [] });
      const list = await prisma.trophyList.findUniqueOrThrow({ where });
      const rowsOf = () =>
        prisma.achievement.findMany({ where: { listId: list.id }, orderBy: { apiName: "asc" }, select: { id: true, apiName: true, name: true, trophyTier: true } });
      const good = await rowsOf();
      expect(good.map((r) => [r.apiName, r.trophyTier])).toEqual([["0", "bronze"], ["1", "bronze"], ["2", "bronze"]]);
      const ledger = () =>
        prisma.xpLedgerEntry.findMany({ where: { userId: user.id, source: "achievement", sourceKey: { in: good.map((r) => r.id) } }, orderBy: { sourceKey: "asc" }, select: { sourceKey: true, xp: true, voidedAt: true } });
      const paid = await ledger();
      expect(paid).toHaveLength(2);

      // 3. The list as the sync stored it before this guard: the wrong definitions over the rows.
      for (const [i, r] of good.entries()) {
        await prisma.achievement.update({ where: { id: r.id }, data: { name: `Errado ${r.apiName}`, trophyTier: wrongTiers[i] } });
      }
      await prisma.achievement.create({
        data: { gameId: list.gameId, platform: "psn", listId: list.id, apiName: "3", name: "Errado 3", trophyTier: "silver" },
      });
      await prisma.trophyList.update({ where: { id: list.id }, data: { trophyCount: 4 } });

      // The listed counts still match (2 earned): the stored tiers differ from definedTrophies, so it is read again.
      trophies.mockClear();
      await syncPlatformAccount(user.id, "psn");
      expect(trophies.mock.calls.map((c) => c[1])).toEqual([id]);
      const rebuilt = await rowsOf();
      expect(rebuilt).toEqual(good);
      expect((await prisma.trophyList.findUniqueOrThrow({ where })).trophyCount).toBe(3);
      // XP of PSN trophies with a rarity does not depend on the tier: the ledger is as it was.
      expect(await ledger()).toEqual(paid);

      // 4. Rebuilt: the next sync reads nothing.
      trophies.mockClear();
      await syncPlatformAccount(user.id, "psn");
      expect(trophies).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
      titles.mockRestore();
      trophies.mockRestore();
    }
  });

  it("a game with a PS4 and a PS5 trophy list is not read again on every sync", async () => {
    // One catalog game, two PSN lists (cross-gen): the UserGame row holds one count for both, which
    // matched only one list, so the other was read again every sync (a big library never finished).
    // Each list is up to date by its own UserTrophyList.
    const { prisma } = await import("@/lib/db");
    const { getPsn } = await import("@/lib/integrations");
    const { syncPlatformAccount } = await import("./platform-user");
    const psn = getPsn();
    const at = new Date(Date.UTC(2026, 0, 5, 20));
    const list = (npTitleId: string, platform: string, earned: number) => ({
      npTitleId,
      serviceName: "trophy2" as const,
      name: "Jogo Duplo Teste",
      platform,
      progress: 50,
      trophyCounts: { bronze: 3, silver: 0, gold: 0, platinum: 0 },
      earnedCounts: { bronze: earned, silver: 0, gold: 0, platinum: 0 },
      lastPlayed: at,
    });
    const ps4 = `${FAKE_TITLE_PREFIX}PS4`;
    const ps5 = `${FAKE_TITLE_PREFIX}PS5`;
    const titles = vi.spyOn(psn, "getTitles").mockResolvedValue([list(ps4, "PS4", 1), list(ps5, "PS5", 2)]);
    const trophies = vi.spyOn(psn, "getTrophies").mockImplementation(async (_account, npTitleId) =>
      ["1", "2", "3"].map((id, i) => ({
        trophyId: id,
        name: `Troféu ${id}`,
        description: null,
        iconUrl: null,
        hidden: false,
        tier: "bronze" as const,
        earned: i < (npTitleId === ps4 ? 1 : 2),
        earnedAt: i < (npTitleId === ps4 ? 1 : 2) ? at : null,
        rarityPct: 40,
      })),
    );
    try {
      const user = await userWith("psn", "test-dual-list-account", "Duplo-Teste");
      await expect(syncPlatformAccount(user.id, "psn")).resolves.toMatchObject({ status: "ok", partial: false });
      const games = await prisma.userGame.findMany({ where: { userId: user.id, platform: "psn" } });
      expect(games).toHaveLength(1);
      // The game's count is every trophy unlocked in either list: each list keeps its own trophies
      // (1 on the PS4 list, 2 on the PS5 one).
      expect(games[0].unlockedCount).toBe(3);

      trophies.mockClear();
      await syncPlatformAccount(user.id, "psn");
      expect(trophies).not.toHaveBeenCalled();

      // A new unlock in one list is still read.
      titles.mockResolvedValue([list(ps4, "PS4", 2), list(ps5, "PS5", 2)]);
      await syncPlatformAccount(user.id, "psn");
      expect(trophies.mock.calls.map((c) => c[1])).toEqual([ps4]);
    } finally {
      titles.mockRestore();
      trophies.mockRestore();
    }
  });

  it("a list without UserTrophyList is read once by an incremental sync, even when its game's count matches", async () => {
    // The game's UserGame count is not a list's progress: a list with unlocks but no UserTrophyList
    // (and nothing remembered for it) is read, which records its row; the next sync reads nothing.
    const { prisma } = await import("@/lib/db");
    const { getPsn } = await import("@/lib/integrations");
    const { syncPlatformAccount, titleMemoryKey } = await import("./platform-user");
    const psn = getPsn();
    const at = new Date(Date.UTC(2026, 0, 6, 20));
    const npTitleId = `${FAKE_TITLE_PREFIX}HEAL4`;
    const titles = vi.spyOn(psn, "getTitles").mockResolvedValue([
      {
        npTitleId,
        serviceName: "trophy2" as const,
        name: "Jogo Curado Teste",
        platform: "PS4",
        progress: 50,
        trophyCounts: { bronze: 2, silver: 0, gold: 0, platinum: 0 },
        earnedCounts: { bronze: 1, silver: 0, gold: 0, platinum: 0 },
        lastPlayed: at,
      },
    ]);
    const trophies = vi.spyOn(psn, "getTrophies").mockImplementation(async () =>
      ["1", "2"].map((id, i) => ({
        trophyId: id,
        name: `Troféu ${id}`,
        description: null,
        iconUrl: null,
        hidden: false,
        tier: "bronze" as const,
        earned: i === 0,
        earnedAt: i === 0 ? at : null,
        rarityPct: 40,
      })),
    );
    try {
      const user = await userWith("psn", "test-heal-account", "Cura-Teste");
      await expect(syncPlatformAccount(user.id, "psn")).resolves.toMatchObject({ status: "ok", partial: false });
      const account = await prisma.linkedAccount.findUniqueOrThrow({ where: { userId_platform: { userId: user.id, platform: "psn" } } });
      expect(await prisma.userGame.findFirstOrThrow({ where: { userId: user.id, platform: "psn" } })).toMatchObject({ unlockedCount: 1 });
      await prisma.userTrophyList.deleteMany({ where: { userId: user.id } });
      await prisma.syncCursor.deleteMany({ where: { key: titleMemoryKey(account.id) } });

      trophies.mockClear();
      await syncPlatformAccount(user.id, "psn");
      expect(trophies.mock.calls.map((c) => c[1])).toEqual([npTitleId]);
      expect(await prisma.userTrophyList.count({ where: { userId: user.id } })).toBe(1);

      // Healed: the next incremental sync reads nothing.
      trophies.mockClear();
      await syncPlatformAccount(user.id, "psn");
      expect(trophies).not.toHaveBeenCalled();
    } finally {
      titles.mockRestore();
      trophies.mockRestore();
    }
  });

  it("a game with PS3, PS4 and PS5 lists keeps every trophy", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const user = await userWith("psn", "9000000000000000005", "Tres-Consoles");
    await expect(syncPlatformAccount(user.id, "psn")).resolves.toMatchObject({ status: "ok", partial: false, newUnlocks: 92 });

    const lists = await prisma.trophyList.findMany({
      where: { platform: "psn", externalId: { in: GTA_LISTS } },
      orderBy: { externalId: "asc" },
    });
    expect(lists.map((l) => [l.externalId, l.console, l.serviceName, l.trophyCount])).toEqual([
      ["NPWR90011_00", "PS3", "trophy", 59],
      ["NPWR90012_00", "PS4", "trophy", 77],
      ["NPWR90013_00", "PS5", "trophy2", 77],
    ]);
    const gameIds = [...new Set(lists.map((l) => l.gameId))];
    expect(gameIds).toHaveLength(1);
    const [gameId] = gameIds;
    // Each list keeps its own rows: trophy "5" of the PS4 list is not the PS5 list's "5".
    expect(await prisma.achievement.count({ where: { gameId, platform: "psn" } })).toBe(59 + 77 + 77);
    expect(await prisma.userAchievement.count({ where: { userId: user.id, achievement: { gameId, platform: "psn" } } })).toBe(92);

    const game = await prisma.userGame.findUniqueOrThrow({
      where: { userId_gameId_platform: { userId: user.id, gameId, platform: "psn" } },
    });
    expect(game).toMatchObject({ unlockedCount: 92, completedAt: null });
    const progress = await prisma.userTrophyList.findMany({ where: { userId: user.id }, include: { list: true } });
    expect(progress.map((p) => [p.list.externalId, p.unlockedCount, p.completedAt]).sort()).toEqual([
      ["NPWR90011_00", 20, null],
      ["NPWR90012_00", 46, null],
      ["NPWR90013_00", 26, null],
    ]);
    // Three versions (consoles): every unlock is paid once.
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, source: "achievement", voidedAt: null } })).toBe(92);
  });

  it("a second sync of that game reads nothing", async () => {
    const { prisma } = await import("@/lib/db");
    const { getPsn } = await import("@/lib/integrations");
    const { syncPlatformAccount } = await import("./platform-user");
    const user = await userWith("psn", "9000000000000000005", "Tres-Consoles");
    await syncPlatformAccount(user.id, "psn");
    const ledger = await prisma.xpLedgerEntry.count({ where: { userId: user.id } });

    const reads = vi.spyOn(getPsn(), "getTrophies");
    try {
      await expect(syncPlatformAccount(user.id, "psn")).resolves.toMatchObject({
        newUnlocks: 0,
        titles: { read: 0, upToDate: 3 },
      });
      expect(reads).not.toHaveBeenCalled();
      // Reading every list again changes nothing either.
      await expect(syncPlatformAccount(user.id, "psn", { full: true })).resolves.toMatchObject({ newUnlocks: 0 });
      expect(reads).toHaveBeenCalledTimes(3);
    } finally {
      reads.mockRestore();
    }
    expect(await prisma.userAchievement.count({ where: { userId: user.id } })).toBe(92);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id } })).toBe(ledger);
  });

  it("unlinking clears the per-list progress: a relink reads the lists again", async () => {
    const { prisma } = await import("@/lib/db");
    const { unlink } = await import("@/lib/accounts/link");
    const { syncPlatformAccount } = await import("./platform-user");
    const user = await userWith("psn", "9000000000000000005", "Tres-Consoles");
    await syncPlatformAccount(user.id, "psn");
    expect(await prisma.userTrophyList.count({ where: { userId: user.id } })).toBe(3);

    expect(await unlink(user.id, "psn")).toBe(true);
    expect(await prisma.userTrophyList.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.userAchievement.count({ where: { userId: user.id } })).toBe(0);

    await prisma.linkedAccount.update({
      where: { userId_platform: { userId: user.id, platform: "psn" } },
      data: { externalId: "9000000000000000005", handle: "Tres-Consoles", linkedAt: new Date() },
    });
    await expect(syncPlatformAccount(user.id, "psn")).resolves.toMatchObject({ titles: { read: 3, upToDate: 0 } });
    expect(await prisma.userAchievement.count({ where: { userId: user.id } })).toBe(92);
    expect(await prisma.userTrophyList.count({ where: { userId: user.id } })).toBe(3);
  });

  /**
   * GTA V's concept on PSN (one concept, every region and console): an English PS5 list and a
   * Japanese-named PS5 list, played under two store title ids of the concept.
   */
  async function conceptLibrary({ jpDay = 5, readDelayMs = 0 }: { jpDay?: number; readDelayMs?: number } = {}) {
    const { getPsn } = await import("@/lib/integrations");
    const psn = getPsn();
    const at = (day: number) => new Date(Date.UTC(2026, 2, day, 20));
    const lists = {
      // By default the Japanese list was played first: it is read (and resolved) first.
      NPWR_EN: { name: CONCEPT_EN_NAME, day: 10, store: "PPSA_EN_TEST_00" },
      NPWR_JP: { name: "グランド・セフト・オートV", day: jpDay, store: "PPSA_JP_TEST_00" },
    };
    type ListId = keyof typeof lists;
    const library: ListId[] = [];
    const title = (id: ListId) => ({
      npTitleId: id,
      serviceName: "trophy2" as const,
      name: lists[id].name,
      platform: "PS5",
      progress: 66,
      trophyCounts: { bronze: 3, silver: 0, gold: 0, platinum: 0 },
      earnedCounts: { bronze: 2, silver: 0, gold: 0, platinum: 0 },
      lastPlayed: at(lists[id].day),
    });
    const conceptTitleIds = ["CUSA_GTA_TEST_00", "PPSA_EN_TEST_00", "PPSA_JP_TEST_00"];
    const spies = [
      vi.spyOn(psn, "getTitles").mockImplementation(async () => library.map(title)),
      vi.spyOn(psn, "getTrophies").mockImplementation(async (_account, npTitleId) => {
        if (readDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, readDelayMs));
        return ["1", "2", "3"].map((id, i) => ({
          trophyId: id,
          name: `Troféu ${id}`,
          description: null,
          iconUrl: null,
          hidden: false,
          tier: "bronze" as const,
          earned: i < 2,
          earnedAt: i < 2 ? at(lists[npTitleId as ListId].day + i) : null,
          rarityPct: 40,
        }));
      }),
      vi.spyOn(psn, "getPlayedGames").mockImplementation(async () =>
        library.map((id) => ({
          titleId: lists[id].store,
          name: lists[id].name,
          category: "ps5_native_game",
          playtimeMin: 300,
          firstPlayedAt: at(lists[id].day - 1),
          lastPlayedAt: at(lists[id].day + 1),
          conceptId: 201930,
          conceptTitleIds,
          // The concept's own name is the English one, also for the Japanese version.
          conceptName: CONCEPT_EN_NAME,
        })),
      ),
      vi.spyOn(psn, "getTrophyListsOfTitles").mockImplementation(
        async (_account, ids) =>
          new Map(ids.map((id) => [id, (Object.keys(lists) as ListId[]).filter((l) => lists[l].store === id)])),
      ),
    ];
    return { library, mapping: spies[3], restore: () => spies.forEach((s) => s.mockRestore()) };
  }

  async function removeConceptGames() {
    const { prisma } = await import("@/lib/db");
    await prisma.game.deleteMany({ where: { platformLinks: { some: { platform: "psn", externalId: { in: CONCEPT_IDS } } } } });
    await prisma.game.deleteMany({ where: { slug: CONCEPT_CATALOG_SLUG } });
  }

  it("a Japanese-named PS5 list of the same concept lands on the same game", async () => {
    const { prisma } = await import("@/lib/db");
    const { versionKey } = await import("@/lib/trophies/lists");
    const { syncPlatformAccount } = await import("./platform-user");
    await removeConceptGames();
    const fake = await conceptLibrary();
    fake.library.push("NPWR_EN", "NPWR_JP");
    try {
      const user = await userWith("psn", "test-concept-account", "Conceito-Teste");
      await expect(syncPlatformAccount(user.id, "psn")).resolves.toMatchObject({ status: "ok", newUnlocks: 4 });

      const lists = await prisma.trophyList.findMany({
        where: { platform: "psn", externalId: { in: ["NPWR_EN", "NPWR_JP"] } },
        include: { game: true },
        orderBy: { externalId: "asc" },
      });
      expect(lists.map((l) => [l.externalId, l.console, l.region, l.conceptId])).toEqual([
        ["NPWR_EN", "PS5", null, 201930],
        ["NPWR_JP", "PS5", "jp", 201930],
      ]);
      // One game, named after the English list (resolved first even though read second).
      expect(new Set(lists.map((l) => l.gameId)).size).toBe(1);
      expect(lists[0].game.name).toBe("Grand Theft Auto V Conceito Teste");
      expect(versionKey(lists[0])).toBe(versionKey(lists[1]));
      // Both played versions add their hours to that game: no second game for the Japanese name.
      const games = await prisma.userGame.findMany({ where: { userId: user.id, platform: "psn" } });
      expect(games.map((g) => [g.gameId, g.unlockedCount, g.playtimeMin])).toEqual([[lists[0].gameId, 4, 600]]);
      expect(
        await prisma.game.count({ where: { platformLinks: { some: { platform: "psn", externalId: { in: CONCEPT_IDS } } } } }),
      ).toBe(1);
    } finally {
      fake.restore();
    }
  });

  it("a regional list of a concept seen in an earlier sync lands on its game", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    await removeConceptGames();
    const fake = await conceptLibrary();
    fake.library.push("NPWR_EN");
    try {
      const user = await userWith("psn", "test-concept-account", "Conceito-Teste");
      await syncPlatformAccount(user.id, "psn");
      // The Japanese version shows up later (a new store title id of the concept, mapped then).
      fake.library.push("NPWR_JP");
      await expect(syncPlatformAccount(user.id, "psn")).resolves.toMatchObject({ newUnlocks: 2, titles: { read: 1, upToDate: 1 } });
      const lists = await prisma.trophyList.findMany({ where: { platform: "psn", externalId: { in: ["NPWR_EN", "NPWR_JP"] } } });
      expect(lists).toHaveLength(2);
      expect(new Set(lists.map((l) => l.gameId)).size).toBe(1);
    } finally {
      fake.restore();
    }
  });

  it("a list left for a later run keeps the concept learned when its title id was mapped", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    await removeConceptGames();
    // The Japanese list is the newest: a run of one title reads the English one (oldest first),
    // while both store title ids are mapped in that first run.
    const fake = await conceptLibrary({ jpDay: 20 });
    fake.library.push("NPWR_EN", "NPWR_JP");
    try {
      const user = await userWith("psn", "test-concept-account", "Conceito-Teste");
      await expect(syncPlatformAccount(user.id, "psn", { maxTitles: 1 })).resolves.toMatchObject({ partial: true });
      expect(await prisma.trophyList.count({ where: { platform: "psn", externalId: "NPWR_JP" } })).toBe(0);
      fake.mapping.mockClear();
      await expect(syncPlatformAccount(user.id, "psn")).resolves.toMatchObject({ titles: { read: 1, upToDate: 1 } });
      expect(fake.mapping).not.toHaveBeenCalled();
      const lists = await prisma.trophyList.findMany({ where: { platform: "psn", externalId: { in: ["NPWR_EN", "NPWR_JP"] } } });
      expect(lists.map((l) => l.conceptId)).toEqual([201930, 201930]);
      expect(new Set(lists.map((l) => l.gameId)).size).toBe(1);
    } finally {
      fake.restore();
    }
  });

  it("no mapping request starts past the read deadline; the sync still records its titles", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    await removeConceptGames();
    // Reading the one list takes 2 s: the read share of a 3 s budget (1.8 s) is over by then.
    const fake = await conceptLibrary({ readDelayMs: 2000 });
    fake.library.push("NPWR_EN");
    try {
      const user = await userWith("psn", "test-concept-account", "Conceito-Teste");
      await expect(syncPlatformAccount(user.id, "psn", { deadline: Date.now() + 3000 })).resolves.toMatchObject({
        status: "ok",
        newUnlocks: 2,
      });
      expect(fake.mapping).not.toHaveBeenCalled();
      expect(await prisma.userTrophyList.count({ where: { userId: user.id } })).toBe(1);
      // Nothing was asked, so nothing is remembered: the next sync maps the title id.
      await syncPlatformAccount(user.id, "psn");
      expect(fake.mapping).toHaveBeenCalledTimes(1);
    } finally {
      fake.restore();
    }
  });

  it("a Japanese list seen first lands on the catalog game named like its concept", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    await removeConceptGames();
    const catalog = await prisma.game.create({
      data: { slug: CONCEPT_CATALOG_SLUG, name: CONCEPT_EN_NAME, achievementCount: 0 },
    });
    const fake = await conceptLibrary();
    fake.library.push("NPWR_JP");
    try {
      const user = await userWith("psn", "test-concept-account", "Conceito-Teste");
      await syncPlatformAccount(user.id, "psn");
      const jp = await prisma.trophyList.findUniqueOrThrow({
        where: { platform_externalId: { platform: "psn", externalId: "NPWR_JP" } },
      });
      expect(jp.gameId).toBe(catalog.id);
      // Its played version too.
      const games = await prisma.userGame.findMany({ where: { userId: user.id, platform: "psn" } });
      expect(games.map((g) => g.gameId)).toEqual([catalog.id]);

      // The English list read later joins it (concept), not a game of its own.
      fake.library.push("NPWR_EN");
      await syncPlatformAccount(user.id, "psn");
      const en = await prisma.trophyList.findUniqueOrThrow({
        where: { platform_externalId: { platform: "psn", externalId: "NPWR_EN" } },
      });
      expect(en.gameId).toBe(catalog.id);
    } finally {
      fake.restore();
    }
  });

  it("a fresh concept seen only through a Japanese list creates a game named by the concept", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    await removeConceptGames();
    const fake = await conceptLibrary();
    fake.library.push("NPWR_JP");
    try {
      const user = await userWith("psn", "test-concept-account", "Conceito-Teste");
      await syncPlatformAccount(user.id, "psn");
      const jp = await prisma.trophyList.findUniqueOrThrow({
        where: { platform_externalId: { platform: "psn", externalId: "NPWR_JP" } },
        include: { game: true },
      });
      expect(jp.game.name).toBe(CONCEPT_EN_NAME);
      expect(jp.region).toBe("jp");
      expect(await prisma.userGame.count({ where: { userId: user.id, platform: "psn" } })).toBe(1);
    } finally {
      fake.restore();
    }
  });

  it("a failing concept mapping never fails the sync (trophies still import)", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    await removeConceptGames();
    const fake = await conceptLibrary();
    fake.library.push("NPWR_EN");
    fake.mapping.mockRejectedValue(new Error("PSN title trophy lists failed with HTTP 500"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const user = await userWith("psn", "test-concept-account", "Conceito-Teste");
      await expect(syncPlatformAccount(user.id, "psn")).resolves.toMatchObject({ status: "ok", newUnlocks: 2, partial: false });
      expect(await prisma.userTrophyList.count({ where: { userId: user.id } })).toBe(1);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      fake.restore();
    }
  });

  it("an Xbox 360 title and its One title are two lists of one game", async () => {
    const { prisma } = await import("@/lib/db");
    const { getXbox } = await import("@/lib/integrations");
    const { syncPlatformAccount } = await import("./platform-user");
    const xbox = getXbox();
    const day = 86_400_000;
    const start = { "90000771": Date.UTC(2012, 4, 1, 20), "90000772": Date.UTC(2019, 4, 1, 20) };
    const earned = { "90000771": 2, "90000772": 3 };
    type Id = keyof typeof earned;
    const title = (titleId: Id, devices: string[]) => ({
      titleId,
      name: "Gears Teste Duplo",
      currentAchievements: earned[titleId],
      totalAchievements: 3,
      currentGamerscore: earned[titleId] * 10,
      totalGamerscore: 30,
      progress: Math.round((earned[titleId] / 3) * 100),
      lastPlayed: new Date(start[titleId] + day * 3),
      devices,
    });
    const titles = vi
      .spyOn(xbox, "getTitles")
      .mockResolvedValue([title("90000771", ["Xbox360"]), title("90000772", ["XboxOne", "XboxSeries"])]);
    const achievements = vi.spyOn(xbox, "getAchievements").mockImplementation(async (_xuid, titleId) =>
      ["1", "2", "3"].map((id, i) => ({
        id,
        name: `Conquista ${id}`,
        description: null,
        iconUrl: null,
        hidden: false,
        gamerscore: 10,
        unlocked: i < earned[titleId as Id],
        unlockedAt: i < earned[titleId as Id] ? new Date(start[titleId as Id] + i * day) : null,
        rarityPct: 30,
      })),
    );
    try {
      const user = await userWith("xbox", "2535400000000002", "Tralked Teste");
      await expect(syncPlatformAccount(user.id, "xbox")).resolves.toMatchObject({ status: "ok", newUnlocks: 5 });
      const lists = await prisma.trophyList.findMany({
        where: { platform: "xbox", externalId: { in: ["90000771", "90000772"] } },
        orderBy: { externalId: "asc" },
      });
      expect(lists.map((l) => [l.externalId, l.console, l.trophyCount])).toEqual([
        ["90000771", "360", 3],
        ["90000772", "ONE", 3],
      ]);
      expect(lists[0].gameId).toBe(lists[1].gameId);
      const gameId = lists[0].gameId;
      expect(await prisma.achievement.count({ where: { gameId, platform: "xbox" } })).toBe(6);

      const progress = await prisma.userTrophyList.findMany({ where: { userId: user.id, listId: { in: lists.map((l) => l.id) } } });
      const of = (id: string) => progress.find((p) => p.listId === id);
      expect(of(lists[0].id)).toMatchObject({ unlockedCount: 2, completedAt: null });
      const oneCompleted = new Date(start["90000772"] + 2 * day);
      expect(of(lists[1].id)).toMatchObject({ unlockedCount: 3, completedAt: oneCompleted });
      // The game: every unlock of both lists, completed when its first list was.
      await expect(
        prisma.userGame.findUniqueOrThrow({ where: { userId_gameId_platform: { userId: user.id, gameId, platform: "xbox" } } }),
      ).resolves.toMatchObject({ unlockedCount: 5, completedAt: oneCompleted });
      // Two versions: five trophies and the One title's completion.
      const ledger = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id, voidedAt: null, platform: "xbox" } });
      expect(ledger.filter((e) => e.source === "achievement")).toHaveLength(5);
      expect(ledger.filter((e) => e.source === "platinum").map((e) => e.sourceKey)).toEqual([`xbox:90000772:${gameId}`]);
    } finally {
      titles.mockRestore();
      achievements.mockRestore();
    }
  });

  /** Spies the PSN library: each list is `trophies` bronze trophies, the first `earned` earned (a day apart). */
  async function psnLists(initial: { id: string; name: string; platform: string; trophies: number; earned: number; from: Date }[]) {
    const { getPsn } = await import("@/lib/integrations");
    const psn = getPsn();
    let lists = initial;
    const day = 86_400_000;
    const titles = vi.spyOn(psn, "getTitles").mockImplementation(async () =>
      lists.map((l) => ({
        npTitleId: l.id,
        serviceName: "trophy" as const,
        name: l.name,
        platform: l.platform,
        progress: Math.round((l.earned / l.trophies) * 100),
        trophyCounts: { bronze: l.trophies, silver: 0, gold: 0, platinum: 0 },
        earnedCounts: { bronze: l.earned, silver: 0, gold: 0, platinum: 0 },
        lastPlayed: new Date(l.from.getTime() + l.earned * day),
      })),
    );
    const trophies = vi.spyOn(psn, "getTrophies").mockImplementation(async (_account, npTitleId) => {
      const l = lists.find((x) => x.id === npTitleId)!;
      return Array.from({ length: l.trophies }, (_, i) => ({
        trophyId: String(i + 1),
        name: `Troféu ${i + 1}`,
        description: null,
        iconUrl: null,
        hidden: false,
        tier: "bronze" as const,
        earned: i < l.earned,
        earnedAt: i < l.earned ? new Date(l.from.getTime() + i * day) : null,
        rarityPct: 40,
      }));
    });
    return {
      trophies,
      set: (next: typeof initial) => {
        lists = next;
      },
      restore: () => {
        titles.mockRestore();
        trophies.mockRestore();
      },
    };
  }

  /** A catalog game with these PSN links (no trophy rows yet). */
  async function psnGame(name: string, links: string[]) {
    const { prisma } = await import("@/lib/db");
    return prisma.game.create({
      data: {
        slug: `legado-${Date.now()}-${links[0].toLowerCase()}`,
        name,
        achievementCount: 0,
        platformLinks: { create: links.map((externalId) => ({ platform: "psn", externalId })) },
      },
    });
  }

  it("a game with a legacy platinum: a list completed after another list was read gets its version platinum", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const ps3 = `${FAKE_TITLE_PREFIX}LP3`;
    const ps4 = `${FAKE_TITLE_PREFIX}LP4`;
    const game = await psnGame("Legado Duas Listas", [ps3, ps4]);
    const user = await userWith("psn", "test-legacy-two-lists", "Legado-Duas");
    await prisma.linkedAccount.updateMany({ where: { userId: user.id }, data: { linkedAt: new Date(Date.now() - 60_000) } });
    const from = new Date("2026-02-01T20:00:00Z");
    // What the sync paid before trophy lists: the game's platinum under the legacy key.
    await prisma.xpLedgerEntry.create({
      data: { userId: user.id, source: "platinum", sourceKey: `psn:${game.id}`, platform: "psn", xp: 500, skills: [] },
    });
    const fake = await psnLists([{ id: ps3, name: "Legado Duas Listas", platform: "PS3", trophies: 2, earned: 1, from }]);
    try {
      await syncPlatformAccount(user.id, "psn");
      fake.set([
        { id: ps3, name: "Legado Duas Listas", platform: "PS3", trophies: 2, earned: 1, from },
        { id: ps4, name: "Legado Duas Listas", platform: "PS4", trophies: 2, earned: 2, from },
      ]);
      await syncPlatformAccount(user.id, "psn");
      const platinums = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id, source: "platinum", voidedAt: null } });
      expect(platinums.map((e) => e.sourceKey)).toEqual([`psn:PS4:${game.id}`]);
    } finally {
      fake.restore();
    }
  });

  it("a completed list stays completed when the platform adds trophies; finishing them pays nothing twice", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const id = `${FAKE_TITLE_PREFIX}DLC`;
    const from = new Date("2026-04-01T20:00:00Z");
    const fake = await psnLists([{ id, name: "Jogo Com DLC Teste", platform: "PS5", trophies: 2, earned: 2, from }]);
    try {
      const user = await userWith("psn", "test-dlc-account", "Dlc-Teste");
      await syncPlatformAccount(user.id, "psn");
      const list = await prisma.trophyList.findUniqueOrThrow({ where: { platform_externalId: { platform: "psn", externalId: id } } });
      const progress = () =>
        prisma.userTrophyList.findUniqueOrThrow({ where: { userId_listId: { userId: user.id, listId: list.id } } });
      const completedAt = (await progress()).completedAt;
      expect(completedAt).toEqual(new Date(from.getTime() + 86_400_000));
      const platinum = await prisma.xpLedgerEntry.findFirstOrThrow({ where: { userId: user.id, source: "platinum" } });

      // A DLC adds two trophies: the list is 2 of 4 now, the completion and its bonus stay.
      fake.set([{ id, name: "Jogo Com DLC Teste", platform: "PS5", trophies: 4, earned: 2, from }]);
      await syncPlatformAccount(user.id, "psn", { full: true });
      expect((await progress()).completedAt).toEqual(completedAt);
      await expect(
        prisma.userGame.findUniqueOrThrow({
          where: { userId_gameId_platform: { userId: user.id, gameId: list.gameId, platform: "psn" } },
        }),
      ).resolves.toMatchObject({ completedAt });
      await expect(prisma.xpLedgerEntry.findUniqueOrThrow({ where: { id: platinum.id } })).resolves.toMatchObject({ voidedAt: null });

      // The player finishes the DLC: the two trophies are paid, nothing is voided or paid twice.
      fake.set([{ id, name: "Jogo Com DLC Teste", platform: "PS5", trophies: 4, earned: 4, from }]);
      await syncPlatformAccount(user.id, "psn");
      expect((await progress()).completedAt).toEqual(completedAt);
      expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, voidedAt: { not: null } } })).toBe(0);
      expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, source: "platinum" } })).toBe(1);
      expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, source: "achievement" } })).toBe(4);
    } finally {
      fake.restore();
    }
  });

  it("a game recorded on one of its lists still reads its other lists once", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount, titleMemoryKey } = await import("./platform-user");
    const p4 = `${FAKE_TITLE_PREFIX}RP4`;
    const p5 = `${FAKE_TITLE_PREFIX}RP5`;
    const game = await psnGame("Legado Lembrado", [p4, p5]);
    const user = await userWith("psn", "test-remembered-lists", "Lembrado-Teste");
    const account = await prisma.linkedAccount.findUniqueOrThrow({ where: { userId_platform: { userId: user.id, platform: "psn" } } });
    // One UserGame row and the counts each list showed when last recorded, no per-list progress yet.
    await prisma.userGame.create({ data: { userId: user.id, gameId: game.id, platform: "psn", playtimeMin: 0, unlockedCount: 2 } });
    await prisma.syncCursor.create({
      data: {
        key: titleMemoryKey(account.id),
        value: { externalId: account.externalId, linkedAt: account.linkedAt!.toISOString(), titles: { [p4]: [1], [p5]: [2] } },
      },
    });
    const from = new Date("2026-06-01T20:00:00Z");
    const fake = await psnLists([
      { id: p4, name: "Legado Lembrado", platform: "PS4", trophies: 3, earned: 2, from },
      { id: p5, name: "Legado Lembrado", platform: "PS5", trophies: 3, earned: 2, from },
    ]);
    try {
      // The PS4 list has a new trophy; the PS5 list matches its remembered count.
      await syncPlatformAccount(user.id, "psn");
      expect(fake.trophies.mock.calls.map((c) => c[1])).toEqual([p4]);
      // Now the game is on lists: its PS5 list (no per-list progress yet) is read once.
      fake.trophies.mockClear();
      await syncPlatformAccount(user.id, "psn");
      expect(fake.trophies.mock.calls.map((c) => c[1])).toEqual([p5]);
      fake.trophies.mockClear();
      await syncPlatformAccount(user.id, "psn");
      expect(fake.trophies).not.toHaveBeenCalled();
      expect(await prisma.userTrophyList.count({ where: { userId: user.id } })).toBe(2);
    } finally {
      fake.restore();
      await prisma.syncCursor.deleteMany({ where: { key: titleMemoryKey(account.id) } });
    }
  });

  it("a title whose listed count differs from what its list holds is not read on every sync", async () => {
    // Xbox's title list can count an unlock its achievement list does not show (and RA's hardcore
    // count can differ from the sticky flags): the listed count remembered for the title still
    // marks it up to date.
    const { prisma } = await import("@/lib/db");
    const { getXbox } = await import("@/lib/integrations");
    const { syncPlatformAccount } = await import("./platform-user");
    const xbox = getXbox();
    const titles = vi.spyOn(xbox, "getTitles").mockResolvedValue([
      {
        titleId: "90000781",
        name: "Contagem Diferente Teste",
        currentAchievements: 3,
        totalAchievements: 3,
        currentGamerscore: 30,
        totalGamerscore: 30,
        progress: 100,
        lastPlayed: new Date("2026-07-01T20:00:00Z"),
        devices: ["XboxSeries"],
      },
    ]);
    const achievements = vi.spyOn(xbox, "getAchievements").mockImplementation(async () =>
      ["1", "2", "3"].map((id, i) => ({
        id,
        name: `Conquista ${id}`,
        description: null,
        iconUrl: null,
        hidden: false,
        gamerscore: 10,
        unlocked: i < 2,
        unlockedAt: i < 2 ? new Date(Date.UTC(2026, 6, 1 + i, 20)) : null,
        rarityPct: 30,
      })),
    );
    try {
      const user = await userWith("xbox", "2535400000000002", "Tralked Teste");
      await syncPlatformAccount(user.id, "xbox");
      expect(achievements).toHaveBeenCalledTimes(1);
      await expect(syncPlatformAccount(user.id, "xbox")).resolves.toMatchObject({ titles: { read: 0, upToDate: 1 } });
      expect(achievements).toHaveBeenCalledTimes(1);
      expect(await prisma.userAchievement.count({ where: { userId: user.id } })).toBe(2);
    } finally {
      titles.mockRestore();
      achievements.mockRestore();
    }
  });

  it("unlinking during a running sync: titles after the unlink are not recorded, nothing is paid", async () => {
    const { prisma } = await import("@/lib/db");
    const { unlink } = await import("@/lib/accounts/link");
    const { syncPlatformAccount } = await import("./platform-user");
    const fake = await fakePsnLibrary(3);
    // The run reads the library first, then records title by title: unlink once the first title
    // is recorded (each title loads its game right before its transaction).
    const loadGame = prisma.game.findUniqueOrThrow.bind(prisma.game);
    let titles = 0;
    let unlinked: Promise<boolean> | null = null;
    const user = await userWith("psn", "test-unlink-during-sync", "Desvincula-Teste");
    const spy = vi.spyOn(prisma.game, "findUniqueOrThrow").mockImplementation(((args: Parameters<typeof loadGame>[0]) => {
      titles++;
      if (titles === 2) unlinked = unlink(user.id, "psn");
      return unlinked ? unlinked.then(() => loadGame(args)) : loadGame(args);
    }) as unknown as typeof prisma.game.findUniqueOrThrow);
    try {
      const result = await syncPlatformAccount(user.id, "psn");
      expect(result).toMatchObject({ status: "unlinked", newUnlocks: 0 });
      expect(titles).toBe(2); // the second title saw the account gone and the run stopped
      expect(await unlinked).toBe(true);

      // Unlink removed the first title; the second and third were never written.
      expect(await prisma.userGame.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.userAchievement.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, voidedAt: null } })).toBe(0);
      const stats = await prisma.userStats.findUnique({ where: { userId: user.id } });
      expect(stats?.totalXp ?? 0).toBe(0);
      const account = await prisma.linkedAccount.findUniqueOrThrow({
        where: { userId_platform: { userId: user.id, platform: "psn" } },
      });
      expect(account).toMatchObject({ verifiedAt: null, lastSyncedAt: null });
    } finally {
      spy.mockRestore();
      fake.restore();
    }
  });

  it("an unlink followed by a quick relink of the same account still stops the running sync", async () => {
    const { prisma } = await import("@/lib/db");
    const { unlink } = await import("@/lib/accounts/link");
    const { syncPlatformAccount } = await import("./platform-user");
    const fake = await fakePsnLibrary(3);
    const loadGame = prisma.game.findUniqueOrThrow.bind(prisma.game);
    let titles = 0;
    let relinked: Promise<unknown> | null = null;
    const user = await userWith("psn", "test-relink-during-sync", "Religa-Teste");
    const spy = vi.spyOn(prisma.game, "findUniqueOrThrow").mockImplementation(((args: Parameters<typeof loadGame>[0]) => {
      titles++;
      if (titles === 2) {
        relinked = unlink(user.id, "psn").then(() =>
          prisma.linkedAccount.update({
            where: { userId_platform: { userId: user.id, platform: "psn" } },
            data: { externalId: "test-relink-during-sync", linkedAt: new Date(Date.now() + 1000) },
          }),
        );
      }
      return relinked ? relinked.then(() => loadGame(args)) : loadGame(args);
    }) as unknown as typeof prisma.game.findUniqueOrThrow);
    try {
      expect(await syncPlatformAccount(user.id, "psn")).toMatchObject({ status: "unlinked", newUnlocks: 0 });
      expect(titles).toBe(2);
      // The new link starts from nothing: the old run wrote nothing into it.
      expect(await prisma.userGame.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, voidedAt: null } })).toBe(0);
    } finally {
      spy.mockRestore();
      fake.restore();
    }
  });

  it("stops at the time budget and does not mark the account synced", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const user = await userWith("psn", "9000000000000000002", "Tralked-Teste");
    const result = await syncPlatformAccount(user.id, "psn", { deadline: 0 });
    expect(result).toMatchObject({ status: "ok", partial: true, newUnlocks: 0 });
    const account = await prisma.linkedAccount.findUniqueOrThrow({
      where: { userId_platform: { userId: user.id, platform: "psn" } },
    });
    expect(account.lastSyncedAt).toBeNull();
    expect(account.lastSyncAttemptAt).not.toBeNull();
  });

  it("cron syncs at most 5 accounts per run, stalest first, and respects the budget", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncStalePlatformAccounts } = await import("./platform-user");
    const where = { externalId: { startsWith: "test-cron-" } };
    for (let i = 0; i < 6; i++) await userWith("psn", `test-cron-${i}`, `Cron-${i}`);

    await expect(syncStalePlatformAccounts({ where, budgetMs: 0 })).resolves.toEqual({ processed: 0, failed: 0 });
    await expect(syncStalePlatformAccounts({ where })).resolves.toEqual({ processed: 5, failed: 0 });
    expect(await prisma.linkedAccount.count({ where: { ...where, lastSyncAttemptAt: null } })).toBe(1);
    // The one left behind goes first next time.
    await syncStalePlatformAccounts({ where, limit: 1 });
    expect(await prisma.linkedAccount.count({ where: { ...where, lastSyncAttemptAt: null } })).toBe(0);
  });

  it("turns lucas's seeded PSN progress into ledger entries when his account syncs", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    // A stand-in borrows lucas's PSN account id, so lucas's seeded level (47) is untouched.
    const lucas = await prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } });
    const original = await prisma.linkedAccount.findUniqueOrThrow({
      where: { userId_platform: { userId: lucas.id, platform: "psn" } },
    });
    await prisma.linkedAccount.update({
      where: { id: original.id },
      data: { externalId: `${original.externalId}-borrowed` },
    });
    try {
      const standIn = await userWith("psn", original.externalId, original.handle);
      const result = await syncPlatformAccount(standIn.id, "psn");
      expect(result.status).toBe("ok");
      // The seeded PSN trophies are reused (no duplicate rows for Hollow Knight).
      const hk = await prisma.game.findUniqueOrThrow({ where: { slug: "hollow-knight" } });
      expect(await prisma.achievement.count({ where: { gameId: hk.id, platform: "psn" } })).toBe(8);
      expect(
        await prisma.xpLedgerEntry.count({ where: { userId: standIn.id, platform: "psn", source: "achievement" } }),
      ).toBe(14);
      await prisma.linkedAccount.deleteMany({ where: { userId: standIn.id } });
    } finally {
      await prisma.linkedAccount.update({
        where: { id: original.id },
        data: { externalId: original.externalId },
      });
    }
  });
  describe("a resync never re-judges unlocks already stored", () => {
    const BURST_AT = new Date("2020-03-01T10:00:00Z");

    /** Imports once, then makes every stored unlock of the user one old burst (same 5 s). */
    async function importThenMakeBurst(platform: "psn" | "xbox", externalId: string, handle: string) {
      const { prisma } = await import("@/lib/db");
      const { syncPlatformAccount } = await import("./platform-user");
      const user = await userWith(platform, externalId, handle);
      await syncPlatformAccount(user.id, platform);
      // The Xbox fixture has 9 unlocks: filler unlocks of another game bring the old burst to 10+.
      if (platform === "xbox") {
        const filler = await prisma.game.upsert({
          where: { slug: "test-burst-filler" },
          create: { slug: "test-burst-filler", name: "Burst filler", achievementCount: 3 },
          update: {},
        });
        const { testListId } = await import("@/lib/trophies/test-lists");
        const listId = await testListId(filler.id, "xbox");
        for (let i = 0; i < 3; i++) {
          const a = await prisma.achievement.create({
            data: { gameId: filler.id, platform: "xbox", listId, apiName: `filler-${i}-${user.id}`, name: `Filler ${i}` },
          });
          await prisma.userAchievement.create({ data: { userId: user.id, achievementId: a.id, unlockedAt: BURST_AT } });
        }
      }
      const stored = await prisma.userAchievement.findMany({ where: { userId: user.id }, orderBy: { achievementId: "asc" } });
      expect(stored.length).toBeGreaterThanOrEqual(10);
      expect(stored.every((u) => !u.suspicious)).toBe(true);
      for (const [i, u] of stored.entries()) {
        await prisma.userAchievement.update({
          where: { userId_achievementId: { userId: user.id, achievementId: u.achievementId } },
          data: { unlockedAt: new Date(BURST_AT.getTime() + (i % 5) * 1000) },
        });
      }
      return { prisma, user, stored, syncPlatformAccount };
    }

    async function snapshot(prisma: Awaited<typeof import("@/lib/db")>["prisma"], userId: string, platform: string) {
      return {
        flagged: await prisma.userAchievement.count({ where: { userId, suspicious: true } }),
        lists: (await prisma.userTrophyList.findMany({ where: { userId, list: { platform } }, orderBy: { listId: "asc" } })).map((l) => l.completedAt?.toISOString() ?? null),
        games: (await prisma.userGame.findMany({ where: { userId, platform }, orderBy: { gameId: "asc" } })).map((g) => g.completedAt?.toISOString() ?? null),
        voided: await prisma.xpLedgerEntry.count({ where: { userId, voidedAt: { not: null } } }),
        valid: await prisma.xpLedgerEntry.count({ where: { userId, voidedAt: null } }),
      };
    }

    it("PSN: stored valid unlocks forming a burst stay valid, keep completedAt and void nothing", async () => {
      const { prisma, user, syncPlatformAccount } = await importThenMakeBurst("psn", "9000000000000000002", "Tralked-Teste");
      const before = await snapshot(prisma, user.id, "psn");
      expect(before.lists.some((c) => c !== null)).toBe(true);
      await syncPlatformAccount(user.id, "psn", { full: true });
      expect(await snapshot(prisma, user.id, "psn")).toEqual(before);
    });

    it("Xbox: stored valid unlocks forming a burst stay valid, keep completedAt and void nothing", async () => {
      const { prisma, user, syncPlatformAccount } = await importThenMakeBurst("xbox", "2535400000000002", "Tralked Teste");
      const before = await snapshot(prisma, user.id, "xbox");
      await syncPlatformAccount(user.id, "xbox", { full: true });
      expect(await snapshot(prisma, user.id, "xbox")).toEqual(before);
    });

    /** Makes every PSN trophy read come back earned within the same few seconds. */
    async function burstyPsn() {
      const { getPsn } = await import("@/lib/integrations");
      const psn = getPsn();
      const original = psn.getTrophies.bind(psn);
      return vi.spyOn(psn, "getTrophies").mockImplementation(async (...args) => {
        const list = await original(...args);
        if (list === "private") return list;
        return list.map((t) => (t.earnedAt ? { ...t, earnedAt: new Date(BURST_AT.getTime() + 1000) } : t));
      });
    }

    it("unlocks arriving new as a burst are still flagged (catalog already has the lists)", async () => {
      const { prisma } = await import("@/lib/db");
      const { syncPlatformAccount } = await import("./platform-user");
      // Another account reads the same titles first: their lists and trophy rows exist.
      const other = await userWith("psn", "9000000000000000002", "Tralked-Teste");
      await syncPlatformAccount(other.id, "psn");
      const user = await userWith("psn", "9000000000000000002", "Tralked-Teste");
      const trophies = await burstyPsn();
      try {
        await syncPlatformAccount(user.id, "psn", { now: new Date("2026-10-20T12:00:00Z") });
      } finally {
        trophies.mockRestore();
      }
      const all = await prisma.userAchievement.findMany({ where: { userId: user.id } });
      expect(all.length).toBeGreaterThanOrEqual(10);
      expect(all.every((u) => u.suspicious)).toBe(true);
    });

    it("unlocks on lists created in the same run are still flagged as a burst", async () => {
      const { prisma } = await import("@/lib/db");
      const { syncPlatformAccount } = await import("./platform-user");
      const fake = await fakePsnLibrary(10);
      try {
      // Earlier tests' games and lists of the same fake titles: gone, so these lists are new to the run.
      for (let i = 0; i < 10; i++) {
        await prisma.game.deleteMany({ where: { platformLinks: { some: { platform: "psn", externalId: fake.id(i) } } } });
        await prisma.trophyList.deleteMany({ where: { platform: "psn", externalId: fake.id(i) } });
      }
      expect(await prisma.trophyList.count({ where: { platform: "psn", externalId: { in: Array.from({ length: 10 }, (_, i) => fake.id(i)) } } })).toBe(0);
      // Ten brand-new titles (no list, no trophy row yet), every trophy earned within seconds.
      fake.trophies.mockImplementation(async (_account, npTitleId) => {
        const i = Number(npTitleId.slice(FAKE_TITLE_PREFIX.length));
        return [
          { trophyId: "1", name: "Um", description: null, iconUrl: null, hidden: false, tier: "bronze" as const, earned: true, earnedAt: new Date(BURST_AT.getTime() + i * 1000), rarityPct: 50 },
          { trophyId: "2", name: "Dois", description: null, iconUrl: null, hidden: false, tier: "bronze" as const, earned: false, earnedAt: null, rarityPct: 30 },
        ];
      });
        const user = await userWith("psn", "test-new-lists-account", "Listas-Novas");
        await syncPlatformAccount(user.id, "psn", { full: true });
        const all = await prisma.userAchievement.findMany({ where: { userId: user.id } });
        expect(all).toHaveLength(10);
        expect(all.every((u) => u.suspicious)).toBe(true);
        // Read again later: the verdict is stored and sticky.
        await syncPlatformAccount(user.id, "psn", { full: true });
        expect(await prisma.userAchievement.count({ where: { userId: user.id, suspicious: true } })).toBe(10);
      } finally {
        fake.restore();
      }
    });

    it("a new unlock joining a stored old burst is flagged; the old ones stay clean", async () => {
      const { prisma, user, stored, syncPlatformAccount } = await importThenMakeBurst("psn", "9000000000000000002", "Tralked-Teste");
      // Forget one unlock: the next read sees it for the first time, inside the stored burst.
      await prisma.userAchievement.delete({
        where: { userId_achievementId: { userId: user.id, achievementId: stored[0].achievementId } },
      });
      const trophies = await burstyPsn();
      try {
        await syncPlatformAccount(user.id, "psn", { full: true });
      } finally {
        trophies.mockRestore();
      }
      const flagged = await prisma.userAchievement.findMany({ where: { userId: user.id, suspicious: true } });
      expect(flagged.map((u) => u.achievementId)).toEqual([stored[0].achievementId]);
    });

    /** The `Tres-Consoles` GTA V lists (PS3, PS4, PS5) with only the given trophy ids earned, at the given time. */
    async function gtaEarned(earnedAt: (listId: string, trophyId: number) => Date | null) {
      const { getPsn } = await import("@/lib/integrations");
      const psn = getPsn();
      const original = psn.getTrophies.bind(psn);
      return vi.spyOn(psn, "getTrophies").mockImplementation(async (account, npTitleId, ...rest) => {
        const list = await original(account, npTitleId, ...rest);
        if (list === "private") return list;
        return list.map((t) => {
          const at = earnedAt(npTitleId, Number(t.trophyId));
          return at ? { ...t, earned: true, earnedAt: at } : { ...t, earned: false, earnedAt: null };
        });
      });
    }

    it("the same trophy earned at once on sibling lists counts once: 4 trophies on 3 lists are not a burst", async () => {
      const { prisma } = await import("@/lib/db");
      const { syncPlatformAccount } = await import("./platform-user");
      const user = await userWith("psn", "9000000000000000005", "Tres-Consoles");
      // PS3 and PS4 get trophies 1-4, PS5 gets 1-3: 11 unlocks, 4 distinct trophies, same seconds.
      const spy = await gtaEarned((list, id) => {
        const max = list === "NPWR90013_00" ? 3 : list === "NPWR90011_00" || list === "NPWR90012_00" ? 4 : 0;
        return id >= 1 && id <= max ? new Date(BURST_AT.getTime() + id * 1000) : null;
      });
      try {
        await syncPlatformAccount(user.id, "psn", { full: true });
      } finally {
        spy.mockRestore();
      }
      const all = await prisma.userAchievement.findMany({ where: { userId: user.id } });
      expect(all).toHaveLength(11);
      expect(all.some((u) => u.suspicious)).toBe(false);
    });

    it("10 distinct trophies within 60 s are still a burst", async () => {
      const { prisma } = await import("@/lib/db");
      const { syncPlatformAccount } = await import("./platform-user");
      const user = await userWith("psn", "9000000000000000005", "Tres-Consoles");
      const spy = await gtaEarned((list, id) => (list === "NPWR90012_00" && id >= 1 && id <= 10 ? new Date(BURST_AT.getTime() + id * 3000) : null));
      try {
        await syncPlatformAccount(user.id, "psn", { full: true });
      } finally {
        spy.mockRestore();
      }
      const all = await prisma.userAchievement.findMany({ where: { userId: user.id } });
      expect(all).toHaveLength(10);
      expect(all.every((u) => u.suspicious)).toBe(true);
    });

    it("RetroAchievements: a speed platinum whose last unlock is new is still caught", async () => {
      const { prisma } = await import("@/lib/db");
      const { getRetro } = await import("@/lib/integrations");
      const { syncPlatformAccount } = await import("./platform-user");
      const user = await userWith("retro", "01JTRALKED00000000000TESTE", "TralkedTeste");
      await syncPlatformAccount(user.id, "retro");
      const list = await prisma.trophyList.findUniqueOrThrow({
        where: { platform_externalId: { platform: "retro", externalId: "990001" } },
      });
      // 300 min played against a 100000 min average completion: far under 5%.
      await prisma.game.update({ where: { id: list.gameId }, data: { timeToBeatCompleteMin: 100000 } });
      const retro = getRetro();
      const original = retro.getGameProgress.bind(retro);
      const progress = vi.spyOn(retro, "getGameProgress").mockImplementation(async (...args) => {
        const read = await original(...args);
        return {
          ...read,
          achievements: read.achievements.map((a) =>
            a.id === "9904" ? { ...a, earned: true, earnedAt: new Date("2026-10-21T22:00:00Z") } : a,
          ),
        };
      });
      try {
        await syncPlatformAccount(user.id, "retro", { full: true });
      } finally {
        progress.mockRestore();
      }
      const rows = await prisma.userAchievement.findMany({ where: { userId: user.id }, include: { achievement: true } });
      expect(rows).toHaveLength(4);
      expect(rows.filter((r) => r.suspicious).map((r) => r.achievement.apiName)).toEqual(["9904"]);
      const progressRow = await prisma.userTrophyList.findUniqueOrThrow({ where: { userId_listId: { userId: user.id, listId: list.id } } });
      expect(progressRow.completedAt).toBeNull();
    });

    it("a stored suspicious unlock stays suspicious", async () => {
      const { prisma, user, stored, syncPlatformAccount } = await importThenMakeBurst("psn", "9000000000000000002", "Tralked-Teste");
      await prisma.userAchievement.update({
        where: { userId_achievementId: { userId: user.id, achievementId: stored[0].achievementId } },
        data: { suspicious: true },
      });
      await syncPlatformAccount(user.id, "psn", { full: true });
      const all = await prisma.userAchievement.findMany({ where: { userId: user.id } });
      expect(all.filter((u) => u.suspicious).map((u) => u.achievementId)).toEqual([stored[0].achievementId]);
    });

    it("an unlock released by an admin is not re-flagged by a later full resync", async () => {
      const { prisma, user, stored, syncPlatformAccount } = await importThenMakeBurst("psn", "9000000000000000002", "Tralked-Teste");
      const ids = stored.slice(0, 3).map((u) => u.achievementId);
      // What the admin Liberar writes (releaseListed in lib/admin/fraud.ts).
      await prisma.userAchievement.updateMany({
        where: { userId: user.id, achievementId: { in: ids } },
        data: { suspicious: false, fraudReview: "cleared", fraudReviewedAt: new Date() },
      });
      await syncPlatformAccount(user.id, "psn", { full: true });
      const all = await prisma.userAchievement.findMany({ where: { userId: user.id } });
      expect(all.filter((u) => u.suspicious)).toHaveLength(0);
      expect(all.filter((u) => ids.includes(u.achievementId)).every((u) => u.fraudReview === "cleared")).toBe(true);
    });
  });
});

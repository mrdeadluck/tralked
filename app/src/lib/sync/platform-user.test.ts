import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { xpForPlatformAchievement } from "@/lib/engine/trophies";
import { platinumBonus } from "@/lib/engine/xp";
import { env } from "@/lib/env";

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
];

describe.skipIf(!reachable)("syncPlatformAccount", () => {
  let counter = 0;

  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.user.deleteMany({ where: { handle: { startsWith: HANDLE_PREFIX } } });
    await prisma.game.deleteMany({ where: { platformLinks: { some: { OR: CREATED_TITLES } } } });
    await prisma.game.deleteMany({
      where: { platformLinks: { some: { platform: "psn", externalId: { startsWith: FAKE_TITLE_PREFIX } } } },
    });
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
    expect(platinum.sourceKey).toBe(`psn:${hk.id}`);
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
    expect(hours.filter((e) => e.sourceKey.startsWith(`psn:${hk.id}:`))).toHaveLength(5); // 1, 2, 5, 10, 25 h
    expect(hours.filter((e) => e.sourceKey.startsWith(`psn:${re4.id}:`)).map((e) => e.sourceKey)).toEqual([`psn:${re4.id}:1`, `psn:${re4.id}:2`]);
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
    expect(hours.length).toBe(4 + 5 + 2); // 12 h, 30.5 h, 2.3 h
    expect(hours.every((e) => e.platform === "xbox")).toBe(true);

    // Nothing played since: the minutes are not asked again.
    const { getXbox } = await import("@/lib/integrations");
    const spy = vi.spyOn(getXbox(), "getMinutesPlayed");
    await syncPlatformAccount(user.id, "xbox");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
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
    const firm = await prisma.achievement.findUniqueOrThrow({
      where: { gameId_platform_apiName: { gameId: re4.id, platform: "xbox", apiName: "2" } },
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
    const platinumTrophy = await prisma.achievement.findUniqueOrThrow({
      where: { gameId_platform_apiName: { gameId: hk.id, platform: "psn", apiName: "1" } },
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
    expect(first.every((u) => u.unlockedAt.getTime() === t1.getTime())).toBe(true);
    // 14 unlocks at one instant would be a burst, but undated unlocks are not burst evidence.
    expect(first.every((u) => !u.suspicious)).toBe(true);
    const constancia = () =>
      prisma.attributeProgress.findUniqueOrThrow({
        where: { userId_attribute: { userId: user.id, attribute: "constancia" } },
      });
    const before = await constancia();

    await syncPlatformAccount(user.id, "psn", { now: t2, full: true });
    const second = await prisma.userAchievement.findMany({ where: { userId: user.id } });
    expect(second.every((u) => u.unlockedAt.getTime() === t1.getTime())).toBe(true);
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
});

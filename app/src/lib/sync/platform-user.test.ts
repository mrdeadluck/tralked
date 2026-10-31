import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
// Titles the fixtures have that the seeded catalog does not: the sync creates these games.
const CREATED_TITLES = [
  { platform: "psn", externalId: "NPWR90004_00" },
  { platform: "retro", externalId: "990001" },
];

describe.skipIf(!reachable)("syncPlatformAccount", () => {
  let counter = 0;

  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.user.deleteMany({ where: { handle: { startsWith: HANDLE_PREFIX } } });
    await prisma.game.deleteMany({ where: { platformLinks: { some: { OR: CREATED_TITLES } } } });
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
    expect(attributes).toHaveLength(7);
    const gloria = attributes.find((a) => a.attribute === "gloria")!;
    // Native tiers: HK platinum 15 + 2 gold 10 + 2 silver 4 + 3 bronze 3 = 32;
    // Hades 1 silver + 3 bronze = 5; Astro Bot 2 bronze = 2 -> 39 glory points x 10.
    expect(gloria.points).toBe(390);

    const account = await prisma.linkedAccount.findUniqueOrThrow({
      where: { userId_platform: { userId: user.id, platform: "psn" } },
    });
    expect(account.lastSyncedAt).not.toBeNull();
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

  it("reports private profiles and skips unverified accounts", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncPlatformAccount } = await import("./platform-user");
    const closed = await userWith("psn", "9000000000000000003", "Perfil-Fechado");
    await expect(syncPlatformAccount(closed.id, "psn")).resolves.toMatchObject({ status: "private", newUnlocks: 0 });

    const pending = await userWith("xbox", "2535400000000002-pending", "Tralked Teste", false);
    await expect(syncPlatformAccount(pending.id, "xbox")).resolves.toMatchObject({ status: "unverified" });
    expect(await prisma.xpLedgerEntry.count({ where: { userId: pending.id } })).toBe(0);
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

    await syncPlatformAccount(user.id, "psn");
    const resynced = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    expect(resynced.totalXp).toBe(after.totalXp);
    const unlock = await prisma.userAchievement.findUniqueOrThrow({
      where: { userId_achievementId: { userId: user.id, achievementId: platinumTrophy.id } },
    });
    expect(unlock.suspicious).toBe(true);
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

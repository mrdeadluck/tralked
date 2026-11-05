import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { xpForPlatformAchievement } from "@/lib/engine/trophies";
import { platinumBonus, xpForAchievement } from "@/lib/engine/xp";
import { recomputeUser } from "@/lib/progression/recompute";
import { confirmFraud, listFraudCases, releaseFraud } from "./fraud";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-admin-f` prefix and are removed.

const PREFIX = "test-admin-f";
const APP_ID = 97100002;
const NOW = new Date("2026-10-31T15:00:00Z");
const T0 = new Date("2026-10-20T12:00:00Z");
const PCTS = [2, 4, 6];

let gameId: string;
let achievementIds: string[];

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  await prisma.game.deleteMany({ where: { steamAppId: APP_ID } });
  await prisma.game.deleteMany({ where: { slug: { startsWith: `${PREFIX}-psn` } } });
}

/** A player with a burst-flagged 100% of the test game; `paid` unlocks were paid before the flag. */
async function playerWithBurst(name: string, paid: number) {
  const user = await prisma.user.create({ data: { handle: `${PREFIX}-${name}`, displayName: name } });
  await prisma.userGame.create({
    data: { userId: user.id, gameId, platform: "steam", playtimeMin: 600, unlockedCount: 3 },
  });
  await prisma.userAchievement.createMany({
    data: achievementIds.map((achievementId, i) => ({
      userId: user.id,
      achievementId,
      unlockedAt: new Date(T0.getTime() + i * 1000),
      suspicious: true,
    })),
  });
  await prisma.xpLedgerEntry.createMany({
    data: achievementIds.slice(0, paid).map((achievementId, i) => ({
      userId: user.id,
      source: "achievement",
      sourceKey: achievementId,
      xp: xpForAchievement(PCTS[i]),
      skills: ["rpg"],
      createdAt: new Date(T0.getTime() + i * 1000),
    })),
  });
  await recomputeUser(user.id, NOW);
  return user.id;
}

const stats = (userId: string) => prisma.userStats.findUniqueOrThrow({ where: { userId } });
const key = (userId: string) => ({ userId, gameId, platform: "steam" as const });

beforeAll(async () => {
  await cleanup();
  const game = await prisma.game.create({
    data: {
      slug: `${PREFIX}-game`,
      name: "Jogo da fraude",
      steamAppId: APP_ID,
      achievementCount: 3,
      platforms: ["PC"],
      skills: { create: [{ skill: "rpg" }] },
      achievements: { create: PCTS.map((globalPct, i) => ({ apiName: `F_${i}`, name: `F ${i}`, globalPct })) },
    },
    include: { achievements: { orderBy: { apiName: "asc" } } },
  });
  gameId = game.id;
  achievementIds = game.achievements.map((a) => a.id);
});

afterAll(cleanup);

describe("fraud queue", () => {
  it("groups pending suspicious unlocks by player, game and platform", async () => {
    const userId = await playerWithBurst("listado", 2);
    const found = (await listFraudCases()).find((c) => c.userId === userId);
    expect(found).toMatchObject({
      gameId,
      platform: "steam",
      handle: `${PREFIX}-listado`,
      unlocks: 3,
      total: 3,
      firstAt: T0,
      lastAt: new Date(T0.getTime() + 2000),
      paidXp: xpForAchievement(PCTS[0]) + xpForAchievement(PCTS[1]),
      playtimeMin: 600,
    });
  });

  it("Confirmar fraude voids the XP already paid, lowers the level and leaves the queue", async () => {
    const userId = await playerWithBurst("fraudador", 2);
    const before = await stats(userId);
    expect(before.totalXp).toBe(xpForAchievement(PCTS[0]) + xpForAchievement(PCTS[1]));

    const result = await confirmFraud(key(userId), NOW);
    expect(result).toMatchObject({ ok: true, entries: 2, levelBefore: before.level, handle: `${PREFIX}-fraudador` });

    const after = await stats(userId);
    expect(after.totalXp).toBe(0);
    expect(after.level).toBeLessThan(before.level);
    if (result.ok) expect(result.levelAfter).toBe(after.level);

    const entries = await prisma.xpLedgerEntry.findMany({ where: { userId } });
    expect(entries).toHaveLength(2); // kept, only voided
    expect(entries.every((e) => e.voidedAt?.getTime() === NOW.getTime())).toBe(true);
    const unlocks = await prisma.userAchievement.findMany({ where: { userId } });
    expect(unlocks.every((u) => u.suspicious && u.fraudReview === "confirmed")).toBe(true);

    expect((await listFraudCases()).some((c) => c.userId === userId)).toBe(false);
    expect(await confirmFraud(key(userId), NOW)).toMatchObject({ ok: false });
  });

  it("Liberar pays every unlock and the platinum, clears the flag for good and leaves the queue", async () => {
    const userId = await playerWithBurst("inocente", 1);
    const before = await stats(userId);

    const result = await releaseFraud(key(userId), NOW);
    expect(result).toMatchObject({ ok: true, entries: 3 }); // 2 achievements + platinum (1 was already paid)

    const xps = PCTS.map(xpForAchievement);
    const after = await stats(userId);
    expect(after.totalXp).toBe(xps.reduce((a, b) => a + b, 0) + platinumBonus(xps));
    expect(after.level).toBeGreaterThan(before.level);

    const unlocks = await prisma.userAchievement.findMany({ where: { userId } });
    expect(unlocks.every((u) => !u.suspicious && u.fraudReview === "cleared" && u.fraudReviewedAt?.getTime() === NOW.getTime())).toBe(true);
    const owned = await prisma.userGame.findFirstOrThrow({ where: { userId, gameId } });
    expect(owned.completedAt).toEqual(new Date(T0.getTime() + 2000));
    const platinum = await prisma.xpLedgerEntry.findFirstOrThrow({ where: { userId, source: "platinum" } });
    expect(platinum).toMatchObject({ sourceKey: gameId, platform: null, voidedAt: null }); // as the Steam sync writes it

    expect((await listFraudCases()).some((c) => c.userId === userId)).toBe(false);
    expect(await releaseFraud(key(userId), NOW)).toMatchObject({ ok: false });
  });

  it("Liberar restores entries voided earlier instead of skipping them, and is idempotent", async () => {
    const userId = await playerWithBurst("anulado", 2);
    await prisma.xpLedgerEntry.updateMany({ where: { userId }, data: { voidedAt: NOW } });
    await recomputeUser(userId, NOW);
    expect((await stats(userId)).totalXp).toBe(0);

    const result = await releaseFraud(key(userId), NOW);
    expect(result).toMatchObject({ ok: true, entries: 4 }); // 2 restored + 1 created + platinum

    const xps = PCTS.map(xpForAchievement);
    const full = xps.reduce((a, b) => a + b, 0) + platinumBonus(xps);
    expect((await stats(userId)).totalXp).toBe(full);
    const entries = await prisma.xpLedgerEntry.findMany({ where: { userId } });
    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.voidedAt === null)).toBe(true);

    expect(await releaseFraud(key(userId), NOW)).toMatchObject({ ok: false });
    expect(await prisma.xpLedgerEntry.count({ where: { userId } })).toBe(4);
    expect((await stats(userId)).totalXp).toBe(full);
  });

  it("Liberar counts only upstream achievements for the 100%: an orphan catalog row does not block the platinum", async () => {
    const userId = await playerWithBurst("orfa", 0);
    // A row Steam no longer lists (old seed / removed achievement): the catalog keeps it, but
    // achievementCount (Steam's count today) stays 3, as the sync sees it.
    const orphan = await prisma.achievement.create({
      data: { gameId, platform: "steam", apiName: "F_REMOVED", name: "Removida", globalPct: 1 },
    });
    try {
      const result = await releaseFraud(key(userId), NOW);
      expect(result).toMatchObject({ ok: true, entries: 4 }); // 3 achievements + platinum
      const xps = PCTS.map(xpForAchievement);
      const platinum = await prisma.xpLedgerEntry.findFirstOrThrow({ where: { userId, source: "platinum" } });
      expect(platinum.xp).toBe(platinumBonus(xps));
      expect((await prisma.userGame.findFirstOrThrow({ where: { userId, gameId } })).completedAt).not.toBeNull();
    } finally {
      await prisma.achievement.delete({ where: { id: orphan.id } });
    }
  });

  it("does not release unlocks of a platform account that was unlinked", async () => {
    const userId = await playerWithBurst("desvinculado", 0);
    const psnAchievement = await prisma.achievement.create({
      data: { gameId, platform: "psn", apiName: "PSN_1", name: "PSN 1", trophyTier: "gold" },
    });
    await prisma.userAchievement.create({
      data: { userId, achievementId: psnAchievement.id, unlockedAt: T0, suspicious: true },
    });
    expect(await releaseFraud({ userId, gameId, platform: "psn" }, NOW)).toMatchObject({ ok: false });
    expect(await prisma.xpLedgerEntry.count({ where: { userId, platform: "psn" } })).toBe(0);
  });

  describe("PSN (trophy lists)", () => {
    const tierXp = (tier: "platinum" | "bronze") =>
      xpForPlatformAchievement({ platform: "psn", globalPct: null, points: null, trophyTier: tier, hardcore: false });
    let n = 0;

    /** A linked PSN player with both trophies of a PS5 list unlocked; `flagged` are pending suspicious. */
    async function psnPlayer(name: string, flagged: number[]) {
      n++;
      const user = await prisma.user.create({ data: { handle: `${PREFIX}-${name}`, displayName: name } });
      await prisma.linkedAccount.create({
        data: { userId: user.id, platform: "psn", externalId: `${PREFIX}-psn-${name}`, handle: name },
      });
      const game = await prisma.game.create({
        data: { slug: `${PREFIX}-psn-${n}`, name: `PSN ${n}`, achievementCount: 0, platforms: ["PS5"], skills: { create: [{ skill: "rpg" }] } },
      });
      const list = await prisma.trophyList.create({
        data: { gameId: game.id, platform: "psn", externalId: `${PREFIX}-NPWR${n}`, console: "PS5", name: "PSN" },
      });
      const trophies = [];
      for (const [apiName, trophyTier] of [["0", "platinum"], ["1", "bronze"]] as const) {
        trophies.push(
          await prisma.achievement.create({
            data: { gameId: game.id, platform: "psn", listId: list.id, apiName, name: apiName, trophyTier },
          }),
        );
      }
      await prisma.userAchievement.createMany({
        data: trophies.map((t, i) => ({
          userId: user.id,
          achievementId: t.id,
          unlockedAt: new Date(T0.getTime() + i * 1000),
          suspicious: flagged.includes(i),
        })),
      });
      const complete = flagged.length === 0 ? new Date(T0.getTime() + 1000) : null;
      await prisma.userTrophyList.create({ data: { userId: user.id, listId: list.id, unlockedCount: 2, completedAt: complete } });
      await prisma.userGame.create({
        data: { userId: user.id, gameId: game.id, platform: "psn", playtimeMin: 60, unlockedCount: 2, completedAt: complete },
      });
      return { userId: user.id, gameId: game.id, listId: list.id, trophies };
    }

    it("Liberar pays the released trophies and the version platinum with the list keys", async () => {
      const p = await psnPlayer("psn-inocente", [0, 1]);
      const result = await releaseFraud({ userId: p.userId, gameId: p.gameId, platform: "psn" }, NOW);
      expect(result).toMatchObject({ ok: true, entries: 3 });
      const entries = await prisma.xpLedgerEntry.findMany({ where: { userId: p.userId, voidedAt: null } });
      expect(entries.map((e) => e.sourceKey).sort()).toEqual([...p.trophies.map((t) => t.id), `psn:PS5:${p.gameId}`].sort());
      expect(entries.find((e) => e.source === "platinum")).toMatchObject({
        platform: "psn",
        xp: platinumBonus([tierXp("platinum"), tierXp("bronze")]),
        createdAt: new Date(T0.getTime() + 1000),
      });
      const progress = await prisma.userTrophyList.findUniqueOrThrow({
        where: { userId_listId: { userId: p.userId, listId: p.listId } },
      });
      expect(progress.completedAt).toEqual(new Date(T0.getTime() + 1000));
      const owned = await prisma.userGame.findFirstOrThrow({ where: { userId: p.userId, gameId: p.gameId } });
      expect(owned.completedAt).toEqual(new Date(T0.getTime() + 1000));
      expect(await releaseFraud({ userId: p.userId, gameId: p.gameId, platform: "psn" }, NOW)).toMatchObject({ ok: false });
    });

    it("Liberar restores a voided trophy entry instead of leaving it voided", async () => {
      const p = await psnPlayer("psn-anulado", [1]);
      await prisma.xpLedgerEntry.create({
        data: { userId: p.userId, source: "achievement", sourceKey: p.trophies[1].id, platform: "psn", xp: tierXp("bronze"), skills: ["rpg"], voidedAt: T0 },
      });
      const result = await releaseFraud({ userId: p.userId, gameId: p.gameId, platform: "psn" }, NOW);
      // trophy 0 + restored trophy 1 + platinum
      expect(result).toMatchObject({ ok: true, entries: 3 });
      expect(await prisma.xpLedgerEntry.count({ where: { userId: p.userId } })).toBe(3);
      expect(await prisma.xpLedgerEntry.count({ where: { userId: p.userId, voidedAt: null } })).toBe(3);
    });

    it("Confirmar fraude voids the trophy and the version platinum and clears the list completion", async () => {
      const p = await psnPlayer("psn-fraudador", []);
      const { settleListXp } = await import("@/lib/progression/list-xp");
      await prisma.$transaction((tx) => settleListXp(tx, p.userId, "psn", [p.gameId], T0));
      // Flagged later (a burst seen in another sync), after both were paid.
      await prisma.userAchievement.update({
        where: { userId_achievementId: { userId: p.userId, achievementId: p.trophies[1].id } },
        data: { suspicious: true },
      });
      const result = await confirmFraud({ userId: p.userId, gameId: p.gameId, platform: "psn" }, NOW);
      expect(result).toMatchObject({ ok: true, entries: 2 });
      const left = await prisma.xpLedgerEntry.findMany({ where: { userId: p.userId, voidedAt: null } });
      expect(left.map((e) => e.sourceKey)).toEqual([p.trophies[0].id]);
      const progress = await prisma.userTrophyList.findUniqueOrThrow({
        where: { userId_listId: { userId: p.userId, listId: p.listId } },
      });
      expect(progress.completedAt).toBeNull();
      expect((await prisma.userGame.findFirstOrThrow({ where: { userId: p.userId, gameId: p.gameId } })).completedAt).toBeNull();
    });
  });
});

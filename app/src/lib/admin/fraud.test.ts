import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
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
    expect(platinum).toMatchObject({ sourceKey: gameId, platform: "steam", voidedAt: null });

    expect((await listFraudCases()).some((c) => c.userId === userId)).toBe(false);
    expect(await releaseFraud(key(userId), NOW)).toMatchObject({ ok: false });
  });
});

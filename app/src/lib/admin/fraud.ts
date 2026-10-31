import { z } from "zod";
import { xpForPlatformAchievement, type TrophyTier } from "@/lib/engine/trophies";
import { platinumBonus } from "@/lib/engine/xp";
import { prisma } from "@/lib/db";
import { platinumSourceKey, recomputeUser, voidFraudEntries } from "@/lib/progression/recompute";

/**
 * Fraud queue: unlocks the anti-fraud rules flagged (bursts, speed platinum) that no admin has
 * decided on yet, grouped by player, game and platform.
 *
 * - "Confirmar fraude": `voidFraudEntries` voids the XP already paid for them (and the game's
 *   platinum and missions that depended on them), the unlocks stay suspicious, and the level is
 *   recomputed. The decision is recorded (`fraudReview = confirmed`).
 * - "Liberar": the unlocks are no longer suspicious, they are paid as the sync would have paid
 *   them (plus the platinum when the game is now a clean 100%), and the rules never flag them
 *   again (`fraudReview = cleared`, honored by the syncs). Entries voided before are restored,
 *   never duplicated; a second release finds nothing pending.
 */

export const fraudCaseSchema = z.strictObject({
  userId: z.string().min(1).max(64),
  gameId: z.string().min(1).max(64),
  platform: z.enum(["steam", "psn", "xbox", "retro"]),
});
export type FraudCaseKey = z.output<typeof fraudCaseSchema>;

export type FraudCase = FraudCaseKey & {
  handle: string;
  displayName: string;
  level: number | null;
  gameName: string;
  gameSlug: string;
  unlocks: number;
  /** Achievements of the game on that platform. */
  total: number;
  firstAt: Date;
  lastAt: Date;
  /** XP currently counted for these unlocks (entries paid before they were flagged). */
  paidXp: number;
  playtimeMin: number | null;
};

const CASE_ROW_LIMIT = 5000;

const pendingWhere = (key?: FraudCaseKey) => ({
  suspicious: true,
  fraudReview: null,
  ...(key ? { userId: key.userId, achievement: { gameId: key.gameId, platform: key.platform } } : {}),
});

export async function listFraudCases(): Promise<FraudCase[]> {
  const rows = await prisma.userAchievement.findMany({
    where: pendingWhere(),
    orderBy: { unlockedAt: "asc" },
    take: CASE_ROW_LIMIT,
    select: {
      userId: true,
      achievementId: true,
      unlockedAt: true,
      achievement: { select: { gameId: true, platform: true } },
    },
  });
  const groups = new Map<string, { key: FraudCaseKey; ids: string[]; firstAt: Date; lastAt: Date }>();
  for (const r of rows) {
    const key = { userId: r.userId, gameId: r.achievement.gameId, platform: r.achievement.platform as FraudCaseKey["platform"] };
    const id = `${key.userId}|${key.gameId}|${key.platform}`;
    const group = groups.get(id) ?? { key, ids: [], firstAt: r.unlockedAt, lastAt: r.unlockedAt };
    group.ids.push(r.achievementId);
    if (r.unlockedAt < group.firstAt) group.firstAt = r.unlockedAt;
    if (r.unlockedAt > group.lastAt) group.lastAt = r.unlockedAt;
    groups.set(id, group);
  }
  if (groups.size === 0) return [];

  const list = [...groups.values()];
  const userIds = [...new Set(list.map((g) => g.key.userId))];
  const gameIds = [...new Set(list.map((g) => g.key.gameId))];
  const [users, games, paid, totals, owned] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, handle: true, displayName: true, stats: { select: { level: true } } } }),
    prisma.game.findMany({ where: { id: { in: gameIds } }, select: { id: true, name: true, slug: true, achievementCount: true } }),
    prisma.xpLedgerEntry.findMany({
      where: { userId: { in: userIds }, source: "achievement", voidedAt: null, sourceKey: { in: list.flatMap((g) => g.ids) } },
      select: { userId: true, sourceKey: true, xp: true },
    }),
    prisma.achievement.groupBy({ by: ["gameId", "platform"], where: { gameId: { in: gameIds } }, _count: { _all: true } }),
    prisma.userGame.findMany({ where: { userId: { in: userIds }, gameId: { in: gameIds } }, select: { userId: true, gameId: true, platform: true, playtimeMin: true } }),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const gameById = new Map(games.map((g) => [g.id, g]));
  const paidBy = new Map(paid.map((e) => [`${e.userId}|${e.sourceKey}`, e.xp]));
  const totalBy = new Map(totals.map((t) => [`${t.gameId}|${t.platform}`, t._count._all]));
  const playtimeBy = new Map(owned.map((o) => [`${o.userId}|${o.gameId}|${o.platform}`, o.playtimeMin]));

  return list
    .flatMap((g): FraudCase[] => {
      const user = userById.get(g.key.userId);
      const game = gameById.get(g.key.gameId);
      if (!user || !game) return [];
      const rowsTotal = totalBy.get(`${game.id}|${g.key.platform}`) ?? 0;
      return [
        {
          ...g.key,
          handle: user.handle,
          displayName: user.displayName,
          level: user.stats?.level ?? null,
          gameName: game.name,
          gameSlug: game.slug,
          unlocks: g.ids.length,
          total: g.key.platform === "steam" ? Math.max(game.achievementCount, rowsTotal) : rowsTotal,
          firstAt: g.firstAt,
          lastAt: g.lastAt,
          paidXp: g.ids.reduce((sum, id) => sum + (paidBy.get(`${g.key.userId}|${id}`) ?? 0), 0),
          playtimeMin: playtimeBy.get(`${g.key.userId}|${g.key.gameId}|${g.key.platform}`) ?? null,
        },
      ];
    })
    .sort((a, b) => a.handle.localeCompare(b.handle) || a.gameName.localeCompare(b.gameName));
}

export type FraudDecisionResult =
  | { ok: true; entries: number; levelBefore: number | null; levelAfter: number | null; gameSlug: string; handle: string }
  | { ok: false; error: string };

const NO_CASE = { ok: false, error: "Esse caso já foi decidido ou não existe mais." } as const;

async function pendingIds(key: FraudCaseKey): Promise<string[]> {
  const rows = await prisma.userAchievement.findMany({ where: pendingWhere(key), select: { achievementId: true } });
  return rows.map((r) => r.achievementId);
}

async function levelOf(userId: string): Promise<number | null> {
  return (await prisma.userStats.findUnique({ where: { userId }, select: { level: true } }))?.level ?? null;
}

async function caseLabels(key: FraudCaseKey) {
  const [user, game] = await Promise.all([
    prisma.user.findUnique({ where: { id: key.userId }, select: { handle: true } }),
    prisma.game.findUnique({ where: { id: key.gameId }, select: { slug: true } }),
  ]);
  return { handle: user?.handle ?? "", gameSlug: game?.slug ?? "" };
}

/** Confirmed fraud: voids the XP of the case's unlocks (see voidFraudEntries) and records the decision. */
export async function confirmFraud(key: FraudCaseKey, now: Date = new Date()): Promise<FraudDecisionResult> {
  const ids = await pendingIds(key);
  if (ids.length === 0) return NO_CASE;
  const levelBefore = await levelOf(key.userId);
  const entries = await voidFraudEntries(key.userId, ids, now);
  await prisma.userAchievement.updateMany({
    where: { userId: key.userId, achievementId: { in: ids } },
    data: { suspicious: true, fraudReview: "confirmed", fraudReviewedAt: now },
  });
  return { ok: true, entries, levelBefore, levelAfter: await levelOf(key.userId), ...(await caseLabels(key)) };
}

/**
 * Released: the unlocks count again. Pays each one as the sync would (same XP formula, frozen
 * at its unlock time), plus the platinum bonus when every achievement of the game on that platform
 * is now a valid unlock, then recomputes. Entries already in the ledger are never paid twice.
 */
export async function releaseFraud(key: FraudCaseKey, now: Date = new Date()): Promise<FraudDecisionResult> {
  const ids = await pendingIds(key);
  if (ids.length === 0) return NO_CASE;
  if (key.platform !== "steam") {
    // An unlinked platform account no longer pays (its entries were voided on unlink).
    const linked = await prisma.linkedAccount.findFirst({
      where: { userId: key.userId, platform: key.platform, verifiedAt: { not: null } },
      select: { id: true },
    });
    if (!linked) return { ok: false, error: "A conta dessa plataforma foi desvinculada: não há o que liberar." };
  }
  const levelBefore = await levelOf(key.userId);
  // Same value the syncs write: Steam entries carry no platform, the others carry theirs.
  const ledgerPlatform = key.platform === "steam" ? null : key.platform;

  const game = await prisma.game.findUniqueOrThrow({
    where: { id: key.gameId },
    select: {
      achievementCount: true,
      skills: { select: { skill: true } },
      achievements: {
        where: { platform: key.platform },
        select: { id: true, globalPct: true, points: true, trophyTier: true },
      },
    },
  });
  const skills = game.skills.map((s) => s.skill);
  const xpOf = (a: (typeof game.achievements)[number], hardcore: boolean) =>
    xpForPlatformAchievement({
      platform: key.platform,
      globalPct: a.globalPct,
      points: a.points,
      trophyTier: a.trophyTier as TrophyTier | null,
      hardcore,
    });
  const achievementById = new Map(game.achievements.map((a) => [a.id, a]));

  const entries = await prisma.$transaction(async (tx) => {
    await tx.userAchievement.updateMany({
      where: { userId: key.userId, achievementId: { in: ids } },
      data: { suspicious: false, fraudReview: "cleared", fraudReviewedAt: now },
    });
    const unlocks = await tx.userAchievement.findMany({
      where: { userId: key.userId, achievement: { gameId: key.gameId, platform: key.platform } },
      select: { achievementId: true, unlockedAt: true, suspicious: true, hardcore: true },
    });
    const released = unlocks.filter((u) => ids.includes(u.achievementId));
    const ledger = released.flatMap((u) => {
      const a = achievementById.get(u.achievementId);
      return a
        ? [
            {
              userId: key.userId,
              source: "achievement",
              sourceKey: u.achievementId,
              platform: ledgerPlatform,
              xp: xpOf(a, u.hardcore),
              skills,
              createdAt: u.unlockedAt,
            },
          ]
        : [];
    });

    // Like the Steam sync, completion only counts what the game has upstream today:
    // `achievementCount` is Steam's current count (the catalog sync writes it), while the catalog
    // may keep rows Steam no longer lists (removed achievements, old seed rows) that nobody can
    // unlock. Other platforms keep only their current list's rows.
    const total =
      key.platform === "steam" && game.achievementCount > 0 ? game.achievementCount : game.achievements.length;
    const clean = unlocks.filter((u) => !u.suspicious);
    if (total > 0 && clean.length >= total) {
      const completedAt = new Date(Math.max(...clean.map((u) => u.unlockedAt.getTime())));
      await tx.userGame.updateMany({
        where: { userId: key.userId, gameId: key.gameId, platform: key.platform },
        data: { completedAt },
      });
      ledger.push({
        userId: key.userId,
        source: "platinum",
        sourceKey: platinumSourceKey(key.platform, key.gameId),
        platform: ledgerPlatform,
        // Over the unlocked (upstream) achievements, as the syncs compute it: orphans add nothing.
        xp: platinumBonus(clean.flatMap((u) => achievementById.get(u.achievementId) ?? []).map((a) => xpOf(a, false))),
        skills,
        createdAt: completedAt,
      });
    }
    // An entry voided earlier (e.g. by a past decision) is restored instead of being skipped by
    // the unique key, so the released unlock really pays; then the missing ones are created.
    const restored = await tx.xpLedgerEntry.updateMany({
      where: {
        userId: key.userId,
        voidedAt: { not: null },
        OR: ledger.map((e) => ({ source: e.source, sourceKey: e.sourceKey })),
      },
      data: { voidedAt: null },
    });
    const { count } = await tx.xpLedgerEntry.createMany({ data: ledger, skipDuplicates: true });
    return restored.count + count;
  });

  await recomputeUser(key.userId, now);
  return { ok: true, entries, levelBefore, levelAfter: await levelOf(key.userId), ...(await caseLabels(key)) };
}

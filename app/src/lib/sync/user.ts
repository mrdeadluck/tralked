import type { Achievement, Game, GameSkill, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { findBursts, isSpeedPlatinum } from "@/lib/engine/fraud";
import type { SkillId } from "@/lib/engine/types";
import { SKILLS } from "@/lib/engine/types";
import { platinumBonus, xpForAchievement } from "@/lib/engine/xp";
import { getSteam } from "@/lib/integrations";
import { recomputeUser } from "@/lib/progression/recompute";
import { syncGame } from "./catalog";

export type SyncUserResult = {
  status: "ok" | "private";
  newUnlocks: number;
  levelBefore: number;
  levelAfter: number;
  skillUps: SkillId[];
};

type CatalogGame = Game & { achievements: Achievement[]; skills: GameSkill[] };

/** A game the user owns, with the achievements they have unlocked (times from Steam's `unlocktime`). */
type FetchedGame = {
  game: CatalogGame;
  playtimeMin: number;
  unlocks: { achievementId: string; unlockedAt: Date }[];
};

const STEAM_CONCURRENCY = 5;
const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

function loadGame(appId: number): Promise<CatalogGame | null> {
  return prisma.game.findUnique({
    where: { steamAppId: appId },
    include: { achievements: true, skills: true },
  });
}

/** Runs `worker` over `items` with at most `limit` in flight; stops taking items once `stop()` is true. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  stop: () => boolean,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !stop()) {
      const item = items[next++];
      results.push(await worker(item));
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Reads the user's achievements of one game from Steam. Games unknown to the catalog are
 * created on demand when they have achievements; games without achievements are skipped.
 */
async function fetchGame(
  steamId: string,
  owned: { appId: number; playtimeMin: number },
): Promise<FetchedGame | "private" | null> {
  const steam = getSteam();
  const achievements = await steam.getPlayerAchievements(steamId, owned.appId);
  if (achievements === "private") return "private";
  if (achievements.length === 0) return null;

  let game = await loadGame(owned.appId);
  // Unknown game, or Steam has achievements the catalog doesn't know yet (new DLC).
  const known = new Set(game?.achievements.map((a) => a.apiName));
  if (!game || achievements.some((a) => !known.has(a.apiName))) {
    if (await syncGame(owned.appId)) game = await loadGame(owned.appId);
  }
  if (!game) return null;

  const idByApiName = new Map(game.achievements.map((a) => [a.apiName, a.id]));
  const unlocks = achievements.flatMap((a) => {
    const achievementId = idByApiName.get(a.apiName);
    return achievementId && a.unlockedAt ? [{ achievementId, unlockedAt: a.unlockedAt }] : [];
  });
  return { game, playtimeMin: owned.playtimeMin, unlocks };
}

type KnownUnlock = { unlockedAt: Date; suspicious: boolean };

/**
 * Records one game in a single transaction: UserGame, UserAchievement (with the anti-fraud
 * verdict) and the ledger entries of the valid unlocks plus the platinum bonus. Every insert is
 * idempotent (unique keys + skipDuplicates), so concurrent or repeated syncs never double-count,
 * and XP of entries already in the ledger is never rewritten (it is frozen at record time).
 * Returns how many unlocks were new.
 */
async function recordGame(
  userId: string,
  fetched: FetchedGame,
  known: Map<string, KnownUnlock>,
  bursts: Set<string>,
): Promise<number> {
  const { game, playtimeMin, unlocks } = fetched;
  const gameSkills = game.skills.map((s) => s.skill);
  const total = Math.max(game.achievementCount, game.achievements.length);
  const complete = unlocks.length >= total;
  const speedRun = complete && isSpeedPlatinum(playtimeMin, game.timeToBeatCompleteMin);
  const completedAt = complete
    ? new Date(Math.max(...unlocks.map((u) => u.unlockedAt.getTime())))
    : null;

  const rows = unlocks.map((u) => ({
    ...u,
    // Once flagged, an unlock stays flagged until a reviewer clears it.
    suspicious: known.get(u.achievementId)?.suspicious || bursts.has(u.achievementId) || speedRun,
  }));
  const pctById = new Map(game.achievements.map((a) => [a.id, a.globalPct]));

  return prisma.$transaction(async (tx) => {
    await tx.userGame.createMany({
      data: [{ userId, gameId: game.id, playtimeMin, unlockedCount: unlocks.length, completedAt }],
      skipDuplicates: true,
    });
    await tx.userGame.update({
      where: { userId_gameId: { userId, gameId: game.id } },
      data: { playtimeMin, unlockedCount: unlocks.length, completedAt },
    });

    const created = await tx.userAchievement.createMany({
      data: rows
        .filter((r) => !known.has(r.achievementId))
        .map((r) => ({ userId, ...r })),
      skipDuplicates: true,
    });
    for (const r of rows) {
      const before = known.get(r.achievementId);
      if (
        before &&
        (before.suspicious !== r.suspicious || before.unlockedAt.getTime() !== r.unlockedAt.getTime())
      ) {
        await tx.userAchievement.update({
          where: { userId_achievementId: { userId, achievementId: r.achievementId } },
          data: { suspicious: r.suspicious, unlockedAt: r.unlockedAt },
        });
      }
    }

    const ledger = rows
      .filter((r) => !r.suspicious)
      .map((r) => ({
        userId,
        source: "achievement",
        sourceKey: r.achievementId,
        xp: xpForAchievement(pctById.get(r.achievementId) ?? null),
        skills: gameSkills,
        createdAt: r.unlockedAt,
      }));
    if (complete && rows.every((r) => !r.suspicious)) {
      ledger.push({
        userId,
        source: "platinum",
        sourceKey: game.id,
        xp: platinumBonus(game.achievements.map((a) => xpForAchievement(a.globalPct))),
        skills: gameSkills,
        createdAt: completedAt ?? new Date(),
      });
    }
    await tx.xpLedgerEntry.createMany({ data: ledger, skipDuplicates: true });
    return created.count;
  }, TRANSACTION_OPTIONS);
}

async function currentProgress(userId: string) {
  const [stats, skills] = await Promise.all([
    prisma.userStats.findUnique({ where: { userId } }),
    prisma.skillProgress.findMany({ where: { userId } }),
  ]);
  return {
    level: stats?.level ?? 1,
    skillLevels: new Map(skills.map((s) => [s.skill, s.level])),
  };
}

/**
 * Imports the user's Steam achievements (history included), applies the anti-fraud rules,
 * appends XP to the ledger and recomputes level, skills, missions and streak.
 * Idempotent: running it again changes nothing unless Steam has new unlocks.
 */
export async function syncUser(userId: string): Promise<SyncUserResult> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const before = await currentProgress(userId);
  const steam = getSteam();

  // Recorded first so a user that keeps failing still rotates to the back of the cron queue.
  await prisma.user.update({ where: { id: userId }, data: { lastSyncAttemptAt: new Date() } });

  const privateResult = async (): Promise<SyncUserResult> => {
    await prisma.user.update({ where: { id: userId }, data: { profilePublic: false } });
    return { status: "private", newUnlocks: 0, levelBefore: before.level, levelAfter: before.level, skillUps: [] };
  };

  const summary = await steam.getPlayerSummary(user.steamId);
  await prisma.user.update({
    where: { id: userId },
    data: {
      profilePublic: summary.profilePublic,
      displayName: summary.personaName,
      avatarUrl: summary.avatarUrl,
    },
  });
  if (!summary.profilePublic) return privateResult();

  // Games never played have no unlocks; skipping them saves most of a big library's API calls.
  const owned = (await steam.getOwnedGames(user.steamId)).filter((g) => g.playtimeMin > 0);
  let sawPrivate = false;
  let failures = 0;
  let firstError: unknown;
  const results = await mapPool(owned, STEAM_CONCURRENCY, () => sawPrivate, async (game) => {
    try {
      const fetched = await fetchGame(user.steamId, game);
      if (fetched === "private") sawPrivate = true;
      return fetched;
    } catch (error) {
      // One broken game must not block the rest; it is retried on the next sync.
      failures++;
      firstError ??= error;
      console.error(`Sync: could not read Steam app ${game.appId} for user ${userId}`, error);
      return null;
    }
  });
  if (sawPrivate) return privateResult();
  if (owned.length > 0 && failures === owned.length) throw firstError;

  const fetchedGames = results.filter((r): r is FetchedGame => r !== null && r !== "private");

  // Anti-fraud looks at all of the user's unlocks together (bursts can span games), using
  // Steam's real unlock times, so importing old history never trips the burst rule by itself.
  const known = new Map<string, KnownUnlock>(
    (
      await prisma.userAchievement.findMany({
        where: { userId },
        select: { achievementId: true, unlockedAt: true, suspicious: true },
      })
    ).map((r) => [r.achievementId, { unlockedAt: r.unlockedAt, suspicious: r.suspicious }]),
  );
  const everyUnlock = new Map(
    [...known].map(([achievementId, k]) => [achievementId, { achievementId, unlockedAt: k.unlockedAt }]),
  );
  for (const { unlocks } of fetchedGames) {
    for (const u of unlocks) everyUnlock.set(u.achievementId, u);
  }
  const bursts = findBursts([...everyUnlock.values()]);

  let newUnlocks = 0;
  for (const fetched of fetchedGames) {
    newUnlocks += await recordGame(userId, fetched, known, bursts);
  }

  await recomputeUser(userId);
  await prisma.user.update({ where: { id: userId }, data: { lastSyncedAt: new Date() } });

  const after = await currentProgress(userId);
  return {
    status: "ok",
    newUnlocks,
    levelBefore: before.level,
    levelAfter: after.level,
    skillUps: SKILLS.map((s) => s.id).filter(
      (id) => (after.skillLevels.get(id) ?? 1) > (before.skillLevels.get(id) ?? 1),
    ),
  };
}

/**
 * Cron job: syncs the `limit` users whose last attempt is oldest (never attempted first),
 * private ones included so a profile that turned public is picked up. Ordering by attempt
 * (not success) keeps users that keep failing from starving the batch. `where` narrows the
 * candidates (tests).
 */
export async function syncStaleUsers(
  limit = 50,
  where: Prisma.UserWhereInput = {},
): Promise<{ processed: number; failed: number }> {
  const users = await prisma.user.findMany({
    where,
    orderBy: { lastSyncAttemptAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { id: true },
  });
  let processed = 0;
  let failed = 0;
  for (const { id } of users) {
    try {
      await syncUser(id);
      processed++;
    } catch (error) {
      failed++;
      console.error(`Cron: could not sync user ${id}`, error);
    }
  }
  return { processed, failed };
}

import { prisma } from "@/lib/db";
import { findBursts, isSpeedPlatinum } from "@/lib/engine/fraud";
import { xpForPlatformAchievement } from "@/lib/engine/trophies";
import { platinumBonus } from "@/lib/engine/xp";
import { platinumSourceKey, recomputeUser } from "@/lib/progression/recompute";
import { loadNameIndex, resolvePlatformGame } from "./platform-games";
import {
  CODE_PLATFORMS,
  readLibrary,
  type CodePlatform,
  type LibraryAchievement,
  type LibraryTitle,
} from "./platform-library";

export type SyncPlatformResult = {
  status: "ok" | "private" | "unverified";
  newUnlocks: number;
  levelBefore: number;
  levelAfter: number;
};

const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

type KnownUnlock = { unlockedAt: Date; suspicious: boolean; hardcore: boolean };

const xpOf = (platform: CodePlatform, a: LibraryAchievement, hardcore: boolean) =>
  xpForPlatformAchievement({
    platform,
    globalPct: a.globalPct,
    points: a.points,
    trophyTier: a.trophyTier,
    hardcore,
  });

/**
 * Records one platform title in a single transaction: the platform's Achievement rows, the
 * UserGame of that platform, UserAchievement (with the anti-fraud verdict and the hardcore flag)
 * and ledger entries (`platform` set) for valid unlocks plus the completion bonus. Every insert
 * is idempotent and XP already in the ledger is never rewritten. Returns how many unlocks were new.
 */
async function recordTitle(
  userId: string,
  platform: CodePlatform,
  gameId: string,
  title: LibraryTitle,
  known: Map<string, KnownUnlock>,
  bursts: Set<string>,
): Promise<number> {
  const game = await prisma.game.findUniqueOrThrow({
    where: { id: gameId },
    select: { timeToBeatCompleteMin: true, skills: { select: { skill: true } } },
  });
  const gameSkills = game.skills.map((s) => s.skill);
  const fields = (a: LibraryAchievement) => ({
    name: a.name,
    description: a.description,
    iconUrl: a.iconUrl,
    hidden: a.hidden,
    globalPct: a.globalPct,
    trophyTier: a.trophyTier,
    points: a.points,
  });

  return prisma.$transaction(async (tx) => {
    const existing = await tx.achievement.findMany({ where: { gameId, platform } });
    const byApiName = new Map(existing.map((r) => [r.apiName, r]));
    await tx.achievement.createMany({
      data: title.achievements
        .filter((a) => !byApiName.has(a.apiName))
        .map((a) => ({ gameId, platform, apiName: a.apiName, ...fields(a) })),
      skipDuplicates: true,
    });
    for (const a of title.achievements) {
      const row = byApiName.get(a.apiName);
      if (!row) continue;
      const next = fields(a);
      const changed = (Object.keys(next) as (keyof typeof next)[]).some((k) => next[k] !== row[k]);
      if (changed) await tx.achievement.update({ where: { id: row.id }, data: next });
    }
    const rows = await tx.achievement.findMany({
      where: { gameId, platform },
      select: { id: true, apiName: true },
    });
    const idOf = new Map(rows.map((r) => [r.apiName, r.id]));

    const unlocked = title.achievements.flatMap((a) => {
      const achievementId = idOf.get(a.apiName);
      return achievementId && a.unlockedAt ? [{ a, achievementId, unlockedAt: a.unlockedAt }] : [];
    });
    const complete = unlocked.length > 0 && unlocked.length >= title.achievements.length;
    const playtimeKnown = title.playtimeMin !== null && title.playtimeMin > 0;
    const speedRun =
      complete && playtimeKnown && isSpeedPlatinum(title.playtimeMin ?? 0, game.timeToBeatCompleteMin);
    const completedAt = complete
      ? new Date(Math.max(...unlocked.map((u) => u.unlockedAt.getTime())))
      : null;

    const verdicts = unlocked.map((u) => {
      const before = known.get(u.achievementId);
      return {
        ...u,
        // Sticky like the Steam sync: once suspicious (rule or admin), always suspicious.
        suspicious: before?.suspicious || bursts.has(u.achievementId) || speedRun,
        // A softcore unlock later redone in hardcore is upgraded, never downgraded.
        hardcore: u.a.hardcore || (before?.hardcore ?? false),
      };
    });

    const playtimeMin = title.playtimeMin ?? 0;
    await tx.userGame.upsert({
      where: { userId_gameId_platform: { userId, gameId, platform } },
      create: { userId, gameId, platform, playtimeMin, unlockedCount: unlocked.length, completedAt },
      update: {
        // Platforms without playtime keep whatever was recorded before.
        ...(title.playtimeMin !== null && { playtimeMin }),
        unlockedCount: unlocked.length,
        completedAt,
      },
    });

    const created = await tx.userAchievement.createMany({
      data: verdicts
        .filter((v) => !known.has(v.achievementId))
        .map((v) => ({
          userId,
          achievementId: v.achievementId,
          unlockedAt: v.unlockedAt,
          suspicious: v.suspicious,
          hardcore: v.hardcore,
        })),
      skipDuplicates: true,
    });
    for (const v of verdicts) {
      const before = known.get(v.achievementId);
      if (
        before &&
        (before.suspicious !== v.suspicious ||
          before.hardcore !== v.hardcore ||
          before.unlockedAt.getTime() !== v.unlockedAt.getTime())
      ) {
        await tx.userAchievement.update({
          where: { userId_achievementId: { userId, achievementId: v.achievementId } },
          data: { suspicious: v.suspicious, hardcore: v.hardcore, unlockedAt: v.unlockedAt },
        });
      }
    }

    const ledger = verdicts
      .filter((v) => !v.suspicious)
      .map((v) => ({
        userId,
        source: "achievement",
        sourceKey: v.achievementId,
        platform,
        xp: xpOf(platform, v.a, v.hardcore),
        skills: gameSkills,
        createdAt: v.unlockedAt,
      }));
    if (complete && verdicts.every((v) => !v.suspicious)) {
      ledger.push({
        userId,
        source: "platinum",
        sourceKey: platinumSourceKey(platform, gameId),
        platform,
        xp: platinumBonus(title.achievements.map((a) => xpOf(platform, a, false))),
        skills: gameSkills,
        createdAt: completedAt ?? new Date(),
      });
    }
    await tx.xpLedgerEntry.createMany({ data: ledger, skipDuplicates: true });
    return created.count;
  }, TRANSACTION_OPTIONS);
}

async function currentLevel(userId: string): Promise<number> {
  const stats = await prisma.userStats.findUnique({ where: { userId }, select: { level: true } });
  return stats?.level ?? 1;
}

/**
 * Imports the user's progress on one linked platform (PSN, Xbox or RetroAchievements): maps
 * every title to a catalog game, records unlocks with the anti-fraud rules, appends XP to the
 * ledger and recomputes level, skills, attributes, missions and streak. Only verified accounts
 * are read. Idempotent: running it again changes nothing unless the platform has new unlocks.
 */
export async function syncPlatformAccount(
  userId: string,
  platform: CodePlatform,
): Promise<SyncPlatformResult> {
  const levelBefore = await currentLevel(userId);
  const unchanged = (status: SyncPlatformResult["status"]): SyncPlatformResult => ({
    status,
    newUnlocks: 0,
    levelBefore,
    levelAfter: levelBefore,
  });

  const account = await prisma.linkedAccount.findUnique({
    where: { userId_platform: { userId, platform } },
  });
  if (!account?.verifiedAt) return unchanged("unverified");
  // Recorded first so an account that keeps failing still rotates to the back of the cron queue.
  await prisma.linkedAccount.update({
    where: { id: account.id },
    data: { lastSyncAttemptAt: new Date() },
  });

  const library = await readLibrary(platform, {
    externalId: account.externalId,
    handle: account.handle,
  });
  if (library === "private") return unchanged("private");
  for (const failure of library.failures) {
    console.error(
      `Platform sync: could not read ${platform} title ${failure.externalId} for user ${userId}`,
      failure.error,
    );
  }
  if (library.titles.length === 0 && library.failures.length > 0) throw library.failures[0].error;

  const names = await loadNameIndex();
  const resolved: { gameId: string; title: LibraryTitle }[] = [];
  for (const title of library.titles) {
    resolved.push({ gameId: await resolvePlatformGame(platform, title, names), title });
  }

  // Anti-fraud looks at all of the user's unlocks on this platform together (bursts can span games).
  const known = new Map<string, KnownUnlock>(
    (
      await prisma.userAchievement.findMany({
        where: { userId, achievement: { platform } },
        select: { achievementId: true, unlockedAt: true, suspicious: true, hardcore: true },
      })
    ).map((r) => [r.achievementId, r]),
  );
  const ids = await prisma.achievement.findMany({
    where: { platform, gameId: { in: resolved.map((r) => r.gameId) } },
    select: { id: true, gameId: true, apiName: true },
  });
  const idByKey = new Map(ids.map((a) => [`${a.gameId}:${a.apiName}`, a.id]));
  const everyUnlock = new Map(
    [...known].map(([achievementId, k]) => [achievementId, { achievementId, unlockedAt: k.unlockedAt }]),
  );
  for (const { gameId, title } of resolved) {
    for (const a of title.achievements) {
      const id = idByKey.get(`${gameId}:${a.apiName}`);
      // Achievements new to the catalog get their id on record; they join the burst check next sync.
      if (id && a.unlockedAt) everyUnlock.set(id, { achievementId: id, unlockedAt: a.unlockedAt });
    }
  }
  const bursts = findBursts([...everyUnlock.values()]);

  let newUnlocks = 0;
  for (const { gameId, title } of resolved) {
    newUnlocks += await recordTitle(userId, platform, gameId, title, known, bursts);
  }

  await recomputeUser(userId);
  await prisma.linkedAccount.update({
    where: { id: account.id },
    data: { lastSyncedAt: new Date(), ...(library.handle && { handle: library.handle }) },
  });
  return { status: "ok", newUnlocks, levelBefore, levelAfter: await currentLevel(userId) };
}

/**
 * Cron job: syncs the `limit` verified PSN/Xbox/RA accounts whose last attempt is oldest
 * (never attempted first), so failing accounts cannot starve the batch.
 */
export async function syncStalePlatformAccounts(
  limit = 30,
): Promise<{ processed: number; failed: number }> {
  const accounts = await prisma.linkedAccount.findMany({
    where: { platform: { in: [...CODE_PLATFORMS] }, verifiedAt: { not: null } },
    orderBy: { lastSyncAttemptAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { userId: true, platform: true },
  });
  let processed = 0;
  let failed = 0;
  for (const { userId, platform } of accounts) {
    try {
      await syncPlatformAccount(userId, platform as CodePlatform);
      processed++;
    } catch (error) {
      failed++;
      console.error(`Cron: could not sync ${platform} account of user ${userId}`, error);
    }
  }
  return { processed, failed };
}

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
  /** False when Steam hides the user's playtime (every game reports 0). */
  playtimeKnown: boolean;
  unlocks: { achievementId: string; unlockedAt: Date }[];
};

const STEAM_CONCURRENCY = 5;
/**
 * Upper bound of catalog games probed when Steam cannot list the user's library (keyless
 * community adapter). Each probe is one throttled request (about 1.2 s), so this caps a sync.
 */
export const CATALOG_PROBE_LIMIT = 500;
const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

function loadGame(appId: number): Promise<CatalogGame | null> {
  return prisma.game.findUnique({
    where: { steamAppId: appId },
    // Steam sync only sees the game's Steam achievements (PSN/Xbox/RA rows share the game).
    include: { achievements: { where: { platform: "steam" } }, skills: true },
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
  playtimeKnown: boolean,
  requireUnlock: boolean,
): Promise<FetchedGame | "private" | null> {
  const steam = getSteam();
  const achievements = await steam.getPlayerAchievements(steamId, owned.appId);
  if (achievements === "private") return "private";
  if (achievements.length === 0) return null;
  // A probed game is not known to be owned: only one with an unlock enters the library.
  if (requireUnlock && !achievements.some((a) => a.unlockedAt)) return null;

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
  return { game, playtimeMin: owned.playtimeMin, playtimeKnown, unlocks };
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
  const { game, playtimeMin, playtimeKnown, unlocks } = fetched;
  const gameSkills = game.skills.map((s) => s.skill);
  const total = Math.max(game.achievementCount, game.achievements.length);
  const complete = unlocks.length >= total;
  // Without playtime there is no evidence of a speed run, so the rule cannot apply.
  const speedRun =
    complete && playtimeKnown && isSpeedPlatinum(playtimeMin, game.timeToBeatCompleteMin);
  const completedAt = complete
    ? new Date(Math.max(...unlocks.map((u) => u.unlockedAt.getTime())))
    : null;

  const rows = unlocks.map((u) => ({
    ...u,
    // Sticky: the stored flag is OR-ed in, so no sync ever clears it. Bursts (over all of the
    // user's unlocks) and the speed-platinum rule are re-evaluated on every sync, so clearing the
    // flag by hand does not last while either rule still matches: the next sync sets it again.
    suspicious: known.get(u.achievementId)?.suspicious || bursts.has(u.achievementId) || speedRun,
  }));
  const pctById = new Map(game.achievements.map((a) => [a.id, a.globalPct]));

  return prisma.$transaction(async (tx) => {
    await tx.userGame.createMany({
      data: [
        { userId, gameId: game.id, platform: "steam", playtimeMin, unlockedCount: unlocks.length, completedAt },
      ],
      skipDuplicates: true,
    });
    await tx.userGame.update({
      where: { userId_gameId_platform: { userId, gameId: game.id, platform: "steam" } },
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

/** The catalog's Steam games with achievements, oldest first (the bootstrap adds the most owned first). */
async function catalogProbeCandidates(): Promise<{ appId: number; playtimeMin: number }[]> {
  const games = await prisma.game.findMany({
    where: { steamAppId: { not: null }, achievementCount: { gt: 0 } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: CATALOG_PROBE_LIMIT,
    select: { steamAppId: true },
  });
  return games.flatMap((g) => (g.steamAppId === null ? [] : [{ appId: g.steamAppId, playtimeMin: 0 }]));
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
  const steamId = user.steamId;
  const before = await currentProgress(userId);
  const steam = getSteam();

  // Recorded first so a user that keeps failing still rotates to the back of the cron queue.
  await prisma.user.update({ where: { id: userId }, data: { lastSyncAttemptAt: new Date() } });

  const privateResult = async (): Promise<SyncUserResult> => {
    await prisma.user.update({ where: { id: userId }, data: { profilePublic: false } });
    return { status: "private", newUnlocks: 0, levelBefore: before.level, levelAfter: before.level, skillUps: [] };
  };

  // Accounts created through Google have no Steam account: nothing to import from Steam.
  if (!steamId) {
    return { status: "ok", newUnlocks: 0, levelBefore: before.level, levelAfter: before.level, skillUps: [] };
  }

  const summary = await steam.getPlayerSummary(steamId);
  // Tralked visibility is the user's choice (/conta): a private Steam profile turns it off
  // (privateResult), but a public one never turns it back on by itself.
  await prisma.user.update({
    where: { id: userId },
    data: {
      displayName: summary.personaName,
      avatarUrl: summary.avatarUrl,
    },
  });
  if (!summary.profilePublic) return privateResult();

  const library = await steam.getOwnedGames(steamId);
  if (library === "private") return privateResult();
  // Without a library list (no API key) the catalog's games are probed one by one instead.
  const probing = library === "unsupported";
  const candidates = probing ? await catalogProbeCandidates() : library;
  // Games never played have no unlocks; skipping them saves most of a big library's API calls.
  // When Steam hides playtime every game reports 0, so then every owned game is a candidate.
  const playtimeKnown = candidates.some((g) => g.playtimeMin > 0);
  const owned = playtimeKnown ? candidates.filter((g) => g.playtimeMin > 0) : candidates;
  let sawPrivate = false;
  let failures = 0;
  let firstError: unknown;
  const results = await mapPool(owned, STEAM_CONCURRENCY, () => sawPrivate, async (game) => {
    try {
      const fetched = await fetchGame(steamId, game, playtimeKnown, probing);
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
        // Steam unlocks only: other platforms are imported (and checked) by their own sync.
        where: { userId, achievement: { platform: "steam" } },
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
 * Cron job: syncs the `limit` Steam users whose last attempt is oldest (never attempted first),
 * private ones included so a profile that turned public is picked up. Ordering by attempt
 * (not success) keeps users that keep failing from starving the batch. `where` narrows the
 * candidates (tests).
 */
export async function syncStaleUsers(
  limit = 50,
  where: Prisma.UserWhereInput = {},
): Promise<{ processed: number; failed: number }> {
  const users = await prisma.user.findMany({
    where: { AND: [{ steamId: { not: null } }, where] },
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

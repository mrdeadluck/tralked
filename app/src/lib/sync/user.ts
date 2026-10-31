import type { Achievement, Game, GameSkill, Prisma } from "@/generated/prisma/client";
import { revalidateVisibility } from "@/lib/accounts/privacy";
import { prisma } from "@/lib/db";
import { findBursts, isSpeedPlatinum } from "@/lib/engine/fraud";
import type { SkillId } from "@/lib/engine/types";
import { SKILLS } from "@/lib/engine/types";
import { platinumBonus, xpForAchievement } from "@/lib/engine/xp";
import { getSteam } from "@/lib/integrations";
import { recomputeUser } from "@/lib/progression/recompute";
import { syncGame } from "./catalog";

export type SyncUserResult = {
  /** `unlinked`: the Steam account was disconnected (or claimed by another profile) mid-run. */
  status: "ok" | "private" | "unlinked";
  newUnlocks: number;
  levelBefore: number;
  levelAfter: number;
  skillUps: SkillId[];
};

type CatalogGame = Game & { achievements: Achievement[]; skills: GameSkill[] };

/** A game the user owns, with the achievements they have unlocked (times from Steam's `unlocktime`). */
type FetchedGame = {
  /** `achievements` holds only the rows Steam still lists for the game (see `fetchGame`). */
  game: CatalogGame;
  playtimeMin: number;
  /** False when Steam hides the user's playtime (every game reports 0). */
  playtimeKnown: boolean;
  unlocks: { achievementId: string; unlockedAt: Date }[];
};

const STEAM_CONCURRENCY = 5;
const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

// ---------- Catalog probing (keyless community adapter: Steam cannot list the library) ----------
// Each probe is one throttled request (about 1.2 s per host), so a sync probes what fits in a time
// budget and the next sync continues: the catalog is walked as a ring, each time slot starting at
// its own window, so syncs over time cover all of it. Games already in the user's library are
// re-probed only when due.

/** Default wall-clock budget of one sync's probing; in-flight probes still finish. */
export const PROBE_BUDGET_MS = 45_000;
/** Consecutive failed probes (429/5xx after retries, network) that stop the probing. */
export const PROBE_CIRCUIT_BREAKER = 5;
/** A library game is re-probed at least once per this period (or when its catalog data changed). */
export const PROBE_RECHECK_MS = 7 * 24 * 60 * 60_000;
/** Each slot of this length starts the walk at the next window of the ring. */
const PROBE_SLOT_MS = 2 * 60_000;
/** Games per window: about what fits in the default budget. */
const PROBE_WINDOW = 30;

export type SyncUserOptions = {
  /** Probe mode: stop taking new catalog games after this long (default 45 s; Infinity = no limit). */
  probeBudgetMs?: number;
  /** Probe mode: probe every catalog game, library games included even when not due (imports). */
  probeAll?: boolean;
  now?: () => number;
};

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

  // Rows Steam no longer lists (removed achievements, old seed rows) stay in the catalog, but
  // completion and the platinum bonus only count what the game has today.
  const upstream = new Set(achievements.map((a) => a.apiName));
  const current = game.achievements.filter((a) => upstream.has(a.apiName));
  const idByApiName = new Map(current.map((a) => [a.apiName, a.id]));
  const unlocks = achievements.flatMap((a) => {
    const achievementId = idByApiName.get(a.apiName);
    return achievementId && a.unlockedAt ? [{ achievementId, unlockedAt: a.unlockedAt }] : [];
  });
  return { game: { ...game, achievements: current }, playtimeMin: owned.playtimeMin, playtimeKnown, unlocks };
}

/** The Steam account was disconnected (or claimed by another profile) while the sync ran. */
class SteamUnlinkedError extends Error {
  constructor() {
    super("The Steam account changed during the sync");
  }
}

/** The Steam link a run started with (`linkedAt` null for an old-login account without a row). */
type SteamSnapshot = { steamId: string; linkedAt: Date | null };

/**
 * Locks the user row FOR SHARE until the game's transaction ends and checks it still has the
 * Steam link the run started with: same SteamID and same `linkedAt` (an unlink followed by a quick
 * relink is another link). Disconnecting Steam (lib/accounts/link.ts releaseAccount) takes the
 * same row FOR UPDATE, so it either waits for this game (and then removes it) or has already
 * committed (and the run stops).
 */
async function assertSteamStillLinked(tx: Prisma.TransactionClient, userId: string, link: SteamSnapshot) {
  const rows = await tx.$queryRaw<{ linkedAt: Date | null }[]>`
    SELECT l."linkedAt" FROM "User" u
      LEFT JOIN "LinkedAccount" l ON l."userId" = u.id AND l.platform = 'steam'
    WHERE u.id = ${userId} AND u."steamId" = ${link.steamId}
    FOR SHARE OF u`;
  if (rows.length === 0 || (rows[0].linkedAt?.getTime() ?? null) !== (link.linkedAt?.getTime() ?? null)) {
    throw new SteamUnlinkedError();
  }
}

/** `cleared`: an admin released the unlock (fraudReview), so the rules no longer flag it. */
type KnownUnlock = { unlockedAt: Date; suspicious: boolean; cleared: boolean };

/** Sticky flag OR the rules, except for an unlock an admin released: it keeps its stored flag. */
const suspiciousVerdict = (before: KnownUnlock | undefined, ruleMatches: boolean) =>
  before?.cleared ? before.suspicious : Boolean(before?.suspicious) || ruleMatches;

/**
 * Records one game in a single transaction: UserGame, UserAchievement (with the anti-fraud
 * verdict) and the ledger entries of the valid unlocks plus the platinum bonus. Every insert is
 * idempotent (unique keys + skipDuplicates), so concurrent or repeated syncs never double-count,
 * and XP of entries already in the ledger is never rewritten (it is frozen at record time).
 * Returns how many unlocks were new.
 */
async function recordGame(
  userId: string,
  link: SteamSnapshot,
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
    // flag by hand does not last while either rule still matches: the next sync sets it again,
    // unless the admin released it in the fraud queue (fraudReview "cleared").
    suspicious: suspiciousVerdict(known.get(u.achievementId), bursts.has(u.achievementId) || speedRun),
  }));
  const pctById = new Map(game.achievements.map((a) => [a.id, a.globalPct]));

  return prisma.$transaction(async (tx) => {
    await assertSteamStillLinked(tx, userId, link);
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

const weekOf = (ms: number) => Math.floor(ms / PROBE_RECHECK_MS);

/**
 * Catalog games to probe, in order: library games that are due first, then the rest of the
 * catalog as a ring starting at the current slot's window. A library game is due when the user
 * never synced, when a new 7-day period began since the last sync (so every library game is
 * re-checked at least weekly), or when its catalog data changed since then (refresh, rarity).
 */
export async function catalogProbeCandidates(
  userId: string,
  lastSyncedAt: Date | null,
  now: number,
  probeAll = false,
): Promise<{ appId: number; playtimeMin: number }[]> {
  const [games, library] = await Promise.all([
    prisma.game.findMany({
      where: { steamAppId: { not: null }, achievementCount: { gt: 0 } },
      orderBy: { steamAppId: "asc" },
      select: { id: true, steamAppId: true, updatedAt: true, lastSyncAttemptAt: true },
    }),
    prisma.userGame.findMany({ where: { userId, platform: "steam" }, select: { gameId: true } }),
  ]);
  const owned = new Set(library.map((g) => g.gameId));
  const since = lastSyncedAt?.getTime();
  const due = (g: (typeof games)[number]) =>
    probeAll ||
    since === undefined ||
    weekOf(now) !== weekOf(since) ||
    Math.max(g.updatedAt.getTime(), g.lastSyncAttemptAt?.getTime() ?? 0) > since;

  const recorded = games.filter((g) => owned.has(g.id) && due(g));
  const rest = games.filter((g) => !owned.has(g.id));
  const start = rest.length > 0 ? (Math.floor(now / PROBE_SLOT_MS) * PROBE_WINDOW) % rest.length : 0;
  const ring = [...rest.slice(start), ...rest.slice(0, start)];
  return [...recorded, ...ring].flatMap((g) =>
    g.steamAppId === null ? [] : [{ appId: g.steamAppId, playtimeMin: 0 }],
  );
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
export async function syncUser(userId: string, options: SyncUserOptions = {}): Promise<SyncUserResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const steamId = user.steamId;
  const before = await currentProgress(userId);
  const steam = getSteam();

  // Recorded first so a user that keeps failing still rotates to the back of the cron queue.
  await prisma.user.update({ where: { id: userId }, data: { lastSyncAttemptAt: new Date() } });

  const privateResult = async (): Promise<SyncUserResult> => {
    await prisma.user.update({ where: { id: userId }, data: { profilePublic: false } });
    // Going private reaches the cached public pages (gallery, photos, forum, profile) at once.
    if (user.profilePublic) await revalidateVisibility(userId);
    return { status: "private", newUnlocks: 0, levelBefore: before.level, levelAfter: before.level, skillUps: [] };
  };

  // Accounts created through Google have no Steam account: nothing to import from Steam.
  if (!steamId) {
    return { status: "ok", newUnlocks: 0, levelBefore: before.level, levelAfter: before.level, skillUps: [] };
  }
  const steamRow = await prisma.linkedAccount.findUnique({
    where: { userId_platform: { userId, platform: "steam" } },
    select: { linkedAt: true },
  });
  const link: SteamSnapshot = { steamId, linkedAt: steamRow?.linkedAt ?? null };

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
  const candidates = probing
    ? await catalogProbeCandidates(userId, user.lastSyncedAt, startedAt, options.probeAll)
    : library;
  const budgetMs = options.probeBudgetMs ?? PROBE_BUDGET_MS;
  // Games never played have no unlocks; skipping them saves most of a big library's API calls.
  // When Steam hides playtime every game reports 0, so then every owned game is a candidate.
  const playtimeKnown = candidates.some((g) => g.playtimeMin > 0);
  const owned = playtimeKnown ? candidates.filter((g) => g.playtimeMin > 0) : candidates;
  let sawPrivate = false;
  let attempted = 0;
  let failures = 0;
  let consecutiveFailures = 0;
  let firstError: unknown;
  const stop = () =>
    sawPrivate ||
    (probing && (now() - startedAt >= budgetMs || consecutiveFailures >= PROBE_CIRCUIT_BREAKER));
  const results = await mapPool(owned, STEAM_CONCURRENCY, stop, async (game) => {
    attempted++;
    try {
      const fetched = await fetchGame(steamId, game, playtimeKnown, probing);
      consecutiveFailures = 0;
      if (fetched === "private") sawPrivate = true;
      return fetched;
    } catch (error) {
      // One broken game must not block the rest; it is retried on the next sync.
      failures++;
      consecutiveFailures++;
      firstError ??= error;
      console.error(`Sync: could not read Steam app ${game.appId} for user ${userId}`, error);
      return null;
    }
  });
  if (sawPrivate) return privateResult();
  if (attempted > 0 && failures === attempted) throw firstError;

  const fetchedGames = results.filter((r): r is FetchedGame => r !== null && r !== "private");

  // Anti-fraud looks at all of the user's unlocks together (bursts can span games), using
  // Steam's real unlock times, so importing old history never trips the burst rule by itself.
  const known = new Map<string, KnownUnlock>(
    (
      await prisma.userAchievement.findMany({
        // Steam unlocks only: other platforms are imported (and checked) by their own sync.
        where: { userId, achievement: { platform: "steam" } },
        select: { achievementId: true, unlockedAt: true, suspicious: true, fraudReview: true },
      })
    ).map((r) => [
      r.achievementId,
      { unlockedAt: r.unlockedAt, suspicious: r.suspicious, cleared: r.fraudReview === "cleared" },
    ]),
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
    try {
      newUnlocks += await recordGame(userId, link, fetched, known, bursts);
    } catch (error) {
      // Disconnected while this run was reading: stop. The unlink already removed what was
      // recorded and recomputed; nothing more is written for this account.
      if (error instanceof SteamUnlinkedError) {
        return { status: "unlinked", newUnlocks: 0, levelBefore: before.level, levelAfter: before.level, skillUps: [] };
      }
      throw error;
    }
  }

  await recomputeUser(userId);
  // Guarded like the games: a Steam disconnected meanwhile is not marked synced.
  await prisma.user.updateMany({ where: { id: userId, steamId }, data: { lastSyncedAt: new Date() } });

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

/** Wall-clock budget of one `users` cron run, shared by all of its users (one invocation). */
export const STALE_USERS_BUDGET_MS = 50_000;

export type StaleUsersOptions = {
  /** Stop starting new users after this long; each user's probing gets what is left. */
  budgetMs?: number;
  now?: () => number;
};

/**
 * Cron job: syncs the `limit` Steam users whose last attempt is oldest (never attempted first),
 * private ones included so a profile that turned public is picked up. Ordering by attempt
 * (not success) keeps users that keep failing from starving the batch. `where` narrows the
 * candidates (tests). The run shares one deadline (`budgetMs`): no user starts after it, and
 * each user's catalog probing is cut to the time left (at most PROBE_BUDGET_MS), so one run
 * fits in one serverless invocation; users left over go first next run.
 */
export async function syncStaleUsers(
  limit = 50,
  where: Prisma.UserWhereInput = {},
  { budgetMs = STALE_USERS_BUDGET_MS, now = Date.now }: StaleUsersOptions = {},
): Promise<{ processed: number; failed: number }> {
  const deadline = now() + budgetMs;
  const users = await prisma.user.findMany({
    where: { AND: [{ steamId: { not: null } }, where] },
    orderBy: { lastSyncAttemptAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { id: true },
  });
  let processed = 0;
  let failed = 0;
  for (const { id } of users) {
    const left = deadline - now();
    if (left <= 0) break;
    try {
      await syncUser(id, { probeBudgetMs: Math.min(PROBE_BUDGET_MS, left), now });
      processed++;
    } catch (error) {
      failed++;
      console.error(`Cron: could not sync user ${id}`, error);
    }
  }
  return { processed, failed };
}

import type { Achievement, Game, GameSkill, Prisma } from "@/generated/prisma/client";
import { revalidateVisibility } from "@/lib/accounts/privacy";
import { prisma } from "@/lib/db";
import { findBursts, isSpeedPlatinum } from "@/lib/engine/fraud";
import type { SkillId } from "@/lib/engine/types";
import { SKILLS } from "@/lib/engine/types";
import { platinumBonus, xpForAchievement } from "@/lib/engine/xp";
import { getSteam, type SteamOwnedGame } from "@/lib/integrations";
import { recomputeUser } from "@/lib/progression/recompute";
import { syncGame } from "./catalog";
import { busyImports, busyPairs } from "./import-lease";
import { settlePlaytime } from "./playtime";
import { ensureSteamGames, placeholderGames, renamePlaceholderGame } from "./steam-games";

export type SyncUserResult = {
  /** `unlinked`: the Steam account was disconnected (or claimed by another profile) mid-run. */
  status: "ok" | "private" | "unlinked";
  newUnlocks: number;
  levelBefore: number;
  levelAfter: number;
  skillUps: SkillId[];
  /** Games were left for the next sync (time budget); what was read is recorded. */
  partial?: boolean;
};

type CatalogGame = Game & { achievements: Achievement[]; skills: GameSkill[] };

/** A game the user owns, with the achievements they have unlocked (times from Steam's `unlocktime`). */
type FetchedGame = {
  /** `achievements` holds only the rows Steam still lists for the game (see `fetchGame`). */
  game: CatalogGame;
  playtimeMin: number;
  /** False when Steam hides the user's playtime (every game reports 0). */
  playtimeKnown: boolean;
  /** The library sync recorded the game's playtime: recording its unlocks leaves playtime alone. */
  fromLibrary: boolean;
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
  /**
   * Stop taking new games to read achievements of after this long (default 45 s; Infinity = no
   * limit): catalog probing without a key, and library games played since their last read with
   * one (they stay due, so the next sync continues).
   */
  probeBudgetMs?: number;
  /**
   * Read every game: probe mode probes the whole catalog (library games included even when not
   * due); keyed mode re-reads every played game of the library (imports).
   */
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
): Promise<FetchedGame | "private" | "none"> {
  const steam = getSteam();
  const achievements = await steam.getPlayerAchievements(steamId, owned.appId);
  if (achievements === "private") return "private";
  if (achievements.length === 0) return "none";
  // A probed game is not known to be owned: only one with an unlock enters the library.
  if (requireUnlock && !achievements.some((a) => a.unlockedAt)) return "none";

  let game = await loadGame(owned.appId);
  // Unknown game (or a name-only stub), or Steam has achievements the catalog doesn't know yet (new DLC).
  const known = new Set(game?.achievements.map((a) => a.apiName));
  if (!game || achievements.some((a) => !known.has(a.apiName))) {
    if (await syncGame(owned.appId)) game = await loadGame(owned.appId);
  }
  if (!game) return "none";

  // Rows Steam no longer lists (removed achievements, old seed rows) stay in the catalog, but
  // completion and the platinum bonus only count what the game has today.
  const upstream = new Set(achievements.map((a) => a.apiName));
  const current = game.achievements.filter((a) => upstream.has(a.apiName));
  const idByApiName = new Map(current.map((a) => [a.apiName, a.id]));
  const unlocks = achievements.flatMap((a) => {
    const achievementId = idByApiName.get(a.apiName);
    return achievementId && a.unlockedAt ? [{ achievementId, unlockedAt: a.unlockedAt }] : [];
  });
  return {
    game: { ...game, achievements: current },
    playtimeMin: owned.playtimeMin,
    playtimeKnown,
    fromLibrary: !requireUnlock,
    unlocks,
  };
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
  const { game, playtimeMin, playtimeKnown, fromLibrary, unlocks } = fetched;
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
      // Library games already have their playtime (recordLibrary); probed games have none to
      // give (a 0 must not erase playtime recorded by an earlier keyed sync). Reading the
      // achievements at this playtime is done: the next sync skips the game until it is played.
      data: {
        unlockedCount: unlocks.length,
        completedAt,
        ...(fromLibrary && { checkedPlaytimeMin: playtimeMin }),
      },
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

/** What the library sync knows of an owned game. */
type LibraryEntry = { gameId: string; checkedPlaytimeMin: number | null };

/**
 * Records the whole Steam library (keyed adapter: GetOwnedGames), never-played games included:
 * games unknown to the catalog become name-only stubs, every owned game gets its UserGame row
 * with Steam's playtime, last-2-weeks playtime and last play time, and the hours milestones due
 * pay XP within the per-user caps (lib/sync/playtime.ts settlePlaytime). One transaction, guarded
 * like the games' (an unlink meanwhile aborts it). Only rows whose playtime changed are rewritten.
 * Returns appid → what the achievements pass needs.
 */
async function recordLibrary(
  userId: string,
  link: SteamSnapshot,
  owned: SteamOwnedGame[],
  /** False when Steam hides playtime (every game 0): stored playtime is then left as it was. */
  playtimeKnown: boolean,
  now: Date,
): Promise<Map<number, LibraryEntry>> {
  const ids = await ensureSteamGames(owned.map((g) => ({ appId: g.appId, name: g.name })), { now });
  // Games still named with a placeholder (`Jogo <appid> da Steam`, or the legacy `Steam App <n>`)
  // take the name Steam gives in the library (include_appinfo).
  const named = new Map(owned.flatMap((g) => (g.name ? [[g.appId, g.name] as const] : [])));
  for (const game of await placeholderGames([...named.keys()])) {
    await renamePlaceholderGame(game.id, named.get(game.steamAppId)!, now);
  }
  const stored = new Map(
    (
      await prisma.userGame.findMany({
        where: { userId, platform: "steam" },
        select: {
          gameId: true,
          playtimeMin: true,
          playtime2WeeksMin: true,
          lastPlayedAt: true,
          playtimeUpdatedAt: true,
          checkedPlaytimeMin: true,
        },
      })
    ).map((r) => [r.gameId, r]),
  );

  const result = new Map<number, LibraryEntry>();
  const created: Prisma.UserGameCreateManyInput[] = [];
  const updated: { gameId: string; data: Prisma.UserGameUpdateInput }[] = [];
  for (const game of owned) {
    const gameId = ids.get(game.appId);
    if (!gameId) continue;
    const before = stored.get(gameId);
    result.set(game.appId, { gameId, checkedPlaytimeMin: before?.checkedPlaytimeMin ?? null });
    const fields = {
      playtimeMin: Math.max(0, game.playtimeMin),
      playtime2WeeksMin: game.playtime2WeeksMin ?? null,
      lastPlayedAt: game.lastPlayedAt ?? null,
      playtimeUpdatedAt: now,
    };
    if (!before) {
      created.push({ userId, gameId, platform: "steam", unlockedCount: 0, ...fields });
      continue;
    }
    if (!playtimeKnown) continue;
    const changed =
      before.playtimeUpdatedAt === null ||
      before.playtimeMin !== fields.playtimeMin ||
      before.playtime2WeeksMin !== fields.playtime2WeeksMin ||
      (before.lastPlayedAt?.getTime() ?? null) !== (fields.lastPlayedAt?.getTime() ?? null);
    if (changed) updated.push({ gameId, data: fields });
  }

  await prisma.$transaction(async (tx) => {
    await assertSteamStillLinked(tx, userId, link);
    if (created.length > 0) await tx.userGame.createMany({ data: created, skipDuplicates: true });
    for (const { gameId, data } of updated) {
      await tx.userGame.update({
        where: { userId_gameId_platform: { userId, gameId, platform: "steam" } },
        data,
      });
    }
    // Hours milestones due (new hours, or games the caps held back on an earlier day).
    await settlePlaytime(tx, userId, "steam", now);
  }, TRANSACTION_OPTIONS);
  return result;
}

/**
 * Replaces the user's Steam wishlist with Steam's (apps unknown to the catalog become stubs queued
 * for details). Best effort: a failure only leaves the stored wishlist as it was.
 */
async function syncWishlist(userId: string, steamId: string, link: SteamSnapshot, now: Date): Promise<void> {
  try {
    const items = await getSteam().getWishlist(steamId);
    if (items === "private") return;
    const ids = await ensureSteamGames(
      items.map((i) => ({ appId: i.appId })),
      { requestDetails: true, now },
    );
    const rows = items.flatMap((i) => {
      const gameId = ids.get(i.appId);
      return gameId ? [{ userId, gameId, platform: "steam", priority: i.priority, addedAt: i.addedAt }] : [];
    });
    await prisma.$transaction(async (tx) => {
      await assertSteamStillLinked(tx, userId, link);
      await tx.wishlistItem.deleteMany({ where: { userId, platform: "steam" } });
      if (rows.length > 0) await tx.wishlistItem.createMany({ data: rows, skipDuplicates: true });
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (error instanceof SteamUnlinkedError) throw error;
    console.error(`Sync: could not read the Steam wishlist of user ${userId}`, error);
  }
}

const weekOf = (ms: number) => Math.floor(ms / PROBE_RECHECK_MS);

/**
 * Catalog games to probe, in order: library games that are due first, then the rest of the
 * catalog as a ring starting at the current slot's window. A library game is due when the user
 * never synced, when a new 7-day period began since the last sync (so every library game is
 * re-checked at least weekly), or when its catalog data changed since then (refresh, rarity).
 */
/** Games other players own that one sync asks Steam about for this user (see borrowedCandidates). */
const BORROWED_PER_SYNC = 80;
const borrowedKey = (userId: string) => `steam-borrowed:${userId}`;

/**
 * Steam games other Tralked players own that are neither in this user's Steam list nor already in
 * their library, and were not asked before: Steam leaves out of the list the games played through
 * Family Sharing or a temporary free license, but still answers their unlocks when asked by appid.
 * Only one with an unlock enters the library; the ones without are remembered and not asked again.
 */
async function borrowedCandidates(userId: string, listed: Set<number>): Promise<SteamOwnedGame[]> {
  const cursor = await prisma.syncCursor.findUnique({ where: { key: borrowedKey(userId) } });
  const tried = new Set(Array.isArray(cursor?.value) ? (cursor.value as number[]) : []);
  // Most achievements first: those are the ones worth asking about.
  const rows = await prisma.$queryRaw<{ appid: number }[]>`
    SELECT g."steamAppId" AS appid, MAX(g."achievementCount") AS achievements
    FROM "UserGame" ug JOIN "Game" g ON g.id = ug."gameId"
    WHERE ug.platform = 'steam' AND ug."userId" <> ${userId} AND g."steamAppId" IS NOT NULL
      AND g."achievementCount" > 0
      AND NOT EXISTS (
        SELECT 1 FROM "UserGame" mine
        WHERE mine."userId" = ${userId} AND mine."gameId" = g.id AND mine.platform = 'steam'
      )
    GROUP BY g."steamAppId"
    ORDER BY achievements DESC`;
  return rows
    .map((r) => Number(r.appid))
    .filter((appId) => !listed.has(appId) && !tried.has(appId))
    .slice(0, BORROWED_PER_SYNC)
    .map((appId) => ({ appId, playtimeMin: 0, lastPlayedAt: null }));
}

/**
 * Marker of a Steam library the last sync could not read whole (time budget): the first-import
 * worker (lib/sync/first-import.ts) finishes those imports without the cron's 50 s ceiling.
 */
export const steamBacklogKey = (userId: string) => `steam-backlog:${userId}`;

async function markSteamBacklog(userId: string, partial: boolean): Promise<void> {
  const key = steamBacklogKey(userId);
  if (partial) {
    await prisma.syncCursor.upsert({ where: { key }, create: { key, value: { since: Date.now() } }, update: {} });
  } else {
    await prisma.syncCursor.deleteMany({ where: { key } });
  }
}

async function rememberBorrowedTried(userId: string, appIds: number[]): Promise<void> {
  if (appIds.length === 0) return;
  const key = borrowedKey(userId);
  const cursor = await prisma.syncCursor.findUnique({ where: { key } });
  const value = [...new Set([...(Array.isArray(cursor?.value) ? (cursor.value as number[]) : []), ...appIds])];
  await prisma.syncCursor.upsert({ where: { key }, create: { key, value }, update: { value } });
}

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
 * Imports the user's Steam account: with a key, the whole library (never-played games included,
 * playtime, hours milestones XP) and the wishlist, then the achievements (history included) of
 * the games played since their last read; without a key, achievements by probing the catalog.
 * Applies the anti-fraud rules, appends XP to the ledger and recomputes level, skills, attributes,
 * missions and streak. Idempotent: running it again changes nothing unless Steam has new unlocks
 * or more playtime.
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
  const unlinked = (): SyncUserResult => ({
    status: "unlinked",
    newUnlocks: 0,
    levelBefore: before.level,
    levelAfter: before.level,
    skillUps: [],
  });

  // Keyed library: every owned game (never-played ones too) with its playtime, and the wishlist.
  let libraryEntries = new Map<number, LibraryEntry>();
  if (!probing) {
    const known = library.some((g) => g.playtimeMin > 0);
    try {
      libraryEntries = await recordLibrary(userId, link, library, known, new Date(startedAt));
      await syncWishlist(userId, steamId, link, new Date(startedAt));
    } catch (error) {
      if (error instanceof SteamUnlinkedError) return unlinked();
      throw error;
    }
  }

  const candidates: SteamOwnedGame[] = probing
    ? await catalogProbeCandidates(userId, user.lastSyncedAt, startedAt, options.probeAll)
    : library;
  const budgetMs = options.probeBudgetMs ?? PROBE_BUDGET_MS;
  // Steam reports 0 minutes for many games that do have unlocks (played before 2009, through another
  // launcher): a game at 0 is read once (never checked), then only again if its playtime moves.
  // When Steam hides playtime every game reports 0, so then every owned game is a candidate.
  const playtimeKnown = candidates.some((g) => g.playtimeMin > 0);
  // A library game is read again only when played since its last read (playtime moved), so a
  // re-sync of a big library reads just the games played lately; the most recent first, games at 0
  // last.
  const owned = playtimeKnown
    ? candidates
        .filter((g) => g.playtimeMin > 0 || libraryEntries.get(g.appId)?.checkedPlaytimeMin == null)
        .filter((g) => probing || options.probeAll || libraryEntries.get(g.appId)?.checkedPlaytimeMin !== g.playtimeMin)
        .sort((a, b) => (b.lastPlayedAt?.getTime() ?? 0) - (a.lastPlayedAt?.getTime() ?? 0))
    : candidates;
  const borrowed = probing ? [] : await borrowedCandidates(userId, new Set(candidates.map((g) => g.appId)));
  const borrowedIds = new Set(borrowed.map((g) => g.appId));
  const borrowedEmpty: number[] = [];
  let sawPrivate = false;
  let attempted = 0;
  let failures = 0;
  let consecutiveFailures = 0;
  let firstError: unknown;
  const outOfTime = () => now() - startedAt >= budgetMs;
  const stop = () =>
    sawPrivate || outOfTime() || (probing && consecutiveFailures >= PROBE_CIRCUIT_BREAKER);
  /** Library games read without achievements to record: their read is done at this playtime. */
  const readEmpty: { appId: number; playtimeMin: number }[] = [];
  const results = await mapPool([...owned, ...borrowed], STEAM_CONCURRENCY, stop, async (game) => {
    attempted++;
    const isBorrowed = borrowedIds.has(game.appId);
    try {
      const fetched = await fetchGame(steamId, game, playtimeKnown, probing || isBorrowed);
      consecutiveFailures = 0;
      if (fetched === "private" && !isBorrowed) sawPrivate = true;
      if (fetched === "none" && isBorrowed) borrowedEmpty.push(game.appId);
      else if (fetched === "none" && !probing) readEmpty.push(game);
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
  const partial = attempted < owned.length;
  await rememberBorrowedTried(userId, borrowedEmpty);

  for (const { appId, playtimeMin } of readEmpty) {
    const gameId = libraryEntries.get(appId)?.gameId;
    if (gameId) {
      await prisma.userGame.updateMany({
        where: { userId, gameId, platform: "steam" },
        data: { checkedPlaytimeMin: playtimeMin },
      });
    }
  }

  const fetchedGames = results.filter((r): r is FetchedGame => r !== null && r !== "private" && r !== "none");

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
      if (error instanceof SteamUnlinkedError) return unlinked();
      throw error;
    }
  }

  await recomputeUser(userId);
  // Guarded like the games: a Steam disconnected meanwhile is not marked synced.
  await prisma.user.updateMany({ where: { id: userId, steamId }, data: { lastSyncedAt: new Date() } });
  // Keyed syncs only: probing walks the catalog as a ring and is never "whole".
  if (!probing) await markSteamBacklog(userId, partial);

  const after = await currentProgress(userId);
  return {
    status: "ok",
    newUnlocks,
    levelBefore: before.level,
    levelAfter: after.level,
    skillUps: SKILLS.map((s) => s.id).filter(
      (id) => (after.skillLevels.get(id) ?? 1) > (before.skillLevels.get(id) ?? 1),
    ),
    partial,
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
  // Users the first-import worker is importing right now are its own (no parallel syncs).
  const busy = busyPairs(await busyImports(now())).filter((b) => b.platform === "steam");
  const users = await prisma.user.findMany({
    where: { AND: [{ steamId: { not: null } }, { id: { notIn: busy.map((b) => b.userId) } }, where] },
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

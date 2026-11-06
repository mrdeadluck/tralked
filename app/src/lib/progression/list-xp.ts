import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { xpForPlatformAchievement, type TrophyTier } from "@/lib/engine/trophies";
import { platinumBonus } from "@/lib/engine/xp";
import type { CodePlatform } from "@/lib/sync/platform-library";
import { canonicalList, versionKey } from "@/lib/trophies/lists";
import { recomputeUser } from "./recompute";

// XP of PSN / Xbox / RetroAchievements trophies, by version (see versionKey): one reconcile
// (settleListXp) computes the ledger entries the rule wants for a game, voids the valid ones it no
// longer wants and adds the missing ones. Steam never goes through here (its entries carry no
// platform and keep their Plan 1 keys).

/** Platforms whose trophies are settled here (Steam never is). */
export const LIST_PLATFORMS: readonly CodePlatform[] = ["psn", "xbox", "retro"];
export const isListPlatform = (platform: string): platform is CodePlatform =>
  (LIST_PLATFORMS as readonly string[]).includes(platform);
const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 };
/** Games settled per transaction by rebuildListXp. */
const REBUILD_CHUNK = 20;

/** Legacy key of a list-less platinum (`${platform}:${gameId}`), written before trophy lists. */
export const legacyPlatinumSourceKey = (platform: string, gameId: string) => `${platform}:${gameId}`;

/**
 * sourceKey of a `platinum` entry: the gameId for Steam (Plan 1 entries); with the list, one per
 * version: `psn:<console>:<gameId>` (no console: `psn:<externalId>:<gameId>`) and
 * `<platform>:<externalId>:<gameId>` for xbox | retro.
 *
 * Transitional: a non-Steam call without `list` still answers the legacy key
 * (legacyPlatinumSourceKey) for the readers and writers not yet on lists (the PSN/Xbox/RA sync until
 * it settles through settleListXp, the game page's XP total).
 */
export function platinumSourceKey(
  platform: string,
  gameId: string,
  list?: { console: string | null; externalId: string },
): string {
  if (platform === "steam") return gameId;
  if (!list) return legacyPlatinumSourceKey(platform, gameId);
  return `${versionKey({ platform, console: list.console, externalId: list.externalId })}:${gameId}`;
}

/** Game of a `platinum` entry: the part after the last ":" (cuids never contain ":"). */
export const platinumGameId = (sourceKey: string) => sourceKey.slice(sourceKey.lastIndexOf(":") + 1);

export type LedgerDraft = {
  source: "achievement" | "platinum";
  sourceKey: string;
  xp: number;
  platform: string;
  createdAt: Date;
  skills: string[];
};

export type ListRow = { id: string; externalId: string; console: string | null; createdAt: Date };
export type AchievementRow = {
  id: string;
  listId: string | null;
  apiName: string;
  globalPct: number | null;
  points: number | null;
  trophyTier: string | null;
};
export type UnlockRow = { achievementId: string; unlockedAt: Date; suspicious: boolean; hardcore: boolean };
export type ProgressRow = { listId: string; completedAt: Date | null };

export type DesiredInput = {
  platform: CodePlatform;
  gameId: string;
  skills: string[];
  /** Every TrophyList of the game on that platform. */
  lists: ListRow[];
  /** Every Achievement of the game on that platform (listId null: rows from before the lists). */
  achievements: AchievementRow[];
  /** The user's unlocks of those achievements. */
  unlocks: UnlockRow[];
  /** The user's UserTrophyList rows of those lists. */
  progress: ProgressRow[];
  /**
   * UserGame.completedAt of the game on that platform: pays the legacy platinum key while the user
   * has no UserTrophyList of the game on that platform (data not migrated, or lists not read for
   * this user yet, keeps its XP).
   */
  legacyCompletedAt?: Date | null;
};

/** A draft and the achievements it comes from (fraud release restores the entries of these). */
type OriginDraft = LedgerDraft & { origin: string[] };

const xpOf = (platform: CodePlatform, a: AchievementRow, hardcore: boolean) =>
  xpForPlatformAchievement({
    platform,
    globalPct: a.globalPct,
    points: a.points,
    trophyTier: a.trophyTier as TrophyTier | null,
    hardcore,
  });

function desiredWithOrigin(input: DesiredInput): OriginDraft[] {
  const { platform, gameId, skills } = input;
  const listById = new Map(input.lists.map((l) => [l.id, l]));
  const versionOf = (l: ListRow) => versionKey({ platform, console: l.console, externalId: l.externalId });

  const versions = new Map<string, ListRow[]>();
  for (const l of input.lists) versions.set(versionOf(l), [...(versions.get(versionOf(l)) ?? []), l]);
  const canonicalIdOf = new Map<string, string>(); // `${version}\n${apiName}` -> canonical achievement id
  const canonicalLists = new Set([...versions.values()].map((ls) => canonicalList(ls).id));
  for (const a of input.achievements) {
    const l = a.listId ? listById.get(a.listId) : undefined;
    if (l && canonicalLists.has(l.id)) canonicalIdOf.set(`${versionOf(l)}\n${a.apiName}`, a.id);
  }
  const achievementById = new Map(input.achievements.map((a) => [a.id, a]));
  // apiNames the user holds validly on a list row: a list-less unlock of one of these is that same
  // trophy, paid under the list row's key.
  const coveredApiNames = new Set(
    input.unlocks.flatMap((u) => {
      const a = achievementById.get(u.achievementId);
      return a?.listId && listById.has(a.listId) && !u.suspicious ? [a.apiName] : [];
    }),
  );

  /** Ledger key of an unlocked achievement, or null when the rule pays it nothing. */
  const keyOf = (a: AchievementRow): string | null => {
    // A list-less row (written before trophy lists) pays by its own id until a valid unlock of the
    // same trophy on a list row of the game takes over (its lists not read yet: it keeps its XP).
    if (!a.listId) return coveredApiNames.has(a.apiName) ? null : a.id;
    const l = listById.get(a.listId);
    if (!l) return null;
    if (platform !== "psn") return a.id;
    return canonicalIdOf.get(`${versionOf(l)}\n${a.apiName}`) ?? a.id;
  };

  const drafts: OriginDraft[] = [];
  const byKey = new Map<string, { a: AchievementRow; u: UnlockRow; origin: string[] }>();
  const suspiciousLists = new Set<string>();
  const validIds = new Set<string>();
  for (const u of input.unlocks) {
    const a = achievementById.get(u.achievementId);
    if (!a) continue;
    if (u.suspicious) {
      if (a.listId) suspiciousLists.add(a.listId);
      continue;
    }
    validIds.add(a.id);
    const key = keyOf(a);
    if (!key) continue;
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { a, u, origin: [a.id] });
      continue;
    }
    // The same trophy in several regional lists: paid once, from the earliest unlock.
    seen.origin.push(a.id);
    const t = u.unlockedAt.getTime();
    const s = seen.u.unlockedAt.getTime();
    if (t < s || (t === s && a.id < seen.a.id)) Object.assign(seen, { a, u });
  }
  for (const [sourceKey, { a, u, origin }] of byKey) {
    drafts.push({
      source: "achievement",
      sourceKey,
      xp: xpOf(platform, a, u.hardcore),
      platform,
      createdAt: u.unlockedAt,
      skills,
      origin,
    });
  }

  if (input.progress.length > 0) {
    // One platinum per version: the earliest valid completion among its lists, valued over that list.
    const completedAt = new Map(input.progress.flatMap((p) => (p.completedAt ? [[p.listId, p.completedAt] as const] : [])));
    for (const lists of versions.values()) {
      const done = lists
        .filter((l) => completedAt.has(l.id) && !suspiciousLists.has(l.id))
        .sort(
          (x, y) =>
            completedAt.get(x.id)!.getTime() - completedAt.get(y.id)!.getTime() ||
            (x.externalId < y.externalId ? -1 : x.externalId > y.externalId ? 1 : 0),
        );
      const first = done[0];
      if (!first) continue;
      const own = input.achievements.filter((a) => a.listId === first.id);
      drafts.push({
        source: "platinum",
        sourceKey: platinumSourceKey(platform, gameId, first),
        xp: platinumBonus(own.map((a) => xpOf(platform, a, false))),
        platform,
        createdAt: completedAt.get(first.id)!,
        skills,
        origin: input.achievements.filter((a) => a.listId && lists.some((l) => l.id === a.listId)).map((a) => a.id),
      });
    }
  } else if (input.legacyCompletedAt && !input.unlocks.some((u) => u.suspicious && achievementById.has(u.achievementId))) {
    // A game none of whose lists the user holds (no list yet, or not read for this user yet) keeps
    // its legacy platinum (no suspicious unlock in it, as for a list), valued like the fraud
    // release values it.
    const unlocked = input.achievements.filter((a) => validIds.has(a.id));
    drafts.push({
      source: "platinum",
      sourceKey: legacyPlatinumSourceKey(platform, gameId),
      xp: platinumBonus(unlocked.map((a) => xpOf(platform, a, false))),
      platform,
      createdAt: input.legacyCompletedAt,
      skills,
      origin: input.achievements.map((a) => a.id),
    });
  }
  return drafts.sort((x, y) => (x.source + x.sourceKey < y.source + y.sourceKey ? -1 : 1));
}

/**
 * The `achievement` / `platinum` entries the version rule wants for one game and platform:
 * - a trophy is paid once per version (PSN: keyed to the canonical list's achievement of the same
 *   apiName, else its own id; Xbox/RA: its own id), at its earliest valid unlock and with that
 *   unlock's value;
 * - a version's platinum is paid once, from its earliest valid completion (UserTrophyList);
 * - suspicious unlocks pay nothing, and a list with one pays no platinum;
 * - a list-less Achievement row (written before trophy lists) pays by its own id unless the user
 *   holds a valid unlock of the same apiName on a list row of the game (that row's key pays it);
 * - the legacy platinum key is paid while the user has no UserTrophyList of the game on that
 *   platform, when `legacyCompletedAt` and no unlock of the game is suspicious.
 */
export function desiredListEntries(input: DesiredInput): LedgerDraft[] {
  return desiredWithOrigin(input).map((d) => ({
    source: d.source,
    sourceKey: d.sourceKey,
    xp: d.xp,
    platform: d.platform,
    createdAt: d.createdAt,
    skills: d.skills,
  }));
}

export type SettleOptions = {
  /**
   * Achievement ids an admin released (fraud "Liberar"): a wanted entry they pay that was voided
   * under the current link of the platform (voidedAt >= LinkedAccount.linkedAt) is restored
   * instead of staying voided. XP voided by an earlier unlink never comes back.
   */
  restore?: string[];
};

const entryKey = (source: string, sourceKey: string) => `${source}\n${sourceKey}`;

/**
 * Reconciles the user's ledger of these games on one platform with desiredListEntries. The game's
 * entries are its `achievement` entries keyed by any of its Achievement ids on that platform plus
 * that platform's `platinum` entries keyed `…:<gameId>`. A valid entry the rule no longer wants is
 * voided (`now`); a wanted key with no row at all is created. A key that exists voided (unlink,
 * confirmed fraud, replaced legacy key) is never paid again, except through `restore`. XP of
 * existing entries is never rewritten. Runs inside the caller's transaction.
 *
 * A wanted key with no row is not created either when what it replaces exists only voided, and
 * voided before the current link of the platform (so XP voided under the pre-version keys by an
 * unlink is not paid again under the new key after a relink; a predecessor voided under the
 * current link, e.g. by an earlier settle of another list of the game, does not block):
 * - a version platinum, when the game's legacy `${platform}:${gameId}` platinum is voided and the
 *   game has no other version platinum row (in any state);
 * - a trophy, when the own-id `achievement` entries of the unlocks behind it exist and are all voided.
 * A predecessor still valid (the migration case) does not block: the new key is paid and the old
 * one voided by this same call.
 */
export async function settleListXp(
  tx: Prisma.TransactionClient,
  userId: string,
  platform: CodePlatform,
  gameIds: string[],
  now: Date,
  options: SettleOptions = {},
): Promise<{ paid: number; voided: number }> {
  const ids = [...new Set(gameIds)];
  if (ids.length === 0) return { paid: 0, voided: 0 };

  const lists = await tx.trophyList.findMany({
    where: { gameId: { in: ids }, platform },
    select: { id: true, gameId: true, externalId: true, console: true, createdAt: true },
  });
  const achievements = await tx.achievement.findMany({
    where: { gameId: { in: ids }, platform },
    select: { id: true, gameId: true, listId: true, apiName: true, globalPct: true, points: true, trophyTier: true },
  });
  // PSN/Xbox/RA syncs date every unlock (platform-user always stores seenAt), so this fallback is
  // unreachable for them: only Steam keeps unknown dates. Were one
  // null here, its entry would be dated at this settle, as Steam's undated ones are.
  const unlocks = (
    await tx.userAchievement.findMany({
      where: { userId, achievement: { gameId: { in: ids }, platform } },
      select: { achievementId: true, unlockedAt: true, suspicious: true, hardcore: true },
    })
  ).map((u) => ({ ...u, unlockedAt: u.unlockedAt ?? now }));
  const progress = await tx.userTrophyList.findMany({
    where: { userId, list: { gameId: { in: ids }, platform } },
    select: { listId: true, completedAt: true },
  });
  const userGames = await tx.userGame.findMany({
    where: { userId, platform, gameId: { in: ids } },
    select: { gameId: true, completedAt: true },
  });
  const gameSkills = await tx.gameSkill.findMany({ where: { gameId: { in: ids } }, select: { gameId: true, skill: true } });
  const existing = await tx.xpLedgerEntry.findMany({
    where: {
      userId,
      OR: [
        { source: "achievement", sourceKey: { in: achievements.map((a) => a.id) } },
        { source: "platinum", platform, OR: ids.map((g) => ({ sourceKey: { endsWith: `:${g}` } })) },
      ],
    },
    select: { id: true, source: true, sourceKey: true, voidedAt: true },
  });

  const gameOfAchievement = new Map(achievements.map((a) => [a.id, a.gameId]));
  const gameOfEntry = (e: { source: string; sourceKey: string }) =>
    e.source === "achievement" ? gameOfAchievement.get(e.sourceKey) : platinumGameId(e.sourceKey);
  const existingByKey = new Map(existing.map((e) => [entryKey(e.source, e.sourceKey), e]));
  const restore = new Set(options.restore ?? []);
  const linkedAt =
    (await tx.linkedAccount.findUnique({ where: { userId_platform: { userId, platform } }, select: { linkedAt: true } }))
      ?.linkedAt ?? null;
  /** Voided under the current link: a fraud release may bring it back. */
  const restorable = (row: { voidedAt: Date | null }) =>
    row.voidedAt !== null && linkedAt !== null && row.voidedAt.getTime() >= linkedAt.getTime();
  /**
   * Rows exist and every one was voided before the current link (an unlink; with no link, any
   * void). A predecessor voided under the current link (a settle moving it to a version key)
   * never blocks its replacement.
   */
  const voidedBeforeLink = (rows: ({ voidedAt: Date | null } | undefined)[]) => {
    const found = rows.filter((r) => r !== undefined);
    return (
      found.length > 0 &&
      found.every((r) => r.voidedAt !== null && (linkedAt === null || r.voidedAt.getTime() < linkedAt.getTime()))
    );
  };

  const toVoid: string[] = [];
  const toRestore: string[] = [];
  const toCreate: Prisma.XpLedgerEntryCreateManyInput[] = [];
  for (const gameId of ids) {
    const drafts = desiredWithOrigin({
      platform,
      gameId,
      skills: gameSkills.filter((s) => s.gameId === gameId).map((s) => s.skill),
      lists: lists.filter((l) => l.gameId === gameId),
      achievements: achievements.filter((a) => a.gameId === gameId),
      unlocks: unlocks.filter((u) => gameOfAchievement.get(u.achievementId) === gameId),
      progress: progress.filter((p) => lists.some((l) => l.id === p.listId && l.gameId === gameId)),
      legacyCompletedAt: userGames.find((g) => g.gameId === gameId)?.completedAt ?? null,
    });
    const wanted = new Set(drafts.map((d) => entryKey(d.source, d.sourceKey)));
    for (const e of existing) {
      if (gameOfEntry(e) === gameId && e.voidedAt === null && !wanted.has(entryKey(e.source, e.sourceKey))) {
        toVoid.push(e.id);
      }
    }
    const legacyKey = legacyPlatinumSourceKey(platform, gameId);
    const versionPlatinums = existing.filter(
      (e) => e.source === "platinum" && e.sourceKey !== legacyKey && gameOfEntry(e) === gameId,
    );
    for (const { origin, ...d } of drafts) {
      const row = existingByKey.get(entryKey(d.source, d.sourceKey));
      if (row) {
        if (row.voidedAt !== null && origin.some((id) => restore.has(id)) && restorable(row)) toRestore.push(row.id);
        continue;
      }
      const replacesVoided =
        d.source === "platinum"
          ? d.sourceKey !== legacyKey &&
            versionPlatinums.length === 0 &&
            voidedBeforeLink([existingByKey.get(entryKey("platinum", legacyKey))])
          : voidedBeforeLink(origin.map((id) => existingByKey.get(entryKey("achievement", id))));
      if (!replacesVoided) toCreate.push({ userId, ...d });
    }
  }

  const voided = toVoid.length
    ? await tx.xpLedgerEntry.updateMany({ where: { id: { in: toVoid }, voidedAt: null }, data: { voidedAt: now } })
    : { count: 0 };
  const restored = toRestore.length
    ? await tx.xpLedgerEntry.updateMany({ where: { id: { in: toRestore } }, data: { voidedAt: null } })
    : { count: 0 };
  const created = toCreate.length ? await tx.xpLedgerEntry.createMany({ data: toCreate, skipDuplicates: true }) : { count: 0 };
  return { paid: created.count + restored.count, voided: voided.count };
}

/**
 * Settles every PSN/Xbox/RA game of the user (with an unlock or a ledger entry on that platform),
 * a few games per transaction, then recomputes the user. Idempotent: a second run changes nothing.
 */
export async function rebuildListXp(userId: string, now: Date = new Date()): Promise<{ paid: number; voided: number }> {
  const [unlocked, entries] = await Promise.all([
    prisma.achievement.findMany({
      where: { platform: { in: [...LIST_PLATFORMS] }, unlocks: { some: { userId } } },
      select: { gameId: true, platform: true },
      distinct: ["gameId", "platform"],
    }),
    prisma.xpLedgerEntry.findMany({
      where: { userId, platform: { in: [...LIST_PLATFORMS] }, source: { in: ["achievement", "platinum"] } },
      select: { source: true, sourceKey: true, platform: true },
    }),
  ]);
  const paidAchievements = await prisma.achievement.findMany({
    where: { id: { in: entries.filter((e) => e.source === "achievement").map((e) => e.sourceKey) }, platform: { in: [...LIST_PLATFORMS] } },
    select: { gameId: true, platform: true },
  });
  const pairs = [
    ...unlocked,
    ...paidAchievements,
    ...entries
      .filter((e) => e.source === "platinum" && e.platform)
      .map((e) => ({ gameId: platinumGameId(e.sourceKey), platform: e.platform! })),
  ];
  // A platinum of a game that no longer exists is left alone (nothing to reconcile it against).
  const existingGames = new Set(
    (await prisma.game.findMany({ where: { id: { in: [...new Set(pairs.map((p) => p.gameId))] } }, select: { id: true } })).map(
      (g) => g.id,
    ),
  );

  const total = { paid: 0, voided: 0 };
  for (const platform of LIST_PLATFORMS) {
    const gameIds = [...new Set(pairs.filter((p) => p.platform === platform && existingGames.has(p.gameId)).map((p) => p.gameId))].sort();
    for (let i = 0; i < gameIds.length; i += REBUILD_CHUNK) {
      const chunk = gameIds.slice(i, i + REBUILD_CHUNK);
      const result = await prisma.$transaction((tx) => settleListXp(tx, userId, platform, chunk, now), TRANSACTION_OPTIONS);
      total.paid += result.paid;
      total.voided += result.voided;
    }
  }
  await recomputeUser(userId, now);
  return total;
}

/**
 * UserGame.completedAt of a PSN/Xbox/RA game after its lists' completions changed: the earliest
 * UserTrophyList completion of the game on that platform; a game without lists has none left.
 */
export async function refreshGameCompletion(
  tx: Prisma.TransactionClient,
  userId: string,
  platform: CodePlatform,
  gameId: string,
): Promise<void> {
  const first = await tx.userTrophyList.findFirst({
    where: { userId, completedAt: { not: null }, list: { gameId, platform } },
    orderBy: { completedAt: "asc" },
    select: { completedAt: true },
  });
  await tx.userGame.updateMany({
    where: { userId, gameId, platform },
    data: { completedAt: first?.completedAt ?? null },
  });
}

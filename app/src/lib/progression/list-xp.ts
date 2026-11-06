import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { xpForPlatformAchievement, type TrophyTier } from "@/lib/engine/trophies";
import { platinumBonus } from "@/lib/engine/xp";
import type { CodePlatform } from "@/lib/sync/platform-library";
import { canonicalList, versionKey } from "@/lib/trophies/lists";
import { recomputeUser } from "./recompute";

// XP of PSN / Xbox / RetroAchievements trophies, by list: one reconcile (settleListXp) computes the
// ledger entries the rule wants for a game, voids the valid ones it no longer wants and adds the
// missing ones. Every list pays (two regional PSN lists of one console are two). Steam never goes
// through here (its entries carry no platform and keep their Plan 1 keys).

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

/**
 * sourceKey of the `platinum` entry of one list: `<platform>:<externalId>:<gameId>`. For Xbox / RA
 * (one list per version) and a PSN list without a console it equals platinumSourceKey's; the lists
 * of a PSN version get it beside the version key `psn:<console>:<gameId>` (desiredListEntries).
 */
export const listPlatinumSourceKey = (platform: string, gameId: string, list: { externalId: string }) =>
  `${platform}:${list.externalId}:${gameId}`;

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
  /**
   * Achievement ids with a valid `achievement` entry under their own id (settleListXp passes the
   * ledger): a copy already paid that way keeps its key, it never becomes the stand-in.
   */
  paidOwnIds?: ReadonlySet<string>;
};

/**
 * A draft, the achievements whose release (fraud "Liberar") restores it, and the entries that stood
 * for the same trophy or platinum before it (entryKey): when those exist and were all voided by an
 * unlink, the draft is not paid (settleListXp).
 */
type OriginDraft = LedgerDraft & { origin: string[]; predecessors: string[] };

const entryKey = (source: string, sourceKey: string) => `${source}\n${sourceKey}`;

const xpOf = (platform: CodePlatform, a: AchievementRow, hardcore: boolean) =>
  xpForPlatformAchievement({
    platform,
    globalPct: a.globalPct,
    points: a.points,
    trophyTier: a.trophyTier as TrophyTier | null,
    hardcore,
  });

const byTimeThenId = (x: { at: Date; id: string }, y: { at: Date; id: string }) =>
  x.at.getTime() - y.at.getTime() || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

function desiredWithOrigin(input: DesiredInput): OriginDraft[] {
  const { platform, gameId, skills } = input;
  const listById = new Map(input.lists.map((l) => [l.id, l]));
  const versionOf = (l: ListRow) => versionKey({ platform, console: l.console, externalId: l.externalId });

  const versions = new Map<string, ListRow[]>();
  for (const l of input.lists) versions.set(versionOf(l), [...(versions.get(versionOf(l)) ?? []), l]);
  const canonicalLists = new Set([...versions.values()].map((ls) => canonicalList(ls).id));
  const achievementById = new Map(input.achievements.map((a) => [a.id, a]));
  // PSN: the same trophy (apiName) in the lists of one version, `${version}\n${apiName}`: its rows,
  // and the canonical list's row of it (the key the rule paid before every list counted).
  const groupOf = (a: AchievementRow): string | null => {
    const l = platform === "psn" && a.listId ? listById.get(a.listId) : undefined;
    return l ? `${versionOf(l)}\n${a.apiName}` : null;
  };
  const groupRows = new Map<string, string[]>();
  const canonicalIdOf = new Map<string, string>();
  for (const a of input.achievements) {
    const g = groupOf(a);
    if (!g) continue;
    groupRows.set(g, [...(groupRows.get(g) ?? []), a.id]);
    if (canonicalLists.has(a.listId!)) canonicalIdOf.set(g, a.id);
  }

  const valid = input.unlocks.filter((u) => !u.suspicious && achievementById.has(u.achievementId));
  const validIds = new Set(valid.map((u) => u.achievementId));
  const suspiciousLists = new Set(
    input.unlocks.flatMap((u) => {
      const listId = u.suspicious ? achievementById.get(u.achievementId)?.listId : null;
      return listId ? [listId] : [];
    }),
  );
  // apiNames the user holds validly on a list row: a list-less unlock of one of these is that same
  // trophy, paid under the list row's key.
  const coveredApiNames = new Set(
    valid.flatMap((u) => {
      const a = achievementById.get(u.achievementId)!;
      return a.listId && listById.has(a.listId) ? [a.apiName] : [];
    }),
  );
  // A trophy whose canonical row the user does not hold validly: its earliest valid copy in the
  // version's other lists keeps the canonical row's id (the key the rule paid before every list
  // counted), so an entry already paid is neither voided nor paid twice. A copy already paid under
  // its own id (valid entry) keeps it: it is never voided because the canonical rows came later.
  const paidOwn = input.paidOwnIds ?? new Set<string>();
  const standIn = new Map<string, string>(); // group -> achievement id paid under the canonical id
  const byUnlock = [...valid].sort((x, y) =>
    byTimeThenId({ at: x.unlockedAt, id: x.achievementId }, { at: y.unlockedAt, id: y.achievementId }),
  );
  for (const u of byUnlock) {
    if (paidOwn.has(u.achievementId)) continue;
    const g = groupOf(achievementById.get(u.achievementId)!);
    const canonical = g ? canonicalIdOf.get(g) : undefined;
    if (g && canonical && !validIds.has(canonical) && !standIn.has(g)) standIn.set(g, u.achievementId);
  }

  /** Ledger key of an unlocked achievement, or null when the rule pays it nothing. */
  const keyOf = (a: AchievementRow): string | null => {
    // A list-less row (written before trophy lists) pays by its own id until a valid unlock of the
    // same trophy on a list row of the game takes over (its lists not read yet: it keeps its XP).
    if (!a.listId) return coveredApiNames.has(a.apiName) ? null : a.id;
    if (!listById.has(a.listId)) return null;
    const g = groupOf(a);
    return g && standIn.get(g) === a.id ? canonicalIdOf.get(g)! : a.id;
  };

  const drafts: OriginDraft[] = [];
  for (const u of valid) {
    const a = achievementById.get(u.achievementId)!;
    const sourceKey = keyOf(a);
    if (!sourceKey) continue;
    const g = groupOf(a);
    // Every copy of the trophy in the version: a release of any of them may move the canonical key
    // back to its own row (this copy's entry voided meanwhile is restored).
    const group = g ? groupRows.get(g)! : [a.id];
    drafts.push({
      source: "achievement",
      sourceKey,
      xp: xpOf(platform, a, u.hardcore),
      platform,
      createdAt: u.unlockedAt,
      skills,
      origin: group,
      // An unlink forfeits only the copy an entry paid: the stand-in's own-id entry blocks it under
      // the canonical id; a copy never paid is paid once after a relink.
      predecessors: sourceKey === a.id ? [] : [entryKey("achievement", a.id)],
    });
  }

  if (input.progress.length > 0) {
    // One platinum per valid completion of a list, valued over that list. The version key goes to
    // the canonical list when it is complete, else to the earliest completion (what the rule paid
    // before every list counted); the version's other lists get their own key.
    const completedAt = new Map(input.progress.flatMap((p) => (p.completedAt ? [[p.listId, p.completedAt] as const] : [])));
    for (const lists of versions.values()) {
      const done = lists
        .filter((l) => completedAt.has(l.id) && !suspiciousLists.has(l.id))
        .sort((x, y) => byTimeThenId({ at: completedAt.get(x.id)!, id: x.externalId }, { at: completedAt.get(y.id)!, id: y.externalId }));
      if (done.length === 0) continue;
      const canonical = canonicalList(lists);
      const holder = done.includes(canonical) ? canonical : done[0];
      const versionPlatinumKey = platinumSourceKey(platform, gameId, holder);
      const keys = lists.map((l) => (l === holder ? versionPlatinumKey : listPlatinumSourceKey(platform, gameId, l)));
      const versionRows = input.achievements.filter((a) => a.listId && lists.some((l) => l.id === a.listId)).map((a) => a.id);
      for (const l of done) {
        const sourceKey = keys[lists.indexOf(l)];
        const own = input.achievements.filter((a) => a.listId === l.id);
        drafts.push({
          source: "platinum",
          sourceKey,
          xp: platinumBonus(own.map((a) => xpOf(platform, a, false))),
          platform,
          createdAt: completedAt.get(l.id)!,
          skills,
          origin: versionRows,
          // Each list's key pays only that list (an unlink-voided key blocks itself only); the
          // legacy key is handled by settleListXp.
          predecessors: [],
        });
      }
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
      predecessors: [],
    });
  }
  return drafts.sort((x, y) => (x.source + x.sourceKey < y.source + y.sourceKey ? -1 : 1));
}

/**
 * The `achievement` / `platinum` entries the rule wants for one game and platform. Every list pays
 * (two regional PSN lists of one console pay twice), and the keys the rule used when a PSN version
 * paid once stay where they were, so nothing already paid is voided or paid again:
 * - every valid unlock pays its trophy, at its date and value, under its own id; except, on PSN, the
 *   earliest copy of a trophy whose canonical-list row (the version's oldest list) the user does not
 *   hold validly: that copy is paid under the canonical row's id;
 * - every valid completion of a list (UserTrophyList) pays its platinum, valued over that list,
 *   under `<platform>:<externalId>:<gameId>`; except, on PSN, the version key
 *   `psn:<console>:<gameId>`, which pays the canonical list's completion, or the earliest one when
 *   the canonical list is not complete;
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
  /** Stands in for a missing unlock date (Steam only; PSN/Xbox/RA are always dated). Default: the call's time. */
  now?: Date;
};

/** What settleListXp would change: entries to void, voided entries to restore, entries to create. */
type PlannedEntry = { id: string; source: string; sourceKey: string; xp: number };
/** An entry that is voided now, with its voidedAt (restore: the old one). */
type VoidedEntry = PlannedEntry & { voidedAt: Date };
export type ListXpPlan = {
  toVoid: PlannedEntry[];
  toRestore: VoidedEntry[];
  toCreate: (Prisma.XpLedgerEntryCreateManyInput & { source: LedgerDraft["source"] })[];
  /** Wanted entries left unpaid: their key exists voided (under / before the current link), or a predecessor blocks them. */
  unpaid: { voidedUnderLink: VoidedEntry[]; voidedBeforeLink: VoidedEntry[]; blocked: number };
};

/**
 * The changes that reconcile the user's ledger of these games on one platform with
 * desiredListEntries, read only (settleListXp applies them; a dry run reports them). The game's
 * entries are its `achievement` entries keyed by any of its Achievement ids on that platform plus
 * that platform's `platinum` entries keyed `…:<gameId>`. A valid entry the rule no longer wants is
 * voided; a wanted key with no row at all is created. A key that exists voided (unlink, confirmed
 * fraud, replaced legacy key) is never paid again, except through `restore`. XP of existing
 * entries is never rewritten.
 *
 * An unlink forfeits only what an entry paid: a wanted key with no row is not created either when
 * the entry that paid the same copy under another key exists voided before the current link of
 * the platform (a predecessor voided under the current link, e.g. by an earlier settle, does not
 * block):
 * - the earliest list platinum of a game whose legacy `${platform}:${gameId}` platinum is voided;
 * - a PSN copy paid under the canonical row's id (stand-in), when its own-id entry is voided.
 * Never-paid sibling copies and lists are paid once after a relink. A predecessor still valid (the
 * migration case) does not block.
 */
export async function planListXp(
  db: Prisma.TransactionClient,
  userId: string,
  platform: CodePlatform,
  gameIds: string[],
  options: SettleOptions = {},
): Promise<ListXpPlan> {
  const now = options.now ?? new Date();
  const ids = [...new Set(gameIds)];
  const plan: ListXpPlan = { toVoid: [], toRestore: [], toCreate: [], unpaid: { voidedUnderLink: [], voidedBeforeLink: [], blocked: 0 } };
  if (ids.length === 0) return plan;

  const lists = await db.trophyList.findMany({
    where: { gameId: { in: ids }, platform },
    select: { id: true, gameId: true, externalId: true, console: true, createdAt: true },
  });
  const achievements = await db.achievement.findMany({
    where: { gameId: { in: ids }, platform },
    select: { id: true, gameId: true, listId: true, apiName: true, globalPct: true, points: true, trophyTier: true },
  });
  // PSN/Xbox/RA syncs date every unlock (platform-user always stores seenAt), so this fallback is
  // unreachable for them: only Steam keeps unknown dates. Were one null here, its entry would be
  // dated at this settle, as Steam's undated ones are.
  const unlocks = (
    await db.userAchievement.findMany({
      where: { userId, achievement: { gameId: { in: ids }, platform } },
      select: { achievementId: true, unlockedAt: true, suspicious: true, hardcore: true },
    })
  ).map((u) => ({ ...u, unlockedAt: u.unlockedAt ?? now }));
  const progress = await db.userTrophyList.findMany({
    where: { userId, list: { gameId: { in: ids }, platform } },
    select: { listId: true, completedAt: true },
  });
  const userGames = await db.userGame.findMany({
    where: { userId, platform, gameId: { in: ids } },
    select: { gameId: true, completedAt: true },
  });
  const gameSkills = await db.gameSkill.findMany({ where: { gameId: { in: ids } }, select: { gameId: true, skill: true } });
  const existing = await db.xpLedgerEntry.findMany({
    where: {
      userId,
      OR: [
        { source: "achievement", sourceKey: { in: achievements.map((a) => a.id) } },
        { source: "platinum", platform, OR: ids.map((g) => ({ sourceKey: { endsWith: `:${g}` } })) },
      ],
    },
    select: { id: true, source: true, sourceKey: true, xp: true, voidedAt: true },
  });

  const gameOfAchievement = new Map(achievements.map((a) => [a.id, a.gameId]));
  const gameOfEntry = (e: { source: string; sourceKey: string }) =>
    e.source === "achievement" ? gameOfAchievement.get(e.sourceKey) : platinumGameId(e.sourceKey);
  const existingByKey = new Map(existing.map((e) => [entryKey(e.source, e.sourceKey), e]));
  const paidOwnIds = new Set(existing.filter((e) => e.source === "achievement" && e.voidedAt === null).map((e) => e.sourceKey));
  const restore = new Set(options.restore ?? []);
  const linkedAt =
    (await db.linkedAccount.findUnique({ where: { userId_platform: { userId, platform } }, select: { linkedAt: true } }))
      ?.linkedAt ?? null;
  /** Voided under the current link: a fraud release may bring it back. */
  const restorable = (row: { voidedAt: Date | null }) =>
    row.voidedAt !== null && linkedAt !== null && row.voidedAt.getTime() >= linkedAt.getTime();
  /**
   * Rows exist and every one was voided before the current link (an unlink; with no link, any
   * void). A predecessor voided under the current link (a settle moving it to another key)
   * never blocks.
   */
  const voidedBeforeLink = (rows: ({ voidedAt: Date | null } | undefined)[]) => {
    const found = rows.filter((r) => r !== undefined);
    return (
      found.length > 0 &&
      found.every((r) => r.voidedAt !== null && (linkedAt === null || r.voidedAt.getTime() < linkedAt.getTime()))
    );
  };

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
      paidOwnIds,
    });
    const wanted = new Set(drafts.map((d) => entryKey(d.source, d.sourceKey)));
    for (const e of existing) {
      if (gameOfEntry(e) === gameId && e.voidedAt === null && !wanted.has(entryKey(e.source, e.sourceKey))) {
        plan.toVoid.push({ id: e.id, source: e.source, sourceKey: e.sourceKey, xp: e.xp });
      }
    }
    const legacyKey = legacyPlatinumSourceKey(platform, gameId);
    // The legacy platinum paid the game's one (earliest) completion: voided by an unlink, it blocks
    // that platinum only (the earliest list platinum the rule wants).
    const legacyBlocks = voidedBeforeLink([existingByKey.get(entryKey("platinum", legacyKey))])
        ? drafts
            .filter((d) => d.source === "platinum" && d.sourceKey !== legacyKey)
            .sort((x, y) => byTimeThenId({ at: x.createdAt, id: x.sourceKey }, { at: y.createdAt, id: y.sourceKey }))[0]
        : undefined;
    for (const { origin, predecessors, ...d } of drafts) {
      const row = existingByKey.get(entryKey(d.source, d.sourceKey));
      if (row) {
        if (row.voidedAt === null) continue;
        const entry = { id: row.id, source: row.source, sourceKey: row.sourceKey, xp: row.xp, voidedAt: row.voidedAt };
        if (origin.some((id) => restore.has(id)) && restorable(row)) plan.toRestore.push(entry);
        else (restorable(row) ? plan.unpaid.voidedUnderLink : plan.unpaid.voidedBeforeLink).push(entry);
        continue;
      }
      const replacesLegacy = legacyBlocks !== undefined && d.source === "platinum" && d.sourceKey === legacyBlocks.sourceKey;
      if (replacesLegacy || voidedBeforeLink(predecessors.map((k) => existingByKey.get(k)))) {
        plan.unpaid.blocked++;
        continue;
      }
      plan.toCreate.push({ userId, ...d });
    }
  }
  return plan;
}

/**
 * Reconciles the user's ledger of these games on one platform (planListXp) inside the caller's
 * transaction: voids (`now`), restores and creates. Returns how many entries were paid (created or
 * restored) and voided.
 */
export async function settleListXp(
  tx: Prisma.TransactionClient,
  userId: string,
  platform: CodePlatform,
  gameIds: string[],
  now: Date,
  options: SettleOptions = {},
): Promise<{ paid: number; voided: number }> {
  return applyListXpPlan(tx, await planListXp(tx, userId, platform, gameIds, { ...options, now }), now);
}

/** Writes a planListXp plan (in the transaction that read it). */
export async function applyListXpPlan(
  tx: Prisma.TransactionClient,
  { toVoid, toRestore, toCreate }: ListXpPlan,
  now: Date,
): Promise<{ paid: number; voided: number }> {
  const voided = toVoid.length
    ? await tx.xpLedgerEntry.updateMany({ where: { id: { in: toVoid.map((e) => e.id) }, voidedAt: null }, data: { voidedAt: now } })
    : { count: 0 };
  const restored = toRestore.length
    ? await tx.xpLedgerEntry.updateMany({ where: { id: { in: toRestore.map((e) => e.id) } }, data: { voidedAt: null } })
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

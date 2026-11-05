import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { xpForPlatformAchievement, type TrophyTier } from "@/lib/engine/trophies";
import type { PsnApi, PsnServiceName, PsnTitle, PsnTrophy } from "@/lib/integrations/psn/types";
import { desiredListEntries, refreshGameCompletion, settleListXp } from "@/lib/progression/list-xp";
import { recomputeUser } from "@/lib/progression/recompute";
import { definitionsProblem } from "./psn-definitions";

// Repair of PSN trophy lists stored with definitions that are not Sony's (the Guns, Gore and
// Cannoli list held The Crew 2's trophies): reads the list's definitions again, validated like the
// sync, and makes the list's rows Sony's by apiName. The ledger is immutable: a row whose XP value
// changes gets a new row (a new key), so its old entry is voided and the new key paid by
// settleListXp; a row whose XP stays is fixed in place.

const TRANSACTION_OPTIONS = { timeout: 120_000, maxWait: 10_000 };

export type RepairOptions = {
  /** Runs everything in a transaction that is rolled back: shows before -> after, writes nothing. */
  dryRun?: boolean;
  now?: Date;
};

/** [before, after]. */
type Change = [number, number];

export type UserRepair = {
  handle: string;
  /** The user's unlocks on the list. */
  unlocked: Change;
  /** Every PSN unlock of a platinum-tier row of the user (what psn:compare counts). */
  platinums: Change;
  /** The user's valid ledger XP (every source). */
  xp: Change;
  /** The list completed for the user (UserTrophyList.completedAt set). */
  completed: [boolean, boolean];
};

export type ListRepair = {
  externalId: string;
  status: "repaired" | "would-repair" | "unchanged" | "blocked" | "unreadable" | "not-found";
  reason?: string;
  gameSlug?: string;
  rows: { updated: number; replaced: number; created: number; removed: number };
  trophyCount: Change;
  users: UserRepair[];
  /** Entries left as paid with another value than the rule gives (their key did not change). */
  warnings: string[];
};

type StoredRow = {
  id: string;
  apiName: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  hidden: boolean;
  trophyTier: string | null;
  globalPct: number | null;
  points: number | null;
};

type Plan = {
  updates: { id: string; data: Prisma.AchievementUpdateInput }[];
  replaces: { row: StoredRow; data: Definition }[];
  creates: PsnTrophy[];
  removes: StoredRow[];
};

/** The fields of a row that come from Sony's definitions. */
type Definition = { name: string; description: string | null; iconUrl: string | null; hidden: boolean; trophyTier: TrophyTier };

const definitionOf = (t: PsnTrophy): Definition => ({
  name: t.name,
  description: t.description,
  iconUrl: t.iconUrl,
  hidden: t.hidden,
  trophyTier: t.tier,
});

const xpOf = (row: { globalPct: number | null; points: number | null; trophyTier: string | null }) =>
  xpForPlatformAchievement({
    platform: "psn",
    globalPct: row.globalPct,
    points: row.points,
    trophyTier: row.trophyTier as TrophyTier | null,
    hardcore: false,
  });

/**
 * By apiName: a row Sony has with other definitions is fixed in place when its XP value stays (the
 * rarity, which the sync refreshes, is kept), and replaced by a new row when it changes; rows Sony
 * does not have are removed; trophies missing are created.
 */
function plan(rows: StoredRow[], sony: PsnTrophy[]): Plan {
  const sonyBy = new Map(sony.map((t) => [t.trophyId, t]));
  const out: Plan = { updates: [], replaces: [], creates: [], removes: [] };
  for (const row of rows) {
    const t = sonyBy.get(row.apiName);
    if (!t) {
      out.removes.push(row);
      continue;
    }
    const next = definitionOf(t);
    const changed = (Object.keys(next) as (keyof Definition)[]).some((k) => next[k] !== row[k]);
    if (!changed) continue;
    if (xpOf(row) !== xpOf({ ...row, trophyTier: next.trophyTier })) {
      out.replaces.push({ row, data: next });
      continue;
    }
    // A translation of the old text is not one of the new.
    const retold = next.name !== row.name || next.description !== row.description;
    out.updates.push({ id: row.id, data: { ...next, ...(retold && { namePt: null, descriptionPt: null }) } });
  }
  const held = new Set(rows.map((r) => r.apiName));
  out.creates = sony.filter((t) => !held.has(t.trophyId));
  return out;
}

const emptyRows = () => ({ updated: 0, replaced: 0, created: 0, removed: 0 });

/** Thrown inside the dry run's transaction to roll it back. */
class DryRunRollback extends Error {}

/**
 * Repairs these PSN lists (npCommunicationIds) from Sony's definitions. A list is left as it is
 * when Sony's answer cannot be its own (definitionsProblem), when a row Sony does not have holds an
 * unlock, a guide note or a ledger entry (blocked: someone must look), or when nothing differs.
 * Each list is one transaction; the holders are recomputed after it. Idempotent.
 */
export async function repairPsnLists(psn: PsnApi, externalIds: string[], options: RepairOptions = {}): Promise<ListRepair[]> {
  const now = options.now ?? new Date();
  const titlesOf = new Map<string, PsnTitle[] | "private">();
  const out: ListRepair[] = [];
  for (const externalId of externalIds) {
    out.push(await repairOne(psn, externalId, now, options.dryRun ?? false, titlesOf));
  }
  return out;
}

async function repairOne(
  psn: PsnApi,
  externalId: string,
  now: Date,
  dryRun: boolean,
  titlesOf: Map<string, PsnTitle[] | "private">,
): Promise<ListRepair> {
  const report: ListRepair = { externalId, status: "unchanged", rows: emptyRows(), trophyCount: [0, 0], users: [], warnings: [] };
  const list = await prisma.trophyList.findUnique({
    where: { platform_externalId: { platform: "psn", externalId } },
    select: { id: true, gameId: true, console: true, serviceName: true, trophyCount: true, game: { select: { slug: true } } },
  });
  if (!list) return { ...report, status: "not-found", reason: "no PSN trophy list with this id" };
  report.gameSlug = list.game.slug;
  report.trophyCount = [list.trophyCount, list.trophyCount];

  // Sony is asked through a linked account of a holder (the earned part of the answer is per user;
  // the definitions are not), else through any linked PSN account.
  const holders = await holdersOf(list.id);
  const reader =
    (await prisma.linkedAccount.findFirst({
      where: { platform: "psn", linkedAt: { not: null }, userId: { in: holders.map((h) => h.id) } },
      orderBy: { userId: "asc" },
      select: { externalId: true },
    })) ?? (await prisma.linkedAccount.findFirst({ where: { platform: "psn", linkedAt: { not: null } }, select: { externalId: true } }));
  if (!reader) return { ...report, status: "unreadable", reason: "no linked PSN account to read Sony with" };
  if (!titlesOf.has(reader.externalId)) titlesOf.set(reader.externalId, await psn.getTitles(reader.externalId));
  const titles = titlesOf.get(reader.externalId)!;
  const title = titles === "private" ? undefined : titles.find((t) => t.npTitleId === externalId);
  const serviceName: PsnServiceName = title?.serviceName ?? (list.serviceName === "trophy2" ? "trophy2" : "trophy");
  const sony = await psn.getTrophies(reader.externalId, externalId, serviceName);
  if (sony === "private") return { ...report, status: "unreadable", reason: "the reading account's trophies are private" };
  if (sony.length === 0) return { ...report, status: "unreadable", reason: "Sony returned no trophies" };
  const problem = definitionsProblem(externalId, title?.trophyCounts ?? null, sony);
  if (problem) return { ...report, status: "unreadable", reason: `Sony's answer is not this list's: ${problem}` };
  report.trophyCount = [list.trophyCount, sony.length];

  const rows = await prisma.achievement.findMany({
    where: { listId: list.id },
    select: {
      id: true,
      apiName: true,
      name: true,
      description: true,
      iconUrl: true,
      hidden: true,
      trophyTier: true,
      globalPct: true,
      points: true,
      _count: { select: { unlocks: true, notes: true } },
    },
  });
  const p = plan(rows, sony);
  report.rows = { updated: p.updates.length, replaced: p.replaces.length, created: p.creates.length, removed: p.removes.length };

  const keyed = new Set(
    (
      await prisma.xpLedgerEntry.findMany({
        where: { source: "achievement", sourceKey: { in: p.removes.map((r) => r.id) } },
        select: { sourceKey: true },
      })
    ).map((e) => e.sourceKey),
  );
  const stuck = rows
    .filter((r) => p.removes.some((x) => x.id === r.id))
    .filter((r) => r._count.unlocks > 0 || r._count.notes > 0 || keyed.has(r.id))
    .map((r) => `${r.apiName} (${r._count.unlocks} unlock(s), ${r._count.notes} note(s)${keyed.has(r.id) ? ", in the ledger" : ""})`);
  if (stuck.length > 0) {
    return { ...report, status: "blocked", reason: `rows Sony does not have are in use: ${stuck.join("; ")}` };
  }
  const nothing = p.updates.length + p.replaces.length + p.creates.length + p.removes.length === 0;
  if (nothing && list.trophyCount === sony.length) return report;

  const before = await numbersOf(prisma, list.id, holders.map((h) => h.id));
  try {
    await prisma.$transaction(async (tx) => {
      const staleBefore = new Map<string, Map<string, Stale>>();
      for (const h of holders) staleBefore.set(h.id, await staleEntries(tx, h.id, list.gameId));
      await applyPlan(tx, list, p);
      await tx.trophyList.update({ where: { id: list.id }, data: { trophyCount: sony.length } });
      for (const h of holders) await settleHolder(tx, h.id, list, sony.length, now);
      // The replaced rows, detached for the settle above (which voided their entries), go.
      await tx.achievement.deleteMany({ where: { id: { in: p.replaces.map((r) => r.row.id) }, listId: null } });
      const after = await numbersOf(tx, list.id, holders.map((h) => h.id));
      report.users = holders.map((h) => {
        const b = before.get(h.id)!;
        const a = after.get(h.id)!;
        return {
          handle: h.handle,
          unlocked: [b.unlocked, a.unlocked],
          platinums: [b.platinums, a.platinums],
          xp: [b.xp, a.xp],
          completed: [b.completed, a.completed],
        };
      });
      // Only what the repair changed: a rarity that moved since an entry was paid is not news.
      for (const h of holders) {
        const was = staleBefore.get(h.id)!;
        for (const [key, e] of await staleEntries(tx, h.id, list.gameId)) {
          if (was.get(key)?.wants === e.wants) continue;
          report.warnings.push(`${h.handle}: ${key} stays paid at ${e.paid} XP (the rule now gives ${e.wants})`);
        }
      }
      if (dryRun) throw new DryRunRollback();
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
    return { ...report, status: "would-repair" };
  }
  for (const h of holders) await recomputeUser(h.id, now);
  return { ...report, status: "repaired" };
}

/** Users with progress on the list or an unlock of one of its rows. */
async function holdersOf(listId: string): Promise<{ id: string; handle: string }[]> {
  return prisma.user.findMany({
    where: {
      OR: [{ trophyLists: { some: { listId } } }, { achievements: { some: { achievement: { listId } } } }],
    },
    select: { id: true, handle: true },
    orderBy: { handle: "asc" },
  });
}

type Db = Prisma.TransactionClient | typeof prisma;

async function numbersOf(db: Db, listId: string, userIds: string[]) {
  const out = new Map<string, { unlocked: number; platinums: number; xp: number; completed: boolean }>();
  for (const userId of userIds) {
    const [unlocked, platinums, xp, progress] = await Promise.all([
      db.userAchievement.count({ where: { userId, achievement: { listId } } }),
      db.userAchievement.count({ where: { userId, achievement: { platform: "psn", trophyTier: "platinum" } } }),
      db.xpLedgerEntry.aggregate({ where: { userId, voidedAt: null }, _sum: { xp: true } }),
      db.userTrophyList.findUnique({ where: { userId_listId: { userId, listId } }, select: { completedAt: true } }),
    ]);
    out.set(userId, { unlocked, platinums, xp: xp._sum.xp ?? 0, completed: progress?.completedAt != null });
  }
  return out;
}

async function applyPlan(tx: Prisma.TransactionClient, list: { id: string; gameId: string }, p: Plan) {
  for (const u of p.updates) await tx.achievement.update({ where: { id: u.id }, data: u.data });
  for (const { row, data } of p.replaces) {
    const [unlocks, entries] = await Promise.all([
      tx.userAchievement.findMany({ where: { achievementId: row.id } }),
      tx.xpLedgerEntry.findMany({ where: { source: "achievement", sourceKey: row.id } }),
    ]);
    // Detached (list-less, no unlock): the settle voids its valid entries, then it is deleted.
    await tx.achievement.update({ where: { id: row.id }, data: { listId: null } });
    const fresh = await tx.achievement.create({
      data: {
        gameId: list.gameId,
        platform: "psn",
        listId: list.id,
        apiName: row.apiName,
        globalPct: row.globalPct,
        points: row.points,
        ...data,
      },
    });
    await tx.userAchievement.deleteMany({ where: { achievementId: row.id } });
    await tx.userAchievement.createMany({ data: unlocks.map((u) => ({ ...u, achievementId: fresh.id })) });
    await tx.guideAchievementNote.updateMany({ where: { achievementId: row.id }, data: { achievementId: fresh.id } });
    // XP voided before (an unlink, confirmed fraud) stays voided under the new key: the key is
    // written voided as the old one was, so no settle pays it (a fraud release still can, as before).
    const carried = entries.filter((e) => e.voidedAt !== null && unlocks.some((u) => u.userId === e.userId));
    if (carried.length > 0) {
      await tx.xpLedgerEntry.createMany({
        data: carried.map((e) => {
          const u = unlocks.find((x) => x.userId === e.userId)!;
          return {
            userId: e.userId,
            source: "achievement",
            sourceKey: fresh.id,
            xp: xpOf(fresh),
            skills: e.skills,
            platform: "psn",
            createdAt: u.unlockedAt,
            voidedAt: e.voidedAt,
          };
        }),
        skipDuplicates: true,
      });
    }
  }
  if (p.creates.length > 0) {
    await tx.achievement.createMany({
      data: p.creates.map((t) => ({
        gameId: list.gameId,
        platform: "psn",
        listId: list.id,
        apiName: t.trophyId,
        globalPct: t.rarityPct,
        points: null,
        ...definitionOf(t),
      })),
      skipDuplicates: true,
    });
  }
  if (p.removes.length > 0) {
    await tx.achievement.deleteMany({
      where: { id: { in: p.removes.map((r) => r.id) }, unlocks: { none: {} }, notes: { none: {} } },
    });
  }
}

/**
 * The holder's progress on the list against Sony's count (as the sync computes it: complete when
 * every trophy is unlocked and none is suspicious; a stored completion stays while that holds),
 * the game's UserGame on PSN, then the game's XP (settleListXp).
 */
async function settleHolder(
  tx: Prisma.TransactionClient,
  userId: string,
  list: { id: string; gameId: string },
  trophyCount: number,
  now: Date,
) {
  const unlocks = await tx.userAchievement.findMany({
    where: { userId, achievement: { listId: list.id } },
    select: { unlockedAt: true, suspicious: true, hardcore: true },
  });
  const prior = await tx.userTrophyList.findUnique({ where: { userId_listId: { userId, listId: list.id } }, select: { completedAt: true } });
  const complete = unlocks.length > 0 && unlocks.length >= trophyCount && unlocks.every((u) => !u.suspicious);
  const progress = {
    unlockedCount: unlocks.length,
    hardcoreCount: unlocks.filter((u) => u.hardcore).length,
    completedAt: complete ? (prior?.completedAt ?? new Date(Math.max(...unlocks.map((u) => u.unlockedAt.getTime())))) : null,
  };
  await tx.userTrophyList.upsert({
    where: { userId_listId: { userId, listId: list.id } },
    create: { userId, listId: list.id, ...progress },
    update: progress,
  });
  const unlockedCount = await tx.userAchievement.count({
    where: { userId, achievement: { gameId: list.gameId, platform: "psn", listId: { not: null } } },
  });
  await tx.userGame.updateMany({ where: { userId, gameId: list.gameId, platform: "psn" }, data: { unlockedCount } });
  await refreshGameCompletion(tx, userId, "psn", list.gameId);
  await settleListXp(tx, userId, "psn", [list.gameId], now);
}

/**
 * Valid entries of the game whose value differs from what the rule gives now: their key did not
 * change (a trophy paid under another list's row of the same version, a version platinum), and
 * the ledger never rewrites XP.
 */
type Stale = { paid: number; wants: number };

async function staleEntries(tx: Prisma.TransactionClient, userId: string, gameId: string): Promise<Map<string, Stale>> {
  const [lists, achievements, unlocks, progress, game, skills] = await Promise.all([
    tx.trophyList.findMany({ where: { gameId, platform: "psn" }, select: { id: true, externalId: true, console: true, createdAt: true } }),
    tx.achievement.findMany({
      where: { gameId, platform: "psn" },
      select: { id: true, listId: true, apiName: true, globalPct: true, points: true, trophyTier: true },
    }),
    tx.userAchievement.findMany({
      where: { userId, achievement: { gameId, platform: "psn" } },
      select: { achievementId: true, unlockedAt: true, suspicious: true, hardcore: true },
    }),
    tx.userTrophyList.findMany({ where: { userId, list: { gameId, platform: "psn" } }, select: { listId: true, completedAt: true } }),
    tx.userGame.findUnique({ where: { userId_gameId_platform: { userId, gameId, platform: "psn" } }, select: { completedAt: true } }),
    tx.gameSkill.findMany({ where: { gameId }, select: { skill: true } }),
  ]);
  const wanted = desiredListEntries({
    platform: "psn",
    gameId,
    skills: skills.map((s) => s.skill),
    lists,
    achievements,
    unlocks,
    progress,
    legacyCompletedAt: game?.completedAt ?? null,
  });
  if (wanted.length === 0) return new Map();
  const paid = await tx.xpLedgerEntry.findMany({
    where: { userId, voidedAt: null, OR: wanted.map((w) => ({ source: w.source, sourceKey: w.sourceKey })) },
    select: { source: true, sourceKey: true, xp: true },
  });
  const out = new Map<string, Stale>();
  for (const e of paid) {
    const w = wanted.find((x) => x.source === e.source && x.sourceKey === e.sourceKey);
    if (w && w.xp !== e.xp) out.set(`${e.source} ${e.sourceKey}`, { paid: e.xp, wants: w.xp });
  }
  return out;
}

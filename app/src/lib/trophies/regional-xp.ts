import { platinumTallyOf } from "@/lib/character/counts";
import { prisma } from "@/lib/db";
import { levelFromXp } from "@/lib/engine/xp";
import { applyListXpPlan, planListXp, type ListXpPlan } from "@/lib/progression/list-xp";
import { recomputeUser } from "@/lib/progression/recompute";

/*
 * Every regional list pays XP (Lucas, 2026-11-06): the ledger of the PSN games with more than one
 * list in a version only had one version's worth paid. This settles those games for every player
 * holding unlocks on their lists (only the missing per-list entries are added, and the own-id
 * entries of regional copies the old rule voided under the current link are restored; nothing
 * paid is voided) and recomputes each player. `pnpm trophy-lists:regional-xp`.
 */

/** Games settled per transaction. */
const CHUNK = 20;
const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

export type RegionalXpReport = {
  userId: string;
  handle: string;
  /** Games of the player with several lists in one PSN version. */
  games: number;
  /** Ledger entries created: trophies and list platinums. */
  created: { trophies: number; platinums: number };
  /** Voided entries restored (regional copies the old once-per-version rule voided under the current link). */
  restored: number;
  /** Ledger entries voided (expected 0). */
  voided: number;
  /** Wanted entries left unpaid: key voided under the current link, voided before it (unlink), blocked by a voided predecessor. */
  unpaid: { voidedUnderLink: number; voidedBeforeLink: number; blocked: number };
  /**
   * After the run, on these games: valid trophy entries vs valid unlocks, and valid platinum
   * entries vs complete lists without a suspicious unlock (each pair equal: every unlock and every
   * complete list paid once).
   */
  paid: { trophies: [number, number]; platinums: [number, number] };
  /** Valid ledger XP before -> after. */
  xp: [number, number];
  level: [number, number];
  /** "Platinas" one per version (as the profile counted them before) -> one per list. */
  platinums: [number, number];
  /** The PSN platinum trophies ("N na PSN"). */
  psnPlatinums: number;
  /**
   * What the run wrote (or would write): created keys (`source:sourceKey`), restored entries with
   * their old voidedAt, and voided entries (expected none).
   */
  entries: {
    created: string[];
    restored: { id: string; source: string; sourceKey: string; voidedAt: string }[];
    voided: { id: string; source: string; sourceKey: string }[];
  };
};

/** PSN games with two or more lists of one console (version), by id. */
async function multiListGames(): Promise<string[]> {
  const rows = await prisma.trophyList.groupBy({
    by: ["gameId", "console"],
    where: { platform: "psn", console: { not: null } },
    having: { gameId: { _count: { gt: 1 } } },
  });
  return [...new Set(rows.map((r) => r.gameId))].sort();
}

const ledgerXp = async (userId: string) =>
  (await prisma.xpLedgerEntry.aggregate({ where: { userId, voidedAt: null }, _sum: { xp: true } }))._sum.xp ?? 0;

/** Valid trophy / platinum entries, valid unlocks and clean complete lists of the user on these PSN games. */
async function coverage(userId: string, gameIds: string[]) {
  const [row] = await prisma.$queryRaw<{ trophyEntries: number; unlocks: number; platinumEntries: number; completeLists: number }[]>`
    SELECT
      (SELECT count(*)::int FROM "XpLedgerEntry" e JOIN "Achievement" a ON a.id = e."sourceKey"
        WHERE e."userId" = ${userId} AND e.source = 'achievement' AND e."voidedAt" IS NULL
          AND a.platform = 'psn' AND a."gameId" = ANY(${gameIds}::text[])) AS "trophyEntries",
      (SELECT count(*)::int FROM "UserAchievement" ua JOIN "Achievement" a ON a.id = ua."achievementId"
        WHERE ua."userId" = ${userId} AND NOT ua.suspicious AND a.platform = 'psn' AND a."gameId" = ANY(${gameIds}::text[])) AS unlocks,
      (SELECT count(*)::int FROM "XpLedgerEntry" e
        WHERE e."userId" = ${userId} AND e.source = 'platinum' AND e.platform = 'psn' AND e."voidedAt" IS NULL
          AND regexp_replace(e."sourceKey", '^.*:', '') = ANY(${gameIds}::text[])) AS "platinumEntries",
      (SELECT count(*)::int FROM "UserTrophyList" p JOIN "TrophyList" l ON l.id = p."listId"
        WHERE p."userId" = ${userId} AND p."completedAt" IS NOT NULL AND l.platform = 'psn' AND l."gameId" = ANY(${gameIds}::text[])
          AND NOT EXISTS (SELECT 1 FROM "UserAchievement" s JOIN "Achievement" sa ON sa.id = s."achievementId"
            WHERE s."userId" = ${userId} AND s.suspicious AND sa."listId" = l.id)) AS "completeLists"`;
  return row;
}

const count = (entries: { source: string }[], source: string) => entries.filter((e) => e.source === source).length;

/**
 * Settles the multi-list PSN games of every player holding unlocks on their lists (or only
 * `handle`), CHUNK games per transaction, then recomputes each player. `dryRun`: reads only (no
 * write at all; a read-only session works), and reports what the run would change. Idempotent: a
 * second run creates nothing. Players are reported in handle order.
 */
export async function regionalListXp(options: {
  dryRun: boolean;
  handle?: string;
  now?: Date;
  log?: (line: string) => void;
  /** Called with every report so far as each player finishes (the script saves them as it goes). */
  onReport?: (reports: RegionalXpReport[]) => void;
}): Promise<RegionalXpReport[]> {
  const now = options.now ?? new Date();
  const gameIds = await multiListGames();
  if (gameIds.length === 0) return [];
  const holders = await prisma.$queryRaw<{ userId: string; gameId: string }[]>`
    SELECT DISTINCT ua."userId", a."gameId"
    FROM "UserAchievement" ua JOIN "Achievement" a ON a.id = ua."achievementId"
    WHERE a.platform = 'psn' AND a."listId" IS NOT NULL AND a."gameId" = ANY(${gameIds}::text[])`;
  const gamesOf = new Map<string, string[]>();
  for (const h of holders) gamesOf.set(h.userId, [...(gamesOf.get(h.userId) ?? []), h.gameId]);
  const users = await prisma.user.findMany({
    where: { id: { in: [...gamesOf.keys()] }, ...(options.handle && { handle: options.handle }) },
    select: { id: true, handle: true },
    orderBy: { handle: "asc" },
  });

  const reports: RegionalXpReport[] = [];
  for (const user of users) {
    const games = gamesOf.get(user.id)!.sort();
    const xpBefore = await ledgerXp(user.id);
    const before = await coverage(user.id, games);
    const plans: ListXpPlan[] = [];
    for (let i = 0; i < games.length; i += CHUNK) {
      const chunk = games.slice(i, i + CHUNK);
      // The old rule voided (under the current link) the own-id entries of regional copies it merged
      // into the canonical key; every list pays now, so those come back through the release path:
      // only wanted keys, only entries voided at/after LinkedAccount.linkedAt (never an unlink's).
      const restore = (
        await prisma.userAchievement.findMany({
          where: { userId: user.id, suspicious: false, achievement: { platform: "psn", gameId: { in: chunk } } },
          select: { achievementId: true },
        })
      ).map((u) => u.achievementId);
      plans.push(
        options.dryRun
          ? await planListXp(prisma, user.id, "psn", chunk, { restore })
          : await prisma.$transaction(async (tx) => {
              const plan = await planListXp(tx, user.id, "psn", chunk, { restore });
              await applyListXpPlan(tx, plan, now);
              return plan;
            }, TRANSACTION_OPTIONS),
      );
    }
    const createdEntries = plans.flatMap((p) => p.toCreate);
    const restoredEntries = plans.flatMap((p) => p.toRestore);
    const added = [...createdEntries, ...restoredEntries];
    const removed = plans.flatMap((p) => p.toVoid);
    const net = (source: string) => count(added, source) - count(removed, source);
    let xpAfter = xpBefore + added.reduce((sum, e) => sum + e.xp, 0) - removed.reduce((sum, e) => sum + e.xp, 0);
    let after = {
      ...before,
      trophyEntries: before.trophyEntries + net("achievement"),
      platinumEntries: before.platinumEntries + net("platinum"),
    };
    if (!options.dryRun) {
      await recomputeUser(user.id, now);
      xpAfter = await ledgerXp(user.id);
      after = await coverage(user.id, games);
    }
    const tally = await platinumTallyOf(user.id);
    const report: RegionalXpReport = {
      userId: user.id,
      handle: user.handle,
      games: games.length,
      created: { trophies: count(createdEntries, "achievement"), platinums: count(createdEntries, "platinum") },
      restored: restoredEntries.length,
      voided: removed.length,
      unpaid: {
        voidedUnderLink: plans.reduce((n, p) => n + p.unpaid.voidedUnderLink.length, 0),
        voidedBeforeLink: plans.reduce((n, p) => n + p.unpaid.voidedBeforeLink.length, 0),
        blocked: plans.reduce((n, p) => n + p.unpaid.blocked, 0),
      },
      paid: { trophies: [after.trophyEntries, after.unlocks], platinums: [after.platinumEntries, after.completeLists] },
      xp: [xpBefore, xpAfter],
      level: [levelFromXp(xpBefore).level, levelFromXp(xpAfter).level],
      platinums: [tally.perVersion, tally.platinums],
      psnPlatinums: tally.psnPlatinums,
      entries: {
        created: createdEntries.map((e) => `${e.source}:${e.sourceKey}`).sort(),
        restored: restoredEntries.map((e) => ({ id: e.id, source: e.source, sourceKey: e.sourceKey, voidedAt: e.voidedAt.toISOString() })),
        voided: removed.map((e) => ({ id: e.id, source: e.source, sourceKey: e.sourceKey })),
      },
    };
    options.log?.(formatReport(report));
    // When the restored and the left-voided entries were voided (UTC hour), with their XP: tells
    // which run voided them.
    for (const [what, list] of [
      ["restored", restoredEntries],
      ["left voided", plans.flatMap((p) => p.unpaid.voidedUnderLink)],
    ] as const) {
      for (const [hour, { n, xp }] of byVoidedHour(list)) {
        options.log?.(`  ${user.handle}: ${n} entries voided at ${hour} (${fmt(xp)} XP), ${what}`);
      }
    }
    reports.push(report);
    options.onReport?.(reports);
  }
  return reports;
}

const fmt = (n: number) => n.toLocaleString("pt-BR");

/** Count and XP of voided entries by the UTC hour of their voidedAt, in order. */
function byVoidedHour(entries: { voidedAt: Date; xp: number }[]): [string, { n: number; xp: number }][] {
  const byHour = new Map<string, { n: number; xp: number }>();
  for (const e of entries) {
    const hour = `${e.voidedAt.toISOString().slice(0, 13)}h`;
    const acc = byHour.get(hour) ?? { n: 0, xp: 0 };
    byHour.set(hour, { n: acc.n + 1, xp: acc.xp + e.xp });
  }
  return [...byHour].sort(([a], [b]) => (a < b ? -1 : 1));
}
const arrow = ([before, after]: [number, number]) => (before === after ? fmt(before) : `${fmt(before)} -> ${fmt(after)}`);

/** One line per player: games, entries created and voided, XP, level and platinums before -> after, coverage. */
export function formatReport(r: RegionalXpReport): string {
  const [trophyEntries, unlocks] = r.paid.trophies;
  const [platinumEntries, lists] = r.paid.platinums;
  return (
    `${r.handle}: ${r.games} games, new entries ${r.created.trophies} trophies + ${r.created.platinums} platinums, ${r.restored} restored, ` +
    `${r.voided} voided, XP ${arrow(r.xp)}, level ${arrow(r.level)}, platinums ${arrow(r.platinums)} (${r.psnPlatinums} on PSN); ` +
    `after: ${trophyEntries} trophy entries for ${unlocks} unlocks, ${platinumEntries} platinum entries for ${lists} complete lists; ` +
    `unpaid: ${r.unpaid.voidedUnderLink} voided under the link, ${r.unpaid.voidedBeforeLink} voided before it, ${r.unpaid.blocked} blocked`
  );
}

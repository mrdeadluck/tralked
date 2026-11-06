import { prisma } from "@/lib/db";
import type { PsnApi } from "@/lib/integrations/psn/types";
import { describeError } from "@/lib/worker/errors";
import { foreignIconLists, knownCounts, sameTierCounts, tierCounts, type TierCounts } from "./psn-definitions";

// Read-only audit of the PSN trophy lists: Sony's definitions (`definedTrophies` of each linked
// account's title list, one paginated request per account) against each stored list, plus the
// checks that need no Sony: icons naming another list, trophyCount against the rows.

export type ListAudit = {
  externalId: string;
  gameSlug: string | null;
  console: string | null;
  trophyCount: number;
  /** Achievement rows of the list. */
  rows: number;
  stored: TierCounts;
  /** Sony's `definedTrophies` (null when no audited account lists the title). */
  sony: TierCounts | null;
  /** Other lists named by the rows' icon URLs. */
  foreignIcons: string[];
  /**
   * A PSN catalog list (PsnCatalogList) nobody holds: matchPsnCatalog made it without trophies and
   * a page open reads them later, so no rows yet is expected of it.
   */
  catalog?: boolean;
};

export type PsnAuditReport = {
  accounts: { handle: string; status: "ok" | "private" | "failed"; titles: number; error?: string }[];
  /** Lists checked. */
  checked: number;
  /** Lists that differ, by npCommunicationId. */
  mismatches: ListAudit[];
};

const total = (c: TierCounts) => c.bronze + c.silver + c.gold + c.platinum;

/**
 * Why a list differs, or null (lists without rows are not imported yet: only their count is
 * checked; a catalog list without rows is not checked at all).
 */
export function listProblems(l: ListAudit): string[] {
  const out: string[] = [];
  if (l.catalog && l.rows === 0) return out;
  if (l.trophyCount !== l.rows) out.push(`trophyCount ${l.trophyCount} but ${l.rows} rows`);
  if (l.rows > 0 && knownCounts(l.sony)) {
    if (!sameTierCounts(l.stored, l.sony)) out.push("tiers differ from Sony's");
    if (l.trophyCount !== total(l.sony)) out.push(`trophyCount ${l.trophyCount} but Sony defines ${total(l.sony)}`);
  }
  if (l.foreignIcons.length > 0) out.push(`icons of ${l.foreignIcons.join(", ")}`);
  return out;
}

/**
 * Every active PSN connection (or the one of `handle`): Sony's title list, compared with each
 * stored list of those titles. Without `handle`, every other PSN list gets the stored checks too.
 * Writes nothing.
 */
export async function auditPsnLists(psn: PsnApi, options: { handle?: string } = {}): Promise<PsnAuditReport> {
  const accounts = await prisma.linkedAccount.findMany({
    where: { platform: "psn", linkedAt: { not: null }, ...(options.handle && { user: { handle: options.handle } }) },
    select: { externalId: true, user: { select: { handle: true } } },
    orderBy: { user: { handle: "asc" } },
  });
  const report: PsnAuditReport = { accounts: [], checked: 0, mismatches: [] };
  const sonyOf = new Map<string, TierCounts>();
  for (const account of accounts) {
    const handle = account.user.handle;
    try {
      const titles = await psn.getTitles(account.externalId);
      if (titles === "private") {
        report.accounts.push({ handle, status: "private", titles: 0 });
        continue;
      }
      report.accounts.push({ handle, status: "ok", titles: titles.length });
      for (const t of titles) if (knownCounts(t.trophyCounts) && !sonyOf.has(t.npTitleId)) sonyOf.set(t.npTitleId, t.trophyCounts);
    } catch (error) {
      report.accounts.push({ handle, status: "failed", titles: 0, error: describeError(error) });
    }
  }

  const lists = await prisma.trophyList.findMany({
    where: { platform: "psn", ...(options.handle && { externalId: { in: [...sonyOf.keys()] } }) },
    select: { id: true, externalId: true, console: true, trophyCount: true, game: { select: { slug: true } } },
    orderBy: { externalId: "asc" },
  });
  const ids = lists.map((l) => l.id);
  const [tiers, icons, catalog] = await Promise.all([
    prisma.achievement.groupBy({ by: ["listId", "trophyTier"], where: { listId: { in: ids } }, _count: { _all: true } }),
    prisma.$queryRaw<{ listId: string; icon: string }[]>`
      SELECT DISTINCT a."listId", substring(a."iconUrl" from 'NPWR[0-9]{5}_[0-9]{2}') AS icon
      FROM "Achievement" a JOIN "TrophyList" t ON t.id = a."listId"
      WHERE a."listId" = ANY(${ids}::text[]) AND a."iconUrl" ~ 'NPWR[0-9]{5}_[0-9]{2}'
        AND substring(a."iconUrl" from 'NPWR[0-9]{5}_[0-9]{2}') <> t."externalId"`,
    prisma.$queryRaw<{ id: string }[]>`
      SELECT t.id FROM "TrophyList" t JOIN "PsnCatalogList" c ON c.id = t."externalId"
      WHERE t.id = ANY(${ids}::text[])
        AND NOT EXISTS (SELECT 1 FROM "UserTrophyList" u WHERE u."listId" = t.id)`,
  ]);
  const catalogIds = new Set(catalog.map((c) => c.id));
  const storedOf = new Map<string, TierCounts>();
  const rowsOf = new Map<string, number>();
  for (const t of tiers) {
    const counts = storedOf.get(t.listId) ?? tierCounts([]);
    if (t.trophyTier && t.trophyTier in counts) counts[t.trophyTier as keyof TierCounts] += t._count._all;
    storedOf.set(t.listId, counts);
    rowsOf.set(t.listId, (rowsOf.get(t.listId) ?? 0) + t._count._all);
  }
  for (const l of lists) {
    const audit: ListAudit = {
      externalId: l.externalId,
      gameSlug: l.game?.slug ?? null,
      console: l.console,
      trophyCount: l.trophyCount,
      rows: rowsOf.get(l.id) ?? 0,
      stored: storedOf.get(l.id) ?? tierCounts([]),
      sony: sonyOf.get(l.externalId) ?? null,
      foreignIcons: foreignIconLists(
        l.externalId,
        icons.filter((i) => i.listId === l.id).map((i) => i.icon),
      ),
      ...(catalogIds.has(l.id) ? { catalog: true } : {}),
    };
    report.checked++;
    if (listProblems(audit).length > 0) report.mismatches.push(audit);
  }
  return report;
}

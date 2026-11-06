import { prisma } from "@/lib/db";
import type { XboxApi } from "@/lib/integrations/xbox/types";
import { describeError } from "@/lib/worker/errors";
import { xboxConsoleOf } from "./lists";

export type XboxConsolesReport = {
  /** Xbox lists with no console when the run started. */
  missing: number;
  /** Connections whose title history was read (one request each), in the order asked. */
  accounts: { handle: string; status: "ok" | "private" | "failed"; titles: number; error?: string }[];
  /** Lists given a console (or that would be, on a dry run), per console. */
  filled: Record<string, number>;
  /** Lists still without a console: no history read had their title, or its devices say nothing. */
  unresolved: string[];
  written: boolean;
};

/**
 * Fills `console` (360 | ONE | PC) of the Xbox trophy lists that have none, from the `devices` of
 * the title history of the linked Xbox accounts: one request per account, the accounts holding the
 * most of those lists first, none once every list is known. A console already stored is never
 * rewritten (it is part of the lists' identity). Lists created by the trophy-list backfill had no
 * device data; a sync fills a list's console only when it reads the title again.
 * With `dryRun` nothing is written. No list without a console: one query, no request.
 */
export async function fillXboxConsoles(xbox: Pick<XboxApi, "getTitles">, { dryRun }: { dryRun: boolean }): Promise<XboxConsolesReport> {
  const lists = await prisma.trophyList.findMany({
    where: { platform: "xbox", console: null },
    select: { id: true, externalId: true },
  });
  const report: XboxConsolesReport = { missing: lists.length, accounts: [], filled: {}, unresolved: [], written: false };
  if (lists.length === 0) return report;

  const [accounts, held] = await Promise.all([
    prisma.linkedAccount.findMany({
      where: { platform: "xbox", linkedAt: { not: null } },
      select: { userId: true, externalId: true, handle: true },
      orderBy: { linkedAt: "asc" },
    }),
    prisma.userTrophyList.groupBy({ by: ["userId"], where: { listId: { in: lists.map((l) => l.id) } }, _count: { _all: true } }),
  ]);
  const heldBy = new Map(held.map((h) => [h.userId, h._count._all]));
  accounts.sort((a, b) => (heldBy.get(b.userId) ?? 0) - (heldBy.get(a.userId) ?? 0));

  const wanted = new Set(lists.map((l) => l.externalId));
  const consoleOf = new Map<string, string>();
  for (const account of accounts) {
    if (consoleOf.size === wanted.size) break;
    try {
      const titles = await xbox.getTitles(account.externalId);
      if (titles === "private") {
        report.accounts.push({ handle: account.handle, status: "private", titles: 0 });
        continue;
      }
      report.accounts.push({ handle: account.handle, status: "ok", titles: titles.length });
      for (const t of titles) {
        const console = xboxConsoleOf(t.devices);
        if (console && wanted.has(t.titleId) && !consoleOf.has(t.titleId)) consoleOf.set(t.titleId, console);
      }
    } catch (error) {
      report.accounts.push({ handle: account.handle, status: "failed", titles: 0, error: describeError(error).slice(0, 200) });
    }
  }

  const byConsole = new Map<string, string[]>();
  for (const [externalId, console] of consoleOf) byConsole.set(console, [...(byConsole.get(console) ?? []), externalId]);
  report.unresolved = [...wanted].filter((id) => !consoleOf.has(id)).sort();
  if (dryRun || byConsole.size === 0) {
    for (const [console, ids] of byConsole) report.filled[console] = ids.length;
    return report;
  }
  // One transaction, one statement per console; `console: null` keeps a console set meanwhile.
  const counts = await prisma.$transaction(
    [...byConsole].map(([console, ids]) =>
      prisma.trophyList.updateMany({ where: { platform: "xbox", console: null, externalId: { in: ids } }, data: { console } }),
    ),
  );
  [...byConsole.keys()].forEach((console, i) => (report.filled[console] = counts[i].count));
  report.written = true;
  return report;
}

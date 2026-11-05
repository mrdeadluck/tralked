import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getPsn } from "@/lib/integrations";
import type { PsnPlayedGame } from "@/lib/integrations/psn/types";

/**
 * PSN concepts: the played-games list (gamelist v2) gives each store title id (CUSA…/PPSA…) its
 * concept, one per game across regions and consoles. Asking PSN which trophy lists those title ids
 * have (through the player's account) ties a regional list (a Japanese-named PS5 list of GTA V) to
 * its concept, so it lands on the game the concept's other lists and titles are already on
 * (resolvePlatformGame) instead of waiting for a duplicates report.
 */

/** New store title ids asked per sync at most (batches of five: 10 requests). */
export const MAX_NEW_CONCEPT_TITLES = 50;

/** SyncCursor of a connection's title ids already asked: `{ externalId, linkedAt, mapped: string[] }`. */
export const conceptMemoryKey = (linkedAccountId: string) => `psn-concepts:${linkedAccountId}`;

type Memory = { externalId?: unknown; linkedAt?: unknown; mapped?: unknown };

const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

/** Title ids already asked for this link: empty for another account or link on the row (a relink starts over). */
function mappedOf(value: unknown, externalId: string, linkedAt: Date): Set<string> {
  const memory = value as Memory | undefined;
  if (!memory || memory.externalId !== externalId || memory.linkedAt !== linkedAt.toISOString() || !Array.isArray(memory.mapped)) {
    return new Set();
  }
  return new Set(memory.mapped.filter((id): id is string => typeof id === "string"));
}

/**
 * Maps up to `limit` played store title ids not asked before (most recently played first; titles
 * without a concept are never asked) to their trophy lists and returns, for this run, each list
 * found → its concept. Only a title id with exactly one list counts (a collection's title holds
 * several games' lists), and a list reached from two concepts is left out (ambiguous). The ids
 * asked are remembered on the connection (`psn-concepts:<linkedAccountId>`, reset by a relink like
 * the remembered title counts), and lists already stored without a concept get it. Nothing for an
 * account that is not the connection's current one. Request failures throw (the caller logs them
 * and goes on: trophies import without concepts, the ids are asked again next sync).
 */
export async function mapNewTitles(
  accountId: string,
  linkedAccountId: string,
  played: PsnPlayedGame[],
  limit = MAX_NEW_CONCEPT_TITLES,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const account = await prisma.linkedAccount.findUnique({
    where: { id: linkedAccountId },
    select: { externalId: true, linkedAt: true },
  });
  if (!account?.linkedAt || account.externalId !== accountId) return result;
  const linkedAt = account.linkedAt;
  const memory = await prisma.syncCursor.findUnique({ where: { key: conceptMemoryKey(linkedAccountId) } });
  const mapped = mappedOf(memory?.value, accountId, linkedAt);

  const conceptOf = new Map<string, number>();
  const lastPlayed = new Map<string, number>();
  for (const g of played) {
    if (g.conceptId === null || mapped.has(g.titleId)) continue;
    conceptOf.set(g.titleId, g.conceptId);
    lastPlayed.set(g.titleId, Math.max(lastPlayed.get(g.titleId) ?? 0, g.lastPlayedAt?.getTime() ?? 0));
  }
  const due = [...conceptOf.keys()].sort((a, b) => lastPlayed.get(b)! - lastPlayed.get(a)!).slice(0, limit);
  if (due.length === 0) return result;

  const lists = await getPsn().getTrophyListsOfTitles(accountId, due);
  if (lists === "private") return result;

  const ambiguous = new Set<string>();
  for (const [titleId, ids] of lists) {
    const conceptId = conceptOf.get(titleId);
    if (conceptId === undefined || ids.length !== 1) continue;
    const [list] = ids;
    const before = result.get(list);
    if (before !== undefined && before !== conceptId) ambiguous.add(list);
    else result.set(list, conceptId);
  }
  for (const list of ambiguous) result.delete(list);

  // Lists stored before their concept was known (recorded by an earlier sync, or by another
  // player's) get it now; one already set is never changed.
  const byConcept = new Map<number, string[]>();
  for (const [list, conceptId] of result) byConcept.set(conceptId, [...(byConcept.get(conceptId) ?? []), list]);
  for (const [conceptId, externalIds] of byConcept) {
    await prisma.trophyList.updateMany({
      where: { platform: "psn", externalId: { in: externalIds }, conceptId: null },
      data: { conceptId },
    });
  }

  await remember(accountId, linkedAccountId, linkedAt, [...lists.keys()]);
  return result;
}

/** Merges the ids asked into the memory, only while the connection is still the same link. */
async function remember(accountId: string, linkedAccountId: string, linkedAt: Date, asked: string[]): Promise<void> {
  if (asked.length === 0) return;
  await prisma.$transaction(async (tx) => {
    const linked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "LinkedAccount"
      WHERE id = ${linkedAccountId} AND "externalId" = ${accountId} AND "linkedAt" = ${linkedAt}
      FOR UPDATE`;
    if (linked.length === 0) return;
    const key = conceptMemoryKey(linkedAccountId);
    const row = await tx.syncCursor.findUnique({ where: { key } });
    const mapped = mappedOf(row?.value, accountId, linkedAt);
    for (const id of asked) mapped.add(id);
    const value: Prisma.InputJsonObject = { externalId: accountId, linkedAt: linkedAt.toISOString(), mapped: [...mapped] };
    await tx.syncCursor.upsert({ where: { key }, create: { key, value }, update: { value } });
  }, TRANSACTION_OPTIONS);
}

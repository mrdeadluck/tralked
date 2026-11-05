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

/**
 * SyncCursor of a connection's concept memory: `{ externalId, linkedAt, mapped, lists }`, where
 * `mapped` holds the store title ids already asked and `lists` what they taught
 * (npCommunicationId → conceptId). Another account or link on the row (a relink) starts over.
 */
export const conceptMemoryKey = (linkedAccountId: string) => `psn-concepts:${linkedAccountId}`;

type Memory = { mapped: Set<string>; lists: Map<string, number> };

const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

/** The memory of this link: empty for another account or link on the row. */
function memoryOf(value: unknown, externalId: string, linkedAt: Date): Memory {
  const memory = value as { externalId?: unknown; linkedAt?: unknown; mapped?: unknown; lists?: unknown } | undefined;
  const empty: Memory = { mapped: new Set(), lists: new Map() };
  if (!memory || memory.externalId !== externalId || memory.linkedAt !== linkedAt.toISOString()) return empty;
  const mapped = Array.isArray(memory.mapped) ? memory.mapped.filter((id): id is string => typeof id === "string") : [];
  const lists =
    memory.lists && typeof memory.lists === "object" && !Array.isArray(memory.lists)
      ? Object.entries(memory.lists as Record<string, unknown>).flatMap(([list, concept]) =>
          typeof concept === "number" && Number.isInteger(concept) ? [[list, concept] as const] : [],
        )
      : [];
  return { mapped: new Set(mapped), lists: new Map(lists) };
}

/**
 * Lists → concept known for this connection: what earlier syncs learned, plus up to `limit`
 * played store title ids not asked before (most recently played first; titles without a concept
 * are never asked; no request starts after `deadline`). Only a title id with exactly one list
 * counts (a collection's title holds several games' lists), and a list reached from two concepts
 * (in one sync or across syncs) is dropped as ambiguous. The ids answered and what they taught are
 * remembered on the connection (`psn-concepts:<linkedAccountId>`, reset by a relink like the
 * remembered title counts); ids not answered (deadline, failed batch) are asked again next sync.
 * Lists already stored without a concept get it. Nothing for an account that is not the
 * connection's current one. Database errors throw (the caller logs them and goes on: trophies
 * import without concepts).
 */
export async function mapNewTitles(
  accountId: string,
  linkedAccountId: string,
  played: PsnPlayedGame[],
  limit = MAX_NEW_CONCEPT_TITLES,
  deadline?: number,
): Promise<Map<string, number>> {
  const account = await prisma.linkedAccount.findUnique({
    where: { id: linkedAccountId },
    select: { externalId: true, linkedAt: true },
  });
  if (!account?.linkedAt || account.externalId !== accountId) return new Map();
  const linkedAt = account.linkedAt;
  const row = await prisma.syncCursor.findUnique({ where: { key: conceptMemoryKey(linkedAccountId) } });
  const memory = memoryOf(row?.value, accountId, linkedAt);

  const conceptOf = new Map<string, number>();
  const lastPlayed = new Map<string, number>();
  for (const g of played) {
    if (g.conceptId === null || memory.mapped.has(g.titleId)) continue;
    conceptOf.set(g.titleId, g.conceptId);
    lastPlayed.set(g.titleId, Math.max(lastPlayed.get(g.titleId) ?? 0, g.lastPlayedAt?.getTime() ?? 0));
  }
  const due = [...conceptOf.keys()].sort((a, b) => lastPlayed.get(b)! - lastPlayed.get(a)!).slice(0, limit);
  if (due.length === 0 || (deadline !== undefined && Date.now() >= deadline)) return memory.lists;

  const answered = await getPsn().getTrophyListsOfTitles(accountId, due, { deadline });
  if (answered === "private" || answered.size === 0) return memory.lists;

  // What this sync learned (one-list title ids); a list of two concepts is ambiguous.
  const learned = new Map<string, number>();
  const ambiguous = new Set<string>();
  for (const [titleId, ids] of answered) {
    const conceptId = conceptOf.get(titleId);
    if (conceptId === undefined || ids.length !== 1) continue;
    const [list] = ids;
    const before = learned.get(list) ?? memory.lists.get(list);
    if (before !== undefined && before !== conceptId) ambiguous.add(list);
    else learned.set(list, conceptId);
  }
  for (const list of ambiguous) learned.delete(list);

  // Lists stored before their concept was known (recorded by an earlier sync, or by another
  // player's) get it now; one already set is never changed.
  const byConcept = new Map<number, string[]>();
  for (const [list, conceptId] of learned) byConcept.set(conceptId, [...(byConcept.get(conceptId) ?? []), list]);
  for (const [conceptId, externalIds] of byConcept) {
    await prisma.trophyList.updateMany({
      where: { platform: "psn", externalId: { in: externalIds }, conceptId: null },
      data: { conceptId },
    });
  }

  return remember(accountId, linkedAccountId, linkedAt, [...answered.keys()], learned, ambiguous, memory);
}

/**
 * Merges the ids answered and the lists learned into the memory (an ambiguous list is forgotten),
 * only while the connection is still the same link, and returns the lists known.
 */
async function remember(
  accountId: string,
  linkedAccountId: string,
  linkedAt: Date,
  asked: string[],
  learned: Map<string, number>,
  ambiguous: Set<string>,
  read: Memory,
): Promise<Map<string, number>> {
  const merge = (memory: Memory): Memory => {
    const lists = new Map([...memory.lists, ...learned]);
    for (const list of ambiguous) lists.delete(list);
    return { mapped: new Set([...memory.mapped, ...asked]), lists };
  };
  let result = merge(read);
  await prisma.$transaction(async (tx) => {
    const linked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "LinkedAccount"
      WHERE id = ${linkedAccountId} AND "externalId" = ${accountId} AND "linkedAt" = ${linkedAt}
      FOR UPDATE`;
    if (linked.length === 0) return;
    const key = conceptMemoryKey(linkedAccountId);
    const row = await tx.syncCursor.findUnique({ where: { key } });
    result = merge(memoryOf(row?.value, accountId, linkedAt));
    const value: Prisma.InputJsonObject = {
      externalId: accountId,
      linkedAt: linkedAt.toISOString(),
      mapped: [...result.mapped],
      lists: Object.fromEntries(result.lists),
    };
    await tx.syncCursor.upsert({ where: { key }, create: { key, value }, update: { value } });
  }, TRANSACTION_OPTIONS);
  return result.lists;
}

import { prisma } from "@/lib/db";
import { getPsn } from "@/lib/integrations";
import type { PsnApi, PsnServiceName } from "@/lib/integrations/psn/types";
import { definitionsProblem, type TierCounts } from "@/lib/trophies/psn-definitions";

/**
 * PSN trophies of lists nobody on Tralked owns, read when the game page is opened (front e of the
 * trophy unification), the way RetroAchievements sets are (lib/sync/retro-achievements.ts). The
 * psn-catalog worker only keeps a light PsnCatalogList row per Sony list and matchPsnCatalog turns
 * it into a TrophyList without trophies; storing every list's trophies (~1.5 M rows) would not fit
 * the 1 GB of the free Neon plan, so a list's definitions are read once, on its first open.
 *
 * Bounded on purpose: one list per call (a game with several lists reads the next one on its next
 * open) and one Sony request per list. The list is claimed first (`PsnCatalogList.trophiesSyncedAt`),
 * so concurrent opens cost one request. A Sony failure gives the claim back (try later) and never
 * throws: the page must not break.
 */

export type PsnTrophiesResult =
  /** A list's definitions were written. */
  | "loaded"
  /** Nothing was due (already read, or a player's sync filled it). */
  | "none"
  /** Sony failed or answered something that cannot be the list's: nothing written, tried again on a later open. */
  | "failed";

type Due = { externalId: string; serviceName: string; tiers: unknown };

/** True when the game has a PSN catalog list whose trophies were never read and no player filled. */
export async function hasPsnCatalogTrophiesDue(gameId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ one: number }[]>`
    SELECT 1 AS one FROM "PsnCatalogList" p
    JOIN "TrophyList" t ON t.platform = 'psn' AND t."externalId" = p.id
    WHERE t."gameId" = ${gameId} AND p."trophiesSyncedAt" IS NULL AND p."trophyCount" > 0
      AND NOT EXISTS (SELECT 1 FROM "Achievement" a WHERE a."listId" = t.id)
    LIMIT 1`;
  return rows.length > 0;
}

/**
 * Claims (one statement) and returns the first due list of the game. Under concurrency the others
 * wait for the winner's row lock, re-check `trophiesSyncedAt IS NULL` and get nothing.
 */
async function claim(gameId: string, now: Date): Promise<Due | null> {
  const rows = await prisma.$queryRaw<{ id: string; serviceName: string; tiers: unknown }[]>`
    UPDATE "PsnCatalogList" c SET "trophiesSyncedAt" = ${now}
    WHERE c.id = (
        SELECT p.id FROM "PsnCatalogList" p
        JOIN "TrophyList" t ON t.platform = 'psn' AND t."externalId" = p.id
        WHERE t."gameId" = ${gameId} AND p."trophiesSyncedAt" IS NULL AND p."trophyCount" > 0
          AND NOT EXISTS (SELECT 1 FROM "Achievement" a WHERE a."listId" = t.id)
        ORDER BY p.id LIMIT 1)
      AND c."trophiesSyncedAt" IS NULL
    RETURNING c.id, c."serviceName", c.tiers`;
  return rows[0] ? { externalId: rows[0].id, serviceName: rows[0].serviceName, tiers: rows[0].tiers } : null;
}

const tiersOf = (value: unknown): TierCounts | null => {
  const v = (value ?? {}) as Partial<TierCounts>;
  return { bronze: v.bronze ?? 0, silver: v.silver ?? 0, gold: v.gold ?? 0, platinum: v.platinum ?? 0 };
};

/**
 * Reads the definitions of the game's first PSN catalog list that is due and stores them as
 * Achievement rows of its TrophyList (the fields the player sync writes, without any progress:
 * no rarity, no unlocks). A player's sync of the same list later finds these rows by
 * (listId, apiName), so it fills in the rarity and the unlocks without duplicating anything.
 * The answer must pass `definitionsProblem` against the catalog's counts, as in the sync.
 */
export async function loadPsnCatalogTrophies(
  gameId: string,
  api?: Pick<PsnApi, "getListTrophies">,
  now: Date = new Date(),
): Promise<PsnTrophiesResult> {
  const due = await claim(gameId, now);
  if (!due) return "none";

  const giveBack = () =>
    prisma.psnCatalogList.update({ where: { id: due.externalId }, data: { trophiesSyncedAt: null } }).catch(() => undefined);
  try {
    const service: PsnServiceName = due.serviceName === "trophy" ? "trophy" : "trophy2";
    // Resolved after the claim: an unconfigured PSN (PlatformNotConfiguredError) gives it back like any failure.
    const trophies = await (api ?? getPsn()).getListTrophies(due.externalId, service);
    if (!trophies) throw new Error("Sony has no trophies for the list");
    const problem = definitionsProblem(due.externalId, tiersOf(due.tiers), trophies);
    if (problem) throw new Error(`the answer does not match the list: ${problem}`);

    await prisma.$transaction(async (tx) => {
      const list = await tx.trophyList.findUniqueOrThrow({
        where: { platform_externalId: { platform: "psn", externalId: due.externalId } },
        select: { id: true, gameId: true },
      });
      await tx.achievement.createMany({
        data: trophies.map((t) => ({
          gameId: list.gameId,
          platform: "psn",
          listId: list.id,
          apiName: t.trophyId,
          name: t.name,
          description: t.description,
          iconUrl: t.iconUrl,
          hidden: t.hidden,
          globalPct: t.rarityPct,
          trophyTier: t.tier,
          points: null,
        })),
        skipDuplicates: true,
      });
    });
    return "loaded";
  } catch (error) {
    await giveBack();
    console.warn(`PSN trophies of ${due.externalId} (page open): ${error instanceof Error ? error.message : String(error)}`);
    return "failed";
  }
}

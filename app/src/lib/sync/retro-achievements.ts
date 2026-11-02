import { prisma } from "@/lib/db";
import type { RetroCatalogApi } from "@/lib/integrations/retro/catalog";

/**
 * RetroAchievements achievement lists, read on demand (item 15): the RetroCatalogGame import only
 * keeps a light row per RA game, so a game's set is read from RA (API_GetGameExtended, one request)
 * the first time its page is opened (loadRetroAchievements, app/jogos/[slug]/retro-actions.ts), and
 * again when RA changed the set since. A player who owns the game gets the same rows from the RA
 * sync (lib/sync/platform-user.ts, the same Achievement key), so their sync also fills it in.
 * A page open claims the set first (`achievementsSyncedAt`), so many visitors at once cost one
 * request to RA.
 */

type SetRow = { id: number; achievementCount: number; setModifiedAt: Date | null; achievementsSyncedAt: Date | null };

const due = (r: SetRow) =>
  r.achievementCount > 0 &&
  (r.achievementsSyncedAt === null || (r.setModifiedAt !== null && r.setModifiedAt > r.achievementsSyncedAt));

/** The RA sets of a catalog game (its `retro` platform links that are in the RA catalog). */
async function setsOf(gameId: string): Promise<SetRow[]> {
  const links = await prisma.gamePlatformLink.findMany({ where: { gameId, platform: "retro" }, select: { externalId: true } });
  const ids = links.map((l) => Number(l.externalId)).filter((id) => Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647);
  if (ids.length === 0) return [];
  return prisma.retroCatalogGame.findMany({
    where: { id: { in: ids } },
    select: { id: true, achievementCount: true, setModifiedAt: true, achievementsSyncedAt: true },
  });
}

/** True when the game has an RA set whose achievements were never read (or changed since). */
export async function hasRetroAchievementsDue(gameId: string): Promise<boolean> {
  return (await setsOf(gameId)).some(due);
}

export type RetroAchievementsResult = { sets: number; written: number; failed: number };

/**
 * Reads and stores the achievements of every RA set of the game that is due. A set whose rows a
 * player's sync already wrote in full is only marked. A failed read gives the claim back.
 */
export async function syncRetroAchievements(
  gameId: string,
  api: RetroCatalogApi,
  now: Date = new Date(),
): Promise<RetroAchievementsResult> {
  const result: RetroAchievementsResult = { sets: 0, written: 0, failed: 0 };
  const sets = (await setsOf(gameId)).filter(due);
  if (sets.length === 0) return result;
  const stored = await prisma.achievement.count({ where: { gameId, platform: "retro" } });

  for (const set of sets) {
    // Claim: only the request that moves the mark reads RA.
    const claimed = await prisma.$executeRaw`
      UPDATE "RetroCatalogGame" SET "achievementsSyncedAt" = ${now}
      WHERE id = ${set.id}
        AND ("achievementsSyncedAt" IS NULL OR ("setModifiedAt" IS NOT NULL AND "setModifiedAt" > "achievementsSyncedAt"))`;
    if (claimed === 0) continue;
    // One set, never read, and already as many rows as RA counts: a player's sync wrote them.
    if (sets.length === 1 && set.achievementsSyncedAt === null && stored >= set.achievementCount) {
      result.sets++;
      continue;
    }
    try {
      const list = await api.getGameAchievements(set.id);
      if (list === null) throw new Error(`RetroAchievements game ${set.id} not found`);
      result.written += await writeSet(gameId, list);
      result.sets++;
    } catch (error) {
      result.failed++;
      await prisma.retroCatalogGame.update({ where: { id: set.id }, data: { achievementsSyncedAt: set.achievementsSyncedAt } });
      console.warn(`RetroAchievements set ${set.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

/** Writes the set's Achievement rows like the RA player sync does; returns how many were new or changed. */
async function writeSet(
  gameId: string,
  list: { id: string; name: string; description: string | null; iconUrl: string | null; points: number; rarityPct: number | null }[],
): Promise<number> {
  const fields = (a: (typeof list)[number]) => ({
    name: a.name,
    description: a.description,
    iconUrl: a.iconUrl,
    points: a.points,
    globalPct: a.rarityPct,
  });
  const existing = await prisma.achievement.findMany({
    where: { gameId, platform: "retro", apiName: { in: list.map((a) => a.id) } },
    select: { id: true, apiName: true, name: true, description: true, iconUrl: true, points: true, globalPct: true },
  });
  const byApiName = new Map(existing.map((r) => [r.apiName, r]));
  const created = await prisma.achievement.createMany({
    data: list.filter((a) => !byApiName.has(a.id)).map((a) => ({ gameId, platform: "retro", apiName: a.id, ...fields(a) })),
    skipDuplicates: true,
  });
  let changed = 0;
  for (const a of list) {
    const row = byApiName.get(a.id);
    if (!row) continue;
    const next = fields(a);
    if ((Object.keys(next) as (keyof typeof next)[]).some((k) => next[k] !== row[k])) {
      await prisma.achievement.update({ where: { id: row.id }, data: next });
      changed++;
    }
  }
  return created.count + changed;
}

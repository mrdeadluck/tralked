import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { regionOf } from "./lists";

// One-off backfill of the trophy lists from the list-less data that exists today (phase a). Pure
// batch SQL: no row-by-row loops over the Achievement table. Idempotent, and safe next to syncs
// that already write lists: it never duplicates a TrophyList / UserTrophyList (ON CONFLICT DO
// NOTHING) and never attaches a row to a list that already holds its apiName.

const BATCH = 2000;
const TX_OPTIONS = { timeout: 30 * 60_000, maxWait: 30_000 };
const PLATFORMS = ["steam", "psn", "xbox", "retro"] as const;

export type PlatformCounts = {
  listsCreated: number;
  achievementsLinked: number;
  achievementsLeftForResync: number;
  userListsCreated: number;
};

export type BackfillReport = {
  listsCreated: number;
  achievementsLinked: number;
  /** Rows still without a list at the end (multi-list games, plus rows a list already held). */
  achievementsLeftForResync: number;
  userListsCreated: number;
  /** Steam games with Achievement rows but no steamAppId (their list is "game:<gameId>"). */
  steamWithoutAppId: number;
  /** PSN/Xbox/RA games with more than one list: lists created, rows and progress left to the resync. */
  multiListGames: number;
  perPlatform: Record<string, PlatformCounts>;
  dryRun: boolean;
};

class DryRunRollback extends Error {}

const emptyCounts = (): PlatformCounts => ({
  listsCreated: 0,
  achievementsLinked: 0,
  achievementsLeftForResync: 0,
  userListsCreated: 0,
});

/**
 * `gameIds` limits the run to those games (used by tests; the production run passes nothing).
 * dryRun runs every statement in a transaction and rolls it back, so the counts are exact.
 */
export async function backfillTrophyLists(opts: { dryRun?: boolean; gameIds?: string[] } = {}): Promise<BackfillReport> {
  const dryRun = opts.dryRun ?? false;
  const report: BackfillReport = {
    listsCreated: 0,
    achievementsLinked: 0,
    achievementsLeftForResync: 0,
    userListsCreated: 0,
    steamWithoutAppId: 0,
    multiListGames: 0,
    perPlatform: Object.fromEntries(PLATFORMS.map((p) => [p, emptyCounts()])),
    dryRun,
  };
  try {
    await prisma.$transaction(async (tx) => {
      const inScope = (col: string) =>
        opts.gameIds ? Prisma.sql`AND ${Prisma.raw(col)} = ANY(${opts.gameIds}::text[])` : Prisma.empty;

      // 1. Create the lists. Candidates: one per Steam game with rows, one per list-type link.
      const candidates = await tx.$queryRaw<
        { gameId: string; platform: string; externalId: string; console: string | null; name: string; cnt: number; nlinks: number }[]
      >`
        SELECT * FROM (
          SELECT g.id AS "gameId", 'steam'::text AS platform, COALESCE(g."steamAppId"::text, 'game:' || g.id) AS "externalId",
                 'PC'::text AS console, g.name,
                 (SELECT count(*) FROM "Achievement" a WHERE a."gameId" = g.id AND a.platform = 'steam')::int AS cnt, 1 AS nlinks
          FROM "Game" g
          WHERE EXISTS (SELECT 1 FROM "Achievement" a WHERE a."gameId" = g.id AND a.platform = 'steam') ${inScope("g.id")}
          UNION ALL
          SELECT l."gameId", l.platform, l."externalId", NULL::text, g.name,
                 (SELECT count(*) FROM "Achievement" a WHERE a."gameId" = l."gameId" AND a.platform = l.platform)::int,
                 (count(*) OVER (PARTITION BY l."gameId", l.platform))::int
          FROM "GamePlatformLink" l JOIN "Game" g ON g.id = l."gameId"
          WHERE ((l.platform = 'psn' AND l."externalId" LIKE 'NPWR%')
              OR (l.platform IN ('xbox', 'retro')
                  AND EXISTS (SELECT 1 FROM "Achievement" a WHERE a."gameId" = l."gameId" AND a.platform = l.platform)))
            ${inScope('l."gameId"')}
        ) c
        WHERE NOT EXISTS (SELECT 1 FROM "TrophyList" t WHERE t.platform = c.platform AND t."externalId" = c."externalId")`;

      report.steamWithoutAppId = (
        await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM "Game" g
          WHERE g."steamAppId" IS NULL AND EXISTS (SELECT 1 FROM "Achievement" a WHERE a."gameId" = g.id AND a.platform = 'steam')
          ${inScope("g.id")}`
      )[0].n;

      for (let i = 0; i < candidates.length; i += BATCH) {
        const chunk = candidates.slice(i, i + BATCH);
        // Single-list: trophyCount = the rows that get linked; multi-list: 0, the resync sets it.
        // Console stays null at backfill (the sync writes it once it knows); region comes from regionOf.
        const created = await tx.$queryRaw<{ platform: string }[]>`
          INSERT INTO "TrophyList" (id, "gameId", platform, "externalId", console, name, region, "trophyCount")
          SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || u.ext), 1, 24),
                 u.game, u.platform, u.ext, NULLIF(u.console, ''), u.name, NULLIF(u.region, ''), u.cnt
          FROM unnest(${chunk.map((c) => c.gameId)}::text[], ${chunk.map((c) => c.platform)}::text[],
                      ${chunk.map((c) => c.externalId)}::text[], ${chunk.map((c) => c.console ?? "")}::text[],
                      ${chunk.map((c) => c.name)}::text[], ${chunk.map((c) => regionOf(c.name) ?? "")}::text[],
                      ${chunk.map((c) => (c.nlinks > 1 ? 0 : c.cnt))}::int[])
               AS u(game, platform, ext, console, name, region, cnt)
          ON CONFLICT (platform, "externalId") DO NOTHING
          RETURNING platform`;
        for (const row of created) {
          report.listsCreated++;
          report.perPlatform[row.platform].listsCreated++;
        }
      }

      // 2. Target list of each (game, platform) whose rows can be linked in place: Steam always;
      // the others only when the game has exactly one list-type link AND exactly one list.
      await tx.$executeRaw`
        CREATE TEMP TABLE tl_map (game_id text NOT NULL, platform text NOT NULL, list_id text NOT NULL,
                                  PRIMARY KEY (game_id, platform)) ON COMMIT DROP`;
      await tx.$executeRaw`
        INSERT INTO tl_map
        SELECT g.id, 'steam', t.id FROM "Game" g
        JOIN "TrophyList" t ON t.platform = 'steam' AND t."gameId" = g.id
                           AND t."externalId" = COALESCE(g."steamAppId"::text, 'game:' || g.id)
        WHERE EXISTS (SELECT 1 FROM "Achievement" a WHERE a."gameId" = g.id AND a.platform = 'steam')
          ${inScope("g.id")}
        ON CONFLICT DO NOTHING`;
      await tx.$executeRaw`
        INSERT INTO tl_map
        SELECT l."gameId", l.platform, t.id
        FROM "GamePlatformLink" l
        JOIN "TrophyList" t ON t.platform = l.platform AND t."externalId" = l."externalId" AND t."gameId" = l."gameId"
        WHERE ((l.platform = 'psn' AND l."externalId" LIKE 'NPWR%')
            OR (l.platform IN ('xbox', 'retro')
                AND EXISTS (SELECT 1 FROM "Achievement" a WHERE a."gameId" = l."gameId" AND a.platform = l.platform)))
          AND (SELECT count(*) FROM "GamePlatformLink" l2
               WHERE l2."gameId" = l."gameId" AND l2.platform = l.platform
                 AND ((l.platform = 'psn' AND l2."externalId" LIKE 'NPWR%') OR l.platform IN ('xbox', 'retro'))) = 1
          AND (SELECT count(*) FROM "TrophyList" t2 WHERE t2."gameId" = l."gameId" AND t2.platform = l.platform) = 1
          ${inScope('l."gameId"')}
        ON CONFLICT DO NOTHING`;

      report.multiListGames = (
        await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM (
            SELECT t."gameId", t.platform FROM "TrophyList" t
            WHERE t.platform IN ('psn', 'xbox', 'retro') ${inScope('t."gameId"')}
            GROUP BY 1, 2 HAVING count(*) > 1) m`
      )[0].n;

      // 3. Link the rows in keyset batches. Skipped: rows whose apiName the list already holds
      // (a sync wrote them), and a repeated list-less apiName inside the same game/platform.
      let last = "";
      for (;;) {
        const [res] = await tx.$queryRaw<{ last: string | null; by_platform: Record<string, number> }[]>`
          WITH cand AS (
            SELECT a.id, m.list_id FROM "Achievement" a
            JOIN tl_map m ON m.game_id = a."gameId" AND m.platform = a.platform
            WHERE a."listId" IS NULL AND a.id > ${last}
              AND NOT EXISTS (SELECT 1 FROM "Achievement" b WHERE b."listId" = m.list_id AND b."apiName" = a."apiName")
              AND NOT EXISTS (SELECT 1 FROM "Achievement" c WHERE c."gameId" = a."gameId" AND c.platform = a.platform
                              AND c."listId" IS NULL AND c."apiName" = a."apiName" AND c.id < a.id)
            ORDER BY a.id LIMIT ${BATCH}),
          upd AS (UPDATE "Achievement" a SET "listId" = cand.list_id FROM cand WHERE a.id = cand.id RETURNING a.platform)
          SELECT (SELECT max(id) FROM cand) AS last,
                 COALESCE((SELECT jsonb_object_agg(platform, n) FROM (SELECT platform, count(*)::int AS n FROM upd GROUP BY 1) x), '{}'::jsonb) AS by_platform`;
        if (!res.last) break;
        last = res.last;
        for (const [platform, n] of Object.entries(res.by_platform)) {
          report.achievementsLinked += n;
          report.perPlatform[platform].achievementsLinked += n;
        }
      }

      // 4. UserTrophyList for the single-list games, copied from UserGame (RA: hardcore unlocks).
      const made = await tx.$queryRaw<{ platform: string }[]>`
        WITH ins AS (
          INSERT INTO "UserTrophyList" ("userId", "listId", "unlockedCount", "hardcoreCount", "completedAt", "updatedAt")
          SELECT ug."userId", m.list_id, ug."unlockedCount",
                 CASE WHEN ug.platform = 'retro' THEN (
                   SELECT count(*) FROM "UserAchievement" ua JOIN "Achievement" a ON a.id = ua."achievementId"
                   WHERE ua."userId" = ug."userId" AND ua.hardcore AND a."gameId" = ug."gameId" AND a.platform = 'retro')::int
                 ELSE 0 END,
                 ug."completedAt", now()
          FROM "UserGame" ug JOIN tl_map m ON m.game_id = ug."gameId" AND m.platform = ug.platform
          WHERE ug.platform IN ('psn', 'xbox', 'retro')
          ON CONFLICT ("userId", "listId") DO NOTHING
          RETURNING "listId")
        SELECT t.platform FROM ins JOIN "TrophyList" t ON t.id = ins."listId"`;
      for (const row of made) {
        report.userListsCreated++;
        report.perPlatform[row.platform].userListsCreated++;
      }

      // 5. What is still list-less.
      const left = await tx.$queryRaw<{ platform: string; n: number }[]>`
        SELECT a.platform, count(*)::int AS n FROM "Achievement" a
        WHERE a."listId" IS NULL ${inScope('a."gameId"')} GROUP BY a.platform`;
      for (const row of left) {
        report.achievementsLeftForResync += row.n;
        (report.perPlatform[row.platform] ??= emptyCounts()).achievementsLeftForResync = row.n;
      }

      if (dryRun) throw new DryRunRollback();
    }, TX_OPTIONS);
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }
  return report;
}

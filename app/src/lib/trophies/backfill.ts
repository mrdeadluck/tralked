import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { regionOf } from "./lists";

// One-off backfill of the trophy lists from the list-less data that exists today (phase a). Batch
// SQL only: no row-by-row loops over the Achievement table. Every statement commits on its own
// (lists in chunks, rows in keyset batches), so no long transaction holds locks against the live
// crons, and every intermediate state is safe for a sync running next to it. Idempotent, and it
// never duplicates a TrophyList / UserTrophyList (ON CONFLICT DO NOTHING) nor attaches a row to a
// list that already holds its apiName.
//
// Dry run uses read-only SELECTs over the same logic, with the lists that would be created added
// as virtual lists, so its counts equal what the real run then reports.

const DEFAULT_BATCH = 2000;
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
  /** Steam rows still without a list: must be 0 before the NOT NULL of phase d. */
  steamLeftover: number;
  /** Lists created for a list-type link whose game has no rows of that platform. */
  listsWithoutRows: number;
  /** PSN/Xbox/RA games with more than one list: lists created, rows and progress left to the resync. */
  multiListGames: number;
  perPlatform: Record<string, PlatformCounts>;
  dryRun: boolean;
};

type Candidate = { gameId: string; platform: string; externalId: string; console: string | null; name: string; cnt: number; nlinks: number };

const emptyCounts = (): PlatformCounts => ({
  listsCreated: 0,
  achievementsLinked: 0,
  achievementsLeftForResync: 0,
  userListsCreated: 0,
});

const scope = (gameIds: string[] | undefined, col: string) =>
  gameIds ? Prisma.sql`AND ${Prisma.raw(col)} = ANY(${gameIds}::text[])` : Prisma.empty;

/** A GamePlatformLink that is a list: psn NPWR...; xbox/retro of a game with rows on the platform. */
const isListLink = (l: string) =>
  Prisma.raw(`((${l}.platform = 'psn' AND ${l}."externalId" LIKE 'NPWR%')
    OR (${l}.platform IN ('xbox', 'retro')
        AND EXISTS (SELECT 1 FROM "Achievement" ax WHERE ax."gameId" = ${l}."gameId" AND ax.platform = ${l}.platform)))`);

/** Limits a statement to the games of its `raw` CTE (the real-run batch), so it never scans every game. */
type Restrict = { toRaw: boolean };
const inRaw = (r: Restrict, col: string) => (r.toRaw ? Prisma.sql`AND ${Prisma.raw(col)} IN (SELECT "gameId" FROM raw)` : Prisma.empty);

/** `lists` CTE: the lists that exist, plus (dry run) the candidates as virtual lists with a null id. */
function listsCte(virtualFrom: Candidate[] | null, gameIds: string[] | undefined, r: Restrict) {
  const real = Prisma.sql`SELECT "gameId" AS game_id, platform, "externalId" AS ext, id FROM "TrophyList"
    WHERE true ${scope(gameIds, '"gameId"')} ${inRaw(r, '"gameId"')}`;
  if (!virtualFrom || virtualFrom.length === 0) return Prisma.sql`lists AS NOT MATERIALIZED (${real})`;
  return Prisma.sql`lists AS NOT MATERIALIZED (${real} UNION ALL
    SELECT v.game, v.platform, v.ext, NULL::text
    FROM unnest(${virtualFrom.map((c) => c.gameId)}::text[], ${virtualFrom.map((c) => c.platform)}::text[],
                ${virtualFrom.map((c) => c.externalId)}::text[]) AS v(game, platform, ext))`;
}

/**
 * `tgt` CTE (needs `lists`): where the list-less rows of a (game, platform) go. Steam: its own list.
 * The others: only when the game has exactly one list-type link and exactly one list (GROUP BY ...
 * HAVING count(*) = 1, joined back). Recomputed inside every statement, so no session state is
 * relied on; in the real-run batch it only looks at the games of `raw`.
 */
function tgtCte(gameIds: string[] | undefined, r: Restrict) {
  return Prisma.sql`one_link AS (
    SELECT lk."gameId" AS game_id, lk.platform FROM "GamePlatformLink" lk
    WHERE lk.platform IN ('psn', 'xbox', 'retro') AND ${isListLink("lk")} ${scope(gameIds, 'lk."gameId"')} ${inRaw(r, 'lk."gameId"')}
    GROUP BY 1, 2 HAVING count(*) = 1),
  one_list AS (SELECT game_id, platform FROM lists GROUP BY 1, 2 HAVING count(*) = 1),
  tgt AS (
    SELECT g.id AS game_id, 'steam'::text AS platform, l.id AS list_id
    FROM "Game" g
    JOIN lists l ON l.game_id = g.id AND l.platform = 'steam' AND l.ext = COALESCE(g."steamAppId"::text, 'game:' || g.id)
    WHERE true ${scope(gameIds, "g.id")} ${inRaw(r, "g.id")}
    UNION ALL
    SELECT lk."gameId", lk.platform, l.id
    FROM one_link ol
    JOIN one_list oli ON oli.game_id = ol.game_id AND oli.platform = ol.platform
    JOIN "GamePlatformLink" lk ON lk."gameId" = ol.game_id AND lk.platform = ol.platform AND ${isListLink("lk")}
    JOIN lists l ON l.game_id = lk."gameId" AND l.platform = lk.platform AND l.ext = lk."externalId")`;
}

/** SQL for "the list already holds this apiName", shared by the batch and the dry run. */
const listHolds = (listId: string, apiName: string) =>
  Prisma.raw(`EXISTS (SELECT 1 FROM "Achievement" b WHERE b."listId" = ${listId} AND b."apiName" = ${apiName})`);

async function findCandidates(gameIds: string[] | undefined): Promise<Candidate[]> {
  return prisma.$queryRaw<Candidate[]>`
    SELECT * FROM (
      SELECT g.id AS "gameId", 'steam'::text AS platform, COALESCE(g."steamAppId"::text, 'game:' || g.id) AS "externalId",
             'PC'::text AS console, g.name,
             (SELECT count(*) FROM "Achievement" a WHERE a."gameId" = g.id AND a.platform = 'steam')::int AS cnt, 1 AS nlinks
      FROM "Game" g
      WHERE EXISTS (SELECT 1 FROM "Achievement" a WHERE a."gameId" = g.id AND a.platform = 'steam') ${scope(gameIds, "g.id")}
      UNION ALL
      SELECT l."gameId", l.platform, l."externalId", NULL::text, g.name,
             (SELECT count(*) FROM "Achievement" a WHERE a."gameId" = l."gameId" AND a.platform = l.platform)::int,
             (count(*) OVER (PARTITION BY l."gameId", l.platform))::int
      FROM "GamePlatformLink" l JOIN "Game" g ON g.id = l."gameId"
      WHERE ${isListLink("l")} ${scope(gameIds, 'l."gameId"')}
    ) c
    WHERE NOT EXISTS (SELECT 1 FROM "TrophyList" t WHERE t.platform = c.platform AND t."externalId" = c."externalId")`;
}

/**
 * `gameIds` limits the run to those games and `batchSize` shrinks the batches (tests only; the
 * production run passes neither). dryRun writes nothing: it only runs SELECTs.
 */
export async function backfillTrophyLists(
  opts: { dryRun?: boolean; gameIds?: string[]; batchSize?: number } = {},
): Promise<BackfillReport> {
  const { gameIds } = opts;
  const dryRun = opts.dryRun ?? false;
  const batch = opts.batchSize ?? DEFAULT_BATCH;
  const report: BackfillReport = {
    listsCreated: 0,
    achievementsLinked: 0,
    achievementsLeftForResync: 0,
    userListsCreated: 0,
    steamWithoutAppId: 0,
    steamLeftover: 0,
    listsWithoutRows: 0,
    multiListGames: 0,
    perPlatform: Object.fromEntries(PLATFORMS.map((p) => [p, emptyCounts()])),
    dryRun,
  };

  // 1. The lists. Console stays null (the sync writes it once it knows) except Steam "PC"; region
  // from regionOf; trophyCount = rows linked for a single-list game, 0 for a multi-list one.
  const candidates = await findCandidates(gameIds);
  report.listsWithoutRows = candidates.filter((c) => c.cnt === 0).length;
  report.steamWithoutAppId = (
    await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "Game" g
      WHERE g."steamAppId" IS NULL AND EXISTS (SELECT 1 FROM "Achievement" a WHERE a."gameId" = g.id AND a.platform = 'steam')
      ${scope(gameIds, "g.id")}`
  )[0].n;

  if (dryRun) {
    for (const c of candidates) {
      report.listsCreated++;
      report.perPlatform[c.platform].listsCreated++;
    }
  } else {
    for (let i = 0; i < candidates.length; i += batch) {
      const chunk = candidates.slice(i, i + batch);
      const created = await prisma.$queryRaw<{ platform: string }[]>`
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
  }

  const all: Restrict = { toRaw: false };
  const lists = listsCte(dryRun ? candidates : null, gameIds, all);
  const tgt = tgtCte(gameIds, all);

  // 2. Link the rows. Skipped: rows whose apiName the target list already holds (a sync wrote them).
  if (dryRun) {
    const rows = await prisma.$queryRaw<{ platform: string; n: number }[]>`
      WITH ${lists}, ${tgt}
      SELECT x.platform, count(*)::int AS n FROM (
        SELECT DISTINCT a.platform, a."gameId", a."apiName" FROM "Achievement" a
        JOIN tgt t ON t.game_id = a."gameId" AND t.platform = a.platform
        WHERE a."listId" IS NULL AND (t.list_id IS NULL OR NOT ${listHolds("t.list_id", 'a."apiName"')})) x
      GROUP BY x.platform`;
    for (const r of rows) {
      report.achievementsLinked += r.n;
      report.perPlatform[r.platform].achievementsLinked += r.n;
    }
  } else {
    const inBatch: Restrict = { toRaw: true };
    let last = "";
    for (;;) {
      // raw = the next list-less rows by id (eligible or not), so a batch of ineligible rows never
      // ends the loop early; the keyset moves past all of them.
      const [res] = await prisma.$queryRaw<{ last: string | null; by_platform: Record<string, number> }[]>`
        WITH raw AS (
          SELECT a.id, a."gameId", a.platform, a."apiName" FROM "Achievement" a
          WHERE a."listId" IS NULL AND a.id > ${last} ${scope(gameIds, 'a."gameId"')}
          ORDER BY a.id LIMIT ${batch}),
        ${listsCte(null, gameIds, inBatch)}, ${tgtCte(gameIds, inBatch)},
        cand AS (
          SELECT DISTINCT ON (t.list_id, r."apiName") r.id, t.list_id FROM raw r
          JOIN tgt t ON t.game_id = r."gameId" AND t.platform = r.platform
          WHERE NOT ${listHolds("t.list_id", 'r."apiName"')}
          ORDER BY t.list_id, r."apiName", r.id),
        upd AS (UPDATE "Achievement" a SET "listId" = cand.list_id FROM cand WHERE a.id = cand.id RETURNING a.platform)
        SELECT (SELECT max(id) FROM raw) AS last,
               COALESCE((SELECT jsonb_object_agg(platform, n) FROM (SELECT platform, count(*)::int AS n FROM upd GROUP BY 1) x), '{}'::jsonb) AS by_platform`;
      if (!res.last) break;
      last = res.last;
      for (const [platform, n] of Object.entries(res.by_platform)) {
        report.achievementsLinked += n;
        (report.perPlatform[platform] ??= emptyCounts()).achievementsLinked += n;
      }
    }
  }

  // 3. UserTrophyList for the single-list games, copied from UserGame (RA: hardcore unlocks). A
  // UserGame with nothing unlocked and no completion carries no progress and is not copied.
  const userLists = Prisma.sql`
    SELECT ug."userId", t.list_id, ug."unlockedCount", ug."completedAt", ug."gameId", ug.platform
    FROM "UserGame" ug JOIN tgt t ON t.game_id = ug."gameId" AND t.platform = ug.platform
    WHERE ug.platform IN ('psn', 'xbox', 'retro') AND NOT (ug."unlockedCount" = 0 AND ug."completedAt" IS NULL)`;
  if (dryRun) {
    const rows = await prisma.$queryRaw<{ platform: string; n: number }[]>`
      WITH ${lists}, ${tgt}, ul AS (${userLists})
      SELECT ul.platform, count(*)::int AS n FROM ul
      WHERE ul.list_id IS NULL OR NOT EXISTS (SELECT 1 FROM "UserTrophyList" x WHERE x."userId" = ul."userId" AND x."listId" = ul.list_id)
      GROUP BY ul.platform`;
    for (const r of rows) {
      report.userListsCreated += r.n;
      report.perPlatform[r.platform].userListsCreated += r.n;
    }
  } else {
    const made = await prisma.$queryRaw<{ platform: string }[]>`
      WITH ${lists}, ${tgt}, ul AS (${userLists}),
      ins AS (
        INSERT INTO "UserTrophyList" ("userId", "listId", "unlockedCount", "hardcoreCount", "completedAt", "updatedAt")
        SELECT ul."userId", ul.list_id, ul."unlockedCount",
               CASE WHEN ul.platform = 'retro' THEN (
                 SELECT count(*) FROM "UserAchievement" ua JOIN "Achievement" a ON a.id = ua."achievementId"
                 WHERE ua."userId" = ul."userId" AND ua.hardcore AND a."gameId" = ul."gameId" AND a.platform = 'retro')::int
               ELSE 0 END,
               ul."completedAt", now()
        FROM ul
        ON CONFLICT ("userId", "listId") DO NOTHING
        RETURNING "listId")
      SELECT t.platform FROM ins JOIN "TrophyList" t ON t.id = ins."listId"`;
    for (const row of made) {
      report.userListsCreated++;
      report.perPlatform[row.platform].userListsCreated++;
    }
  }

  // 4. What the run leaves behind.
  report.multiListGames = (
    await prisma.$queryRaw<{ n: number }[]>`
      WITH ${lists}
      SELECT count(*)::int AS n FROM (
        SELECT game_id, platform FROM lists WHERE platform IN ('psn', 'xbox', 'retro')
        GROUP BY 1, 2 HAVING count(*) > 1) m`
  )[0].n;
  const total = await prisma.$queryRaw<{ platform: string; n: number }[]>`
    SELECT a.platform, count(*)::int AS n FROM "Achievement" a
    WHERE a."listId" IS NULL ${scope(gameIds, 'a."gameId"')} GROUP BY a.platform`;
  for (const row of total) {
    const counts = (report.perPlatform[row.platform] ??= emptyCounts());
    const left = dryRun ? row.n - counts.achievementsLinked : row.n;
    report.achievementsLeftForResync += left;
    counts.achievementsLeftForResync = left;
  }
  report.steamLeftover = report.perPlatform.steam.achievementsLeftForResync;
  return report;
}

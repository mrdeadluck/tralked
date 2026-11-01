import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { mapToSkills } from "@/lib/integrations";
import { getIgdbCatalog } from "@/lib/integrations/igdb";
import type { IgdbCatalogApi } from "@/lib/integrations/igdb/catalog-types";
import { IGDB_EXTRA_PLATFORMS, IGDB_PLATFORM_IDS, type ReleasePlatform } from "@/lib/releases/platforms";
import { resolveIgdbGames } from "./igdb-games";

/**
 * Cron job `igdb-catalog` (Plano 4, F10): every game of PlayStation (PS1–PS5, PSP, Vita), Xbox
 * (all), Nintendo (NES to Switch 2, handhelds) and PC that IGDB knows, so the catalog search finds
 * "every possible game". Needs IGDB_CLIENT_ID/SECRET (in production without them it does nothing).
 * 50 s per run:
 * 1. Import (≤ 60% of the budget): pages of 500 games by id (main games, remakes, remasters,
 *    ports, standalone expansions), resumable from the id kept in SyncCursor `igdb-catalog`; once
 *    a pass ends, the next ones ask only for games changed since it began. Each page is matched to
 *    the catalog without duplicates (lib/sync/igdb-games.ts); new games are name-only stubs.
 * 2. Details (the rest): IGDB stubs without a Steam appid (Steam games get theirs from the Steam
 *    details job) get summary, cover, score, genres → skills, 500 per IGDB request: games someone
 *    opened first, then owned ones, then the newest. Then they leave the stub state and are listed.
 * IGDB allows 4 requests per second; the client serializes and spaces requests.
 */

export const IGDB_CATALOG_BUDGET_MS = 50_000;
const IMPORT_SHARE = 0.6;
const PAGE = 500;
const DETAILS_BATCH = 500;
const CURSOR = "igdb-catalog";
const IGDB_COVER_URL = "https://images.igdb.com/igdb/image/upload/t_cover_big";

export type IgdbCatalogCursor = { lastId: number; since: number | null; passStartedAt: number };

export type IgdbCatalogDeps = { igdb: IgdbCatalogApi | null; now: () => number };

const defaultDeps = (): IgdbCatalogDeps => ({ igdb: getIgdbCatalog(), now: Date.now });

async function readCursor(): Promise<IgdbCatalogCursor | null> {
  const row = await prisma.syncCursor.findUnique({ where: { key: CURSOR } });
  return (row?.value as IgdbCatalogCursor | undefined) ?? null;
}

async function writeCursor(value: IgdbCatalogCursor): Promise<void> {
  await prisma.syncCursor.upsert({ where: { key: CURSOR }, create: { key: CURSOR, value }, update: { value } });
}

export type IgdbImportResult = { pages: number; games: number; created: number; passDone: boolean };

/** Step 1: catalog pages until `deadline` (at least one page when there is time). */
export async function importIgdbCatalog(igdb: IgdbCatalogApi, deadline: number, now: () => number, pageSize = PAGE): Promise<IgdbImportResult> {
  const result: IgdbImportResult = { pages: 0, games: 0, created: 0, passDone: false };
  const extraFamilies: Record<number, ReleasePlatform> = {};
  try {
    for (const id of await igdb.findPlatformIds(IGDB_EXTRA_PLATFORMS.map((p) => p.name))) {
      extraFamilies[id] = IGDB_EXTRA_PLATFORMS[0].family;
    }
  } catch (error) {
    console.warn("IGDB catalog: platform lookup failed", error);
  }
  const platforms = [...IGDB_PLATFORM_IDS, ...Object.keys(extraFamilies).map(Number)];

  while (now() < deadline) {
    const nowSec = Math.floor(now() / 1000);
    const cursor = (await readCursor()) ?? { lastId: 0, since: null, passStartedAt: nowSec };
    const passStartedAt = cursor.lastId === 0 ? nowSec : cursor.passStartedAt;
    const page = await igdb.listGames({
      platforms,
      afterId: cursor.lastId,
      updatedSince: cursor.since ?? undefined,
      limit: pageSize,
    });
    const resolved = await resolveIgdbGames(page.games, { extraFamilies });
    result.pages++;
    result.games += page.games.length;
    result.created += resolved.created;
    // A full raw page means there may be more, even when some of its rows were unusable.
    const lastId = Math.max(cursor.lastId, page.lastId);
    const more = page.rawCount >= pageSize && lastId > cursor.lastId;
    await writeCursor(more ? { lastId, since: cursor.since, passStartedAt } : { lastId: 0, since: passStartedAt, passStartedAt });
    if (!more) {
      result.passDone = true;
      break;
    }
  }
  return result;
}

const IGDB_STUB = { stub: true, steamAppId: null, igdbId: { not: null }, detailsSyncedAt: null } satisfies Prisma.GameWhereInput;

/** IGDB stubs waiting for details, most needed first: opened, then owned or wished, then newest. */
async function detailsCandidates(limit: number): Promise<{ id: string; igdbId: number }[]> {
  const select = { id: true, igdbId: true } as const;
  const picked = new Map<string, number>();
  const add = (rows: { id: string; igdbId: number | null }[]) => {
    for (const r of rows) if (r.igdbId !== null && picked.size < limit) picked.set(r.id, r.igdbId);
  };
  add(await prisma.game.findMany({ where: { ...IGDB_STUB, detailsRequestedAt: { not: null } }, orderBy: { detailsRequestedAt: "asc" }, take: limit, select }));
  if (picked.size < limit) {
    add(
      await prisma.game.findMany({
        where: { ...IGDB_STUB, id: { notIn: [...picked.keys()] }, OR: [{ users: { some: {} } }, { wishlistedBy: { some: {} } }] },
        take: limit - picked.size,
        select,
      }),
    );
  }
  if (picked.size < limit) {
    add(
      await prisma.game.findMany({
        where: { ...IGDB_STUB, id: { notIn: [...picked.keys()] } },
        orderBy: [{ lastSyncAttemptAt: { sort: "asc", nulls: "first" } }, { releaseDate: { sort: "desc", nulls: "last" } }, { id: "asc" }],
        take: limit - picked.size,
        select,
      }),
    );
  }
  return [...picked].map(([id, igdbId]) => ({ id, igdbId }));
}

export type IgdbDetailsResult = { processed: number; missing: number };

/** Step 2: one batch of IGDB stubs gets its details (one IGDB request). */
export async function syncIgdbDetails(igdb: IgdbCatalogApi, now: Date, limit = DETAILS_BATCH): Promise<IgdbDetailsResult> {
  const candidates = await detailsCandidates(limit);
  if (candidates.length === 0) return { processed: 0, missing: 0 };
  // Rotated to the back first: a batch that keeps failing does not hold the queue.
  await prisma.game.updateMany({ where: { id: { in: candidates.map((c) => c.id) } }, data: { lastSyncAttemptAt: now } });
  const details = new Map((await igdb.getGames(candidates.map((c) => c.igdbId))).map((g) => [g.igdbId, g]));
  const current = await prisma.game.findMany({
    where: { id: { in: candidates.map((c) => c.id) } },
    select: { id: true, summary: true, coverUrl: true, criticScore: true, releaseDate: true, _count: { select: { skills: true } } },
  });
  const byId = new Map(current.map((g) => [g.id, g]));
  let processed = 0;
  let missing = 0;
  for (const { id, igdbId } of candidates) {
    const igdbGame = details.get(igdbId);
    const game = byId.get(id);
    if (!game) continue;
    if (!igdbGame) {
      // IGDB no longer has it (merged, removed): done, it stays a stub.
      missing++;
      await prisma.game.update({ where: { id }, data: { detailsSyncedAt: now, detailsRequestedAt: null } });
      continue;
    }
    const cover = igdbGame.coverImageId && /^[a-z0-9]+$/i.test(igdbGame.coverImageId) ? `${IGDB_COVER_URL}/${igdbGame.coverImageId}.jpg` : undefined;
    const skills = game._count.skills === 0 ? mapToSkills(igdbGame) : [];
    await prisma.$transaction([
      prisma.game.update({
        where: { id },
        data: {
          ...(game.summary == null && igdbGame.summary ? { summary: igdbGame.summary } : {}),
          ...(game.coverUrl == null && cover ? { coverUrl: cover } : {}),
          ...(game.criticScore == null && igdbGame.aggregatedRating !== undefined ? { criticScore: Math.round(igdbGame.aggregatedRating) } : {}),
          ...(game.releaseDate == null && igdbGame.releaseDate ? { releaseDate: igdbGame.releaseDate } : {}),
          stub: false,
          detailsSyncedAt: now,
          detailsRequestedAt: null,
        },
      }),
      prisma.gameSkill.createMany({ data: skills.map((skill) => ({ gameId: id, skill })), skipDuplicates: true }),
    ]);
    processed++;
  }
  return { processed, missing };
}

export type IgdbCatalogResult = {
  processed: number;
  failed: number;
  status: "ok" | "disabled";
  import?: IgdbImportResult;
  details?: IgdbDetailsResult;
};

export async function runIgdbCatalogJob(
  budgetMs = IGDB_CATALOG_BUDGET_MS,
  deps: IgdbCatalogDeps = defaultDeps(),
): Promise<IgdbCatalogResult> {
  const { igdb } = deps;
  if (!igdb) return { processed: 0, failed: 0, status: "disabled" };
  const start = deps.now();
  const deadline = start + budgetMs;
  let failed = 0;
  let imported: IgdbImportResult = { pages: 0, games: 0, created: 0, passDone: false };
  try {
    imported = await importIgdbCatalog(igdb, start + budgetMs * IMPORT_SHARE, deps.now);
  } catch (error) {
    failed++;
    console.error("IGDB catalog: import failed", error);
  }
  const details: IgdbDetailsResult = { processed: 0, missing: 0 };
  while (deps.now() < deadline) {
    try {
      const batch = await syncIgdbDetails(igdb, new Date(deps.now()));
      details.processed += batch.processed;
      details.missing += batch.missing;
      if (batch.processed + batch.missing === 0) break;
    } catch (error) {
      failed++;
      console.error("IGDB catalog: details failed", error);
      break;
    }
  }
  return { processed: imported.games + details.processed, failed, status: "ok", import: imported, details };
}

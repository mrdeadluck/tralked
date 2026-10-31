import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getIgdb, getSgdb, getSteam, type SteamApi } from "@/lib/integrations";
import type { IgdbApi, SgdbApi } from "@/lib/integrations";
import { steamMode } from "@/lib/integrations/steam";
import { createPoliteFetch, type PoliteFetch } from "@/lib/integrations/steam/polite-fetch";
import { fetchMostOwnedPage, fetchTags } from "@/lib/integrations/steam/steamspy";
import { fetchStoreApp, libraryAssetUrls } from "@/lib/integrations/steam/store";
import { mapTagsToSkills } from "@/lib/integrations/steam/tags-map";
import { ensureSteamGames } from "./steam-games";
import { writeCatalogGame, type CatalogMedia } from "./write-catalog-game";

/**
 * The full Steam catalog (Plano 4, F1), in three budgeted steps run by the `steam-catalog` cron:
 *
 * 1. App list: every game of the store (IStoreService/GetAppList, needs STEAM_API_KEY), 10k per
 *    page, written as name-only stubs (lib/sync/steam-games.ts). Resumable and idempotent: the
 *    position (`last_appid`) lives in SyncCursor; once a pass reaches the end, the next passes ask
 *    only for apps changed since that pass began (`if_modified_since`).
 * 2. Popularity: one SteamSpy "most owned" page (1,000 apps) per run, rotating over the first
 *    pages, sets Game.popularity (SteamSpy allows one such request a minute).
 * 3. Details: store page in pt-BR (summary, developer, dates, score; never the price), SteamSpy
 *    tags (skills), achievement schema and rarity, and art from the Steam CDN by appid
 *    (library 600×900 cover, hero, logo: each checked with a HEAD before it is written; IGDB or
 *    SteamGridDB cover when Steam has none). Games someone needs go first: requested (a player
 *    opened the page), then owned or wished by a player, then the most popular.
 *
 * Nothing here runs during a page render: pages only read the database.
 */

/** Wall-clock budget of one cron run, shared by the three steps. */
export const STEAM_CATALOG_BUDGET_MS = 50_000;
/** At most this share of the budget goes to the app list (the rest to popularity and details). */
const APP_LIST_SHARE = 0.4;
const APP_LIST_PAGE = 10_000;
/** SteamSpy pages rotated for popularity (the 10k most owned apps). */
const POPULARITY_PAGES = 10;
const DETAILS_BATCH = 40;
const MAX_TRAILERS = 2;

const APP_LIST_CURSOR = "steam-applist";
const POPULARITY_CURSOR = "steamspy-popularity";

export type AppListCursor = {
  /** Next page starts after this appid (0: a new pass). */
  lastAppId: number;
  /** Ask only for apps changed since (Unix seconds): set once a full pass ended. */
  since: number | null;
  /** When the current pass began (Unix seconds); becomes `since` when it ends. */
  passStartedAt: number;
};

export type SteamCatalogDeps = {
  steam: SteamApi;
  /** Polite fetch for the store, SteamSpy and the CDN; null offline (fixtures): no details then. */
  politeFetch: PoliteFetch | null;
  igdb: IgdbApi;
  sgdb: SgdbApi;
  now: () => number;
};

function defaultDeps(): SteamCatalogDeps {
  return {
    steam: getSteam(),
    politeFetch:
      steamMode() === "fixture"
        ? null
        : createPoliteFetch({
            hostIntervalsMs: { "store.steampowered.com": 1_500, "shared.akamai.steamstatic.com": 250 },
          }),
    igdb: getIgdb(),
    sgdb: getSgdb(),
    now: Date.now,
  };
}

async function readCursor<T>(key: string): Promise<T | null> {
  const row = await prisma.syncCursor.findUnique({ where: { key } });
  return (row?.value as T | undefined) ?? null;
}

async function writeCursor(key: string, value: Prisma.InputJsonValue): Promise<void> {
  await prisma.syncCursor.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export type AppListResult = { status: "ok" | "unsupported"; pages: number; apps: number; passDone: boolean };

/** Step 1: imports app-list pages until `deadline` (at least one page when there is time). */
export async function importSteamAppList(
  deadline: number,
  deps: Pick<SteamCatalogDeps, "steam" | "now"> = defaultDeps(),
  pageSize = APP_LIST_PAGE,
): Promise<AppListResult> {
  const result: AppListResult = { status: "ok", pages: 0, apps: 0, passDone: false };
  while (deps.now() < deadline) {
    const nowSec = Math.floor(deps.now() / 1000);
    const cursor = (await readCursor<AppListCursor>(APP_LIST_CURSOR)) ?? { lastAppId: 0, since: null, passStartedAt: nowSec };
    const passStartedAt = cursor.lastAppId === 0 ? nowSec : cursor.passStartedAt;
    const page = await deps.steam.getAppList({
      lastAppId: cursor.lastAppId || undefined,
      ifModifiedSince: cursor.since ?? undefined,
      maxResults: pageSize,
    });
    if (page === "unsupported") return { ...result, status: "unsupported" };
    await ensureSteamGames(page.apps, { now: new Date(deps.now()) });
    result.pages++;
    result.apps += page.apps.length;
    const more = page.haveMore && page.lastAppId > cursor.lastAppId;
    const next: AppListCursor = more
      ? { lastAppId: page.lastAppId, since: cursor.since, passStartedAt }
      : { lastAppId: 0, since: passStartedAt, passStartedAt };
    await writeCursor(APP_LIST_CURSOR, next);
    if (!more) {
      result.passDone = true;
      break;
    }
  }
  return result;
}

/** Step 2: one SteamSpy page of the most owned apps sets their popularity (owners lower bound). */
export async function refreshPopularity(politeFetch: PoliteFetch): Promise<number> {
  const cursor = (await readCursor<{ page: number }>(POPULARITY_CURSOR)) ?? { page: 0 };
  const apps = await fetchMostOwnedPage(politeFetch, cursor.page);
  const rows = apps.filter((a) => Number.isInteger(a.appId) && a.appId > 0);
  if (rows.length > 0) {
    const values = Prisma.join(rows.map((a) => Prisma.sql`(${a.appId}::int, ${Math.max(1, a.ownersMin)}::int)`));
    await prisma.$executeRaw`
      UPDATE "Game" AS g SET popularity = v.p
      FROM (VALUES ${values}) AS v(appid, p)
      WHERE g."steamAppId" = v.appid AND g.popularity <> v.p`;
  }
  const page = rows.length === 0 ? 0 : (cursor.page + 1) % POPULARITY_PAGES;
  await writeCursor(POPULARITY_CURSOR, { page });
  return rows.length;
}

/** Games waiting for details, most needed first: requested, then owned or wished, then popular. */
async function detailsCandidates(limit: number): Promise<{ id: string; steamAppId: number }[]> {
  const base = { steamAppId: { not: null }, detailsSyncedAt: null } satisfies Prisma.GameWhereInput;
  const select = { id: true, steamAppId: true } as const;
  const picked = new Map<string, number>();
  const add = (rows: { id: string; steamAppId: number | null }[]) => {
    for (const r of rows) if (r.steamAppId !== null && picked.size < limit) picked.set(r.id, r.steamAppId);
  };
  add(
    await prisma.game.findMany({
      where: { ...base, detailsRequestedAt: { not: null } },
      orderBy: { detailsRequestedAt: "asc" },
      take: limit,
      select,
    }),
  );
  // Never attempted first, so a game that keeps failing does not hold the queue.
  const order = [{ lastSyncAttemptAt: { sort: "asc", nulls: "first" } }, { popularity: "desc" }, { steamAppId: "asc" }] satisfies Prisma.GameOrderByWithRelationInput[];
  if (picked.size < limit) {
    add(
      await prisma.game.findMany({
        where: { ...base, id: { notIn: [...picked.keys()] }, OR: [{ users: { some: {} } }, { wishlistedBy: { some: {} } }] },
        orderBy: order,
        take: limit - picked.size,
        select,
      }),
    );
  }
  if (picked.size < limit) {
    add(
      await prisma.game.findMany({
        where: { ...base, id: { notIn: [...picked.keys()] } },
        orderBy: order,
        take: limit - picked.size,
        select,
      }),
    );
  }
  return [...picked].map(([id, steamAppId]) => ({ id, steamAppId }));
}

/** True when the CDN serves the file (library art is missing for many apps). */
async function exists(politeFetch: PoliteFetch, url: string): Promise<boolean> {
  try {
    const res = await politeFetch(url, { method: "HEAD" });
    await res.body?.cancel().catch(() => undefined);
    return res.ok;
  } catch {
    return false;
  }
}

const IGDB_COVER_URL = "https://images.igdb.com/igdb/image/upload/t_cover_big";

/**
 * Fetches and writes one game's store details. Returns false when the store does not know the
 * app (removed, region-locked): it is marked as done and stays a stub.
 */
export async function syncSteamDetails(appId: number, deps: SteamCatalogDeps): Promise<boolean> {
  const { politeFetch } = deps;
  if (!politeFetch) throw new Error("Steam details need network access");
  const now = new Date(deps.now());
  const store = await fetchStoreApp(politeFetch, appId);
  if (!store) {
    await prisma.game.updateMany({
      where: { steamAppId: appId },
      data: { detailsSyncedAt: now, detailsRequestedAt: null, lastSyncAttemptAt: now },
    });
    return false;
  }
  const best = async <T>(what: string, call: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      console.warn(`Steam details: ${what} failed for app ${appId}`, error);
      return fallback;
    }
  };
  const [schema, percentages, tags] = await Promise.all([
    store.achievementCount > 0 ? best("achievement schema", () => deps.steam.getSchemaForGame(appId), []) : [],
    store.achievementCount > 0 ? best("rarity", () => deps.steam.getGlobalAchievementPercentages(appId), {}) : {},
    best("SteamSpy tags", () => fetchTags(politeFetch, appId), {} as Record<string, number>),
  ]);

  const media: CatalogMedia[] = [];
  const library = libraryAssetUrls(appId);
  for (const kind of ["cover", "hero", "logo"] as const) {
    const asset = library[kind];
    if (await exists(politeFetch, asset.url)) media.push({ kind, order: 0, ...asset });
  }
  if (store.headerUrl) media.push({ kind: "artwork", order: 0, url: store.headerUrl, width: 460, height: 215 });
  store.screenshots.forEach((s, order) => media.push({ kind: "screenshot", order, ...s }));
  let videoOrder = 0;
  for (const trailer of store.trailers) {
    if (videoOrder >= MAX_TRAILERS) break;
    if (await exists(politeFetch, trailer.url)) media.push({ kind: "video", order: videoOrder++, url: trailer.url });
  }

  const { game } = await writeCatalogGame({
    appId,
    store,
    schema,
    percentages,
    skills: mapTagsToSkills(tags),
    media,
    now,
  });

  // No portrait cover on Steam's CDN: SteamGridDB, then IGDB (only https URLs).
  if (!game.coverUrl && !media.some((m) => m.kind === "cover")) {
    const sgdb = await best("SteamGridDB", () => deps.sgdb.getArt(appId), {});
    let cover = sgdb.coverUrl?.startsWith("https://") ? sgdb.coverUrl : undefined;
    if (!cover) {
      const igdb = await best("IGDB", () => deps.igdb.findBySteamAppId(appId), null);
      cover = igdb?.coverImageId ? `${IGDB_COVER_URL}/${igdb.coverImageId}.jpg` : undefined;
    }
    const heroUrl = !game.heroUrl && sgdb.heroUrl?.startsWith("https://") ? sgdb.heroUrl : undefined;
    if (cover || heroUrl) {
      await prisma.game.update({
        where: { id: game.id },
        data: { ...(cover && { coverUrl: cover }), ...(heroUrl && { heroUrl }) },
      });
    }
  }
  return true;
}

export type DetailsResult = { processed: number; failed: number; skipped?: "offline" };

/** Step 3: fills in details of the most needed games until `deadline`. */
export async function syncCatalogDetails(
  deadline: number,
  deps: SteamCatalogDeps = defaultDeps(),
  limit = DETAILS_BATCH,
): Promise<DetailsResult> {
  if (!deps.politeFetch) return { processed: 0, failed: 0, skipped: "offline" };
  let processed = 0;
  let failed = 0;
  for (const { id, steamAppId } of await detailsCandidates(limit)) {
    if (deps.now() >= deadline) break;
    try {
      await syncSteamDetails(steamAppId, deps);
      processed++;
    } catch (error) {
      failed++;
      console.error(`Steam details: could not sync app ${steamAppId}`, error);
      // Back of the queue (a request is not retried forever at the top).
      await prisma.game.update({
        where: { id },
        data: { lastSyncAttemptAt: new Date(deps.now()), detailsRequestedAt: null },
      });
    }
  }
  return { processed, failed };
}

export type SteamCatalogResult = {
  processed: number;
  failed: number;
  appList: AppListResult;
  popularity: number;
  details: DetailsResult;
};

/**
 * Cron job `steam-catalog`: app list (≤ 40% of the budget), one popularity page, then details
 * until the budget ends. Each step is resumable, so work left over continues next run.
 */
export async function runSteamCatalogJob(
  budgetMs = STEAM_CATALOG_BUDGET_MS,
  deps: SteamCatalogDeps = defaultDeps(),
): Promise<SteamCatalogResult> {
  const start = deps.now();
  const deadline = start + budgetMs;
  let failed = 0;
  let appList: AppListResult = { status: "ok", pages: 0, apps: 0, passDone: false };
  try {
    appList = await importSteamAppList(start + budgetMs * APP_LIST_SHARE, deps);
  } catch (error) {
    failed++;
    console.error("Steam catalog: app list import failed", error);
  }
  let popularity = 0;
  if (deps.politeFetch && deps.now() < deadline) {
    try {
      popularity = await refreshPopularity(deps.politeFetch);
    } catch (error) {
      failed++;
      console.error("Steam catalog: popularity refresh failed", error);
    }
  }
  const details = await syncCatalogDetails(deadline, deps);
  return {
    processed: appList.apps + details.processed,
    failed: failed + details.failed,
    appList,
    popularity,
    details,
  };
}

/** A player opened the page of a game without details: the details job takes it first. */
export async function requestGameDetails(gameId: string, now: Date = new Date()): Promise<void> {
  await prisma.game.updateMany({
    where: { id: gameId, steamAppId: { not: null }, detailsSyncedAt: null, detailsRequestedAt: null },
    data: { detailsRequestedAt: now },
  });
}

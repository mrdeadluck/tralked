import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getIgdbCatalog } from "@/lib/integrations/igdb";
import type { IgdbCatalogApi, IgdbDatePrecision, IgdbReleaseDate } from "@/lib/integrations/igdb/catalog-types";
import { steamFixturesAllowed } from "@/lib/integrations/steam";
import { createPoliteFetch } from "@/lib/integrations/steam/polite-fetch";
import { fetchReleaseList, type SteamReleaseItem, type SteamReleaseList } from "@/lib/integrations/steam/releases";
import { fixtureReleaseList } from "@/lib/integrations/steam/releases-fixture";
import {
  IGDB_EXTRA_PLATFORMS,
  IGDB_PLATFORM_FAMILY,
  IGDB_PLATFORM_IDS,
  type ReleasePlatform,
} from "@/lib/releases/platforms";
import { resolveIgdbGames } from "./igdb-games";
import { repairLibraryArt, type LibraryArtResult } from "./library-art";
import { ensureSteamGames } from "./steam-games";

/**
 * Cron job `releases` (Plano 4, F10), every 6 hours, 50 s in all:
 * 1. Steam (PC, no key): the store's popular new releases and popular upcoming games, two pages
 *    of 50 each (lib/integrations/steam/releases.ts). Unknown appids become catalog stubs
 *    (ensureSteamGames) and the most popular ones without details go first in the details queue,
 *    so the card soon has covers.
 * 2. IGDB (needs IGDB_CLIENT_ID/SECRET; in production without them this part is off): release
 *    dates on PlayStation, Xbox and Nintendo (PC is Steam's), per family, the last 30 days and the
 *    next 120, matched to the catalog without duplicates (lib/sync/igdb-games.ts).
 * One GameRelease row per game and platform family; Steam's row wins for PC. Pages never call
 * these sources: they read GameRelease.
 */

export const RELEASES_BUDGET_MS = 50_000;
const DAY_MS = 86_400_000;
const STEAM_PAGES = 2;
const STEAM_PAGE_SIZE = 50;
/** "Popular new" also lists old games with a recent update: those are not releases. */
const STEAM_NEW_MAX_AGE_DAYS = 60;
/** Release games without details asked first in the details queue, per run. */
const DETAILS_REQUESTS = 40;
const IGDB_PAST_DAYS = 30;
const IGDB_AHEAD_DAYS = 120;
const IGDB_PAGE = 500;
/** Per family and window: 3 families × 2 windows × 2 pages = at most 12 requests (3 s at 4/s). */
const IGDB_PAGES_PER_WINDOW = 2;
/** IGDB is read for the consoles only: Steam's lists cover PC (and win there anyway). */
const IGDB_RELEASE_FAMILIES = ["PLAYSTATION", "XBOX", "NINTENDO"] as const satisfies readonly ReleasePlatform[];

export type ReleasesDeps = {
  /** A page of a Steam list. */
  steamList: (list: SteamReleaseList, start: number, count: number) => Promise<SteamReleaseItem[]>;
  /** Null when IGDB is off (production without credentials). */
  igdb: IgdbCatalogApi | null;
  now: () => number;
  /** Repairs the portrait and hero of the newest games (lib/sync/library-art); absent offline. */
  libraryArt?: (deadline: number) => Promise<LibraryArtResult>;
};

function defaultDeps(): ReleasesDeps {
  const offline = process.env.STEAM_MODE?.trim() === "fixture" && steamFixturesAllowed();
  const politeFetch = offline ? null : createPoliteFetch({ hostIntervalsMs: { "store.steampowered.com": 1_500 } });
  return {
    steamList: async (list, start, count) =>
      politeFetch ? fetchReleaseList(politeFetch, list, start, count) : start === 0 ? fixtureReleaseList(list) : [],
    igdb: getIgdbCatalog(),
    now: Date.now,
    ...(politeFetch && {
      libraryArt: (deadline: number) => repairLibraryArt(politeFetch, { limit: 300, deadline }),
    }),
  };
}

type ReleaseRow = {
  gameId: string;
  platform: ReleasePlatform;
  date: Date | null;
  dateLabel: string | null;
  source: "steam" | "igdb";
  score: number;
  imageUrl: string | null;
};

/** Inserts or refreshes releases; an IGDB row never replaces a Steam one. */
export async function upsertReleases(rows: ReleaseRow[], now: Date): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const values = Prisma.join(
      rows.slice(i, i + 500).map(
        (r) =>
          Prisma.sql`(${r.gameId}, ${r.platform}, ${r.date}::timestamp, ${r.dateLabel}, ${r.source}, ${r.score}::int, ${r.imageUrl}, ${now}::timestamp, ${now}::timestamp)`,
      ),
    );
    written += await prisma.$executeRaw`
      INSERT INTO "GameRelease" ("gameId", platform, date, "dateLabel", source, score, "imageUrl", "seenAt", "updatedAt")
      VALUES ${values}
      ON CONFLICT ("gameId", platform) DO UPDATE SET
        date = EXCLUDED.date,
        "dateLabel" = EXCLUDED."dateLabel",
        source = EXCLUDED.source,
        score = EXCLUDED.score,
        "imageUrl" = COALESCE(EXCLUDED."imageUrl", "GameRelease"."imageUrl"),
        "seenAt" = EXCLUDED."seenAt",
        "updatedAt" = EXCLUDED."updatedAt"
      WHERE "GameRelease".source = EXCLUDED.source OR EXCLUDED.source = 'steam'`;
  }
  return written;
}

export type SteamReleasesResult = { items: number; written: number; failed: number };

/** Step 1: Steam's popular new and upcoming lists (PC). */
export async function syncSteamReleases(deps: ReleasesDeps, deadline: number): Promise<SteamReleasesResult> {
  const now = new Date(deps.now());
  const items = new Map<number, SteamReleaseItem & { score: number }>();
  let failed = 0;
  for (const list of ["popularnew", "popularcomingsoon"] as const) {
    for (let page = 0; page < STEAM_PAGES && deps.now() < deadline; page++) {
      let rows: SteamReleaseItem[];
      try {
        rows = await deps.steamList(list, page * STEAM_PAGE_SIZE, STEAM_PAGE_SIZE);
      } catch (error) {
        failed++;
        console.error(`Releases: Steam list ${list} page ${page} failed`, error);
        break;
      }
      for (const item of rows) {
        if (list === "popularnew" && item.date && now.getTime() - item.date.getTime() > STEAM_NEW_MAX_AGE_DAYS * DAY_MS) continue;
        // Upcoming games without a day only count while Steam still lists them as upcoming.
        if (!items.has(item.appId)) items.set(item.appId, { ...item, score: Math.max(1, 1_000 - item.position) });
      }
      if (rows.length < STEAM_PAGE_SIZE) break;
    }
  }
  if (items.size === 0) return { items: 0, written: 0, failed };

  const ids = await ensureSteamGames([...items.values()].map((i) => ({ appId: i.appId, name: i.name })), { now });
  const rows: ReleaseRow[] = [];
  for (const item of items.values()) {
    const gameId = ids.get(item.appId);
    if (!gameId) continue;
    rows.push({
      gameId,
      platform: "PC",
      date: item.date ?? null,
      dateLabel: item.date ? null : (item.dateLabel ?? null),
      source: "steam",
      score: item.score,
      imageUrl: item.imageUrl ?? null,
    });
  }
  const written = await upsertReleases(rows, now);

  // The most popular release games still without store details go first in the details queue.
  const top = [...items.values()].sort((a, b) => b.score - a.score).map((i) => ids.get(i.appId)).filter(Boolean) as string[];
  const waiting = await prisma.game.findMany({
    where: { id: { in: top }, detailsSyncedAt: null, detailsRequestedAt: null },
    select: { id: true },
  });
  const waitingIds = new Set(waiting.map((w) => w.id));
  const ask = top.filter((id) => waitingIds.has(id)).slice(0, DETAILS_REQUESTS);
  if (ask.length > 0) {
    await prisma.game.updateMany({ where: { id: { in: ask }, detailsRequestedAt: null }, data: { detailsRequestedAt: now } });
  }
  return { items: items.size, written, failed };
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** pt-BR text of an IGDB date that is not a day ("novembro de 2026", "4º trimestre de 2026", "2027"). */
export function igdbDateLabel(date: number | undefined, precision: IgdbDatePrecision): string | null {
  if (date === undefined || precision === "tbd" || precision === "day") return null;
  const d = new Date(date * 1000);
  const year = d.getUTCFullYear();
  if (precision === "month") return `${MONTHS[d.getUTCMonth()]} de ${year}`;
  if (precision === "year") return String(year);
  return `${precision.slice(1)}º trimestre de ${year}`;
}

/** Day (UTC midnight) of an exact IGDB date. */
const dayOf = (unixSeconds: number) => {
  const d = new Date(unixSeconds * 1000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

export type IgdbReleasesResult = { status: "ok" | "disabled"; releases: number; written: number; created: number; failed: number };

/**
 * Step 2: IGDB release dates of the consoles (Steam already covers PC), around today. Each
 * family (PlayStation, Xbox, Nintendo) is read on its own, in two windows: the past 30 days
 * walking back from today (most recent first) and the next 120 days walking forward, so neither
 * the past nor one busy family eats the pages of the others. Only games people follow or rated
 * (IGDB hypes or ratings), which also keeps the eShop/PS Store shovelware out. All regions of a
 * game on a family collapse into one release (its earliest exact day).
 */
export async function syncIgdbReleases(deps: ReleasesDeps, deadline: number): Promise<IgdbReleasesResult> {
  const igdb = deps.igdb;
  if (!igdb) return { status: "disabled", releases: 0, written: 0, created: 0, failed: 0 };
  const now = new Date(deps.now());
  let failed = 0;

  const extraFamilies: Record<number, ReleasePlatform> = {};
  try {
    const extraIds = await igdb.findPlatformIds(IGDB_EXTRA_PLATFORMS.map((p) => p.name));
    // One name per family today, so every id found belongs to that family.
    for (const id of extraIds) extraFamilies[id] = IGDB_EXTRA_PLATFORMS[0].family;
  } catch (error) {
    console.warn("Releases: IGDB platform lookup failed", error);
  }
  const familyOf = (platform: number) => IGDB_PLATFORM_FAMILY[platform] ?? extraFamilies[platform];
  const allIds = [...IGDB_PLATFORM_IDS, ...Object.keys(extraFamilies).map(Number)];

  const today = Math.floor(deps.now() / DAY_MS) * DAY_MS;
  const windows = [
    { order: "desc" as const, from: (today - IGDB_PAST_DAYS * DAY_MS) / 1000, to: (today + DAY_MS) / 1000 },
    { order: "asc" as const, from: (today + DAY_MS) / 1000, to: (today + IGDB_AHEAD_DAYS * DAY_MS) / 1000 },
  ];
  const releases: IgdbReleaseDate[] = [];
  for (const family of IGDB_RELEASE_FAMILIES) {
    const platforms = allIds.filter((id) => familyOf(id) === family);
    for (const window of windows) {
      for (let page = 0; page < IGDB_PAGES_PER_WINDOW && deps.now() < deadline; page++) {
        try {
          const rows = await igdb.getReleaseDates({ platforms, ...window, popularOnly: true, offset: page * IGDB_PAGE, limit: IGDB_PAGE });
          releases.push(...rows);
          if (rows.length < IGDB_PAGE) break;
        } catch (error) {
          failed++;
          console.error(`Releases: IGDB release dates (${family}, ${window.order}) page ${page} failed`, error);
          break;
        }
      }
    }
  }

  // One release per game and family: the earliest exact day, else the earliest vague date.
  const best = new Map<string, { igdbId: number; family: ReleasePlatform; date: Date | null; label: string | null; at: number; score: number }>();
  for (const r of releases) {
    const family = familyOf(r.platform);
    if (!family || family === "PC" || r.date === undefined || r.precision === "tbd") continue;
    const exact = r.precision === "day";
    const candidate = {
      igdbId: r.game.igdbId,
      family,
      date: exact ? dayOf(r.date) : null,
      label: exact ? null : igdbDateLabel(r.date, r.precision),
      at: r.date,
      score: r.game.popularity,
    };
    const key = `${r.game.igdbId}:${family}`;
    const current = best.get(key);
    const better =
      !current ||
      (candidate.date && !current.date) ||
      (Boolean(candidate.date) === Boolean(current.date) && candidate.at < current.at);
    if (better) best.set(key, candidate);
  }
  if (best.size === 0) return { status: "ok", releases: 0, written: 0, created: 0, failed };

  // Only games with a release kept above enter the catalog.
  const kept = new Set([...best.values()].map((b) => b.igdbId));
  const resolved = await resolveIgdbGames(
    releases.map((r) => r.game).filter((g) => kept.has(g.igdbId)),
    { extraFamilies },
  );
  const rows: ReleaseRow[] = [];
  for (const b of best.values()) {
    const gameId = resolved.ids.get(b.igdbId);
    if (!gameId) continue;
    rows.push({ gameId, platform: b.family, date: b.date, dateLabel: b.label, source: "igdb", score: b.score, imageUrl: null });
  }
  const written = await upsertReleases(rows, now);
  return { status: "ok", releases: best.size, written, created: resolved.created, failed };
}

export type ReleasesJobResult = {
  processed: number;
  failed: number;
  steam: SteamReleasesResult;
  igdb: IgdbReleasesResult;
  art?: LibraryArtResult;
};

export async function runReleasesJob(
  budgetMs = RELEASES_BUDGET_MS,
  deps: ReleasesDeps = defaultDeps(),
): Promise<ReleasesJobResult> {
  const deadline = deps.now() + budgetMs;
  let steam: SteamReleasesResult = { items: 0, written: 0, failed: 0 };
  try {
    steam = await syncSteamReleases(deps, deps.now() + budgetMs / 2);
  } catch (error) {
    steam.failed++;
    console.error("Releases: Steam step failed", error);
  }
  let igdb: IgdbReleasesResult = { status: deps.igdb ? "ok" : "disabled", releases: 0, written: 0, created: 0, failed: 0 };
  try {
    igdb = await syncIgdbReleases(deps, deadline);
  } catch (error) {
    igdb.failed++;
    console.error("Releases: IGDB step failed", error);
  }
  // New releases come with only the store header on record: their real portrait and hero.
  let art: LibraryArtResult | undefined;
  if (deps.libraryArt && deps.now() < deadline) {
    try {
      art = await deps.libraryArt(deadline);
    } catch (error) {
      console.error("Releases: library art step failed", error);
    }
  }
  return { processed: steam.items + igdb.releases, failed: steam.failed + igdb.failed, steam, igdb, ...(art && { art }) };
}

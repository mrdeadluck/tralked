import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { IgdbCatalogGame } from "@/lib/integrations/igdb/catalog-types";
import { familiesOf, RELEASE_PLATFORMS, type ReleasePlatform } from "@/lib/releases/platforms";
import { slugify } from "./catalog";
import { CATALOG_CREATE_LOCK, ensureSteamGames, steamGameIds } from "./steam-games";

/**
 * Finds the catalog game of each IGDB game without ever creating a second row for a game the
 * catalog already has (Plano 4, F10: releases and the console catalog import). In order:
 * 1. a game with the same IGDB id;
 * 2. the Steam game of an appid IGDB links to (a Steam stub is created for an appid the catalog
 *    does not have yet, so the Steam app list import finds it later instead of adding it again);
 * 3. a game with the same name, ignoring case and trademark signs (expression index on
 *    lower(name)), that has no other IGDB id and whose release year is within one year of IGDB's
 *    when both are known, or, when either year is unknown, that shares a platform family with it
 *    (sameGame); two such games make the name ambiguous and the IGDB game is skipped;
 * 4. otherwise, a name-only stub (name, platforms, IGDB id, first release, cover), out of the
 *    listings until the IGDB details step fills it in (lib/sync/igdb-catalog.ts).
 * Matched games get the IGDB id (when they had none), the platform families and the first release
 * date (when they had none). Creation runs under an advisory lock, so two jobs never create the
 * same IGDB game twice.
 */

const CHUNK = 500;
const IGDB_COVER_URL = "https://images.igdb.com/igdb/image/upload/t_cover_big";
const CREATE_LOCK = CATALOG_CREATE_LOCK;

export type IgdbResolveOptions = {
  /** Create stubs for games the catalog does not have (default true). */
  create?: boolean;
  /** Extra IGDB platform ids → family (platforms looked up by name at run time). */
  extraFamilies?: Record<number, ReleasePlatform>;
};

export type IgdbResolveResult = {
  /** IGDB id → game id. */
  ids: Map<number, string>;
  created: number;
  matched: number;
  /** Ambiguous names (or creation off): left alone. */
  skipped: number;
};

/** The name as stored and matched: trademark signs and extra spaces out (case is left to SQL lower()). */
const cleanIgdbName = (name: string) => name.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
const yearOf = (unixSeconds: number | undefined) =>
  unixSeconds === undefined ? null : new Date(unixSeconds * 1000).getUTCFullYear();

type Candidate = {
  id: string;
  name: string;
  igdbId: number | null;
  releaseDate: Date | null;
  /** Game.platforms (catalog families, or a platform sync's labels such as "PS5"). */
  platforms: string[];
  /** Networks the game has ids on (GamePlatformLink: steam | psn | xbox | retro). */
  links: string[];
};

const LINK_FAMILY: Record<string, ReleasePlatform | undefined> = { steam: "PC", psn: "PLAYSTATION", xbox: "XBOX" };

/** Family of a Game.platforms entry: a family key, or a label a platform sync wrote ("PS5", "Xbox One"). */
export function familyOfLabel(label: string): ReleasePlatform | null {
  const value = label.trim().toUpperCase();
  if ((RELEASE_PLATFORMS as readonly string[]).includes(value)) return value as ReleasePlatform;
  if (/^PS\d|PLAYSTATION|^PSP|VITA/.test(value)) return "PLAYSTATION";
  if (/XBOX/.test(value)) return "XBOX";
  if (/SWITCH|NINTENDO|WII|3DS|^DS|GAME ?BOY|GAMECUBE|N64|SNES|^NES|FAMICOM/.test(value)) return "NINTENDO";
  if (/^PC$|WINDOWS|STEAM/.test(value)) return "PC";
  return null;
}

/** Families a catalog game is known on (its platforms and its platform ids). */
export function candidateFamilies(c: Pick<Candidate, "platforms" | "links">): Set<ReleasePlatform> {
  const out = new Set<ReleasePlatform>();
  for (const p of c.platforms) {
    const family = familyOfLabel(p);
    if (family) out.add(family);
  }
  for (const l of c.links) {
    const family = LINK_FAMILY[l];
    if (family) out.add(family);
  }
  return out;
}

/**
 * Catalog games named like each input name, keyed by the input name as given. Both sides are
 * lowercased by Postgres' own lower() (the expression index), so accented names ("É") match the
 * same way the index does.
 */
async function candidatesByName(
  names: string[],
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Map<string, Candidate[]>> {
  const out = new Map<string, Candidate[]>();
  if (names.length === 0) return out;
  const rows = await db.$queryRaw<(Candidate & { input: string })[]>`
    WITH q AS (SELECT DISTINCT n AS input, lower(n) AS key FROM unnest(${names}::text[]) AS n)
    SELECT q.input, g.id, g.name, g."igdbId", g."releaseDate", g.platforms,
           COALESCE((SELECT array_agg(DISTINCT l.platform) FROM "GamePlatformLink" l WHERE l."gameId" = g.id), '{}') AS links
    FROM q JOIN "Game" g ON lower(g.name) = q.key`;
  for (const row of rows) out.set(row.input, [...(out.get(row.input) ?? []), row]);
  return out;
}

/** The one catalog game an IGDB game is, by name (see sameGame); "ambiguous" when several could be. */
function pickByName(
  candidates: Candidate[] | undefined,
  g: IgdbCatalogGame,
  families: ReleasePlatform[],
): Candidate | "ambiguous" | null {
  const year = yearOf(g.firstReleaseDate);
  const fits = (candidates ?? []).filter((c) => sameGame(c, { igdbId: g.igdbId, year, families }));
  if (fits.length === 1) return fits[0];
  const sameYear = fits.filter((c) => c.releaseDate !== null && year !== null && c.releaseDate.getUTCFullYear() === year);
  if (sameYear.length === 1) return sameYear[0];
  return fits.length > 1 ? "ambiguous" : null;
}

/**
 * Whether a catalog game of the same name is this IGDB game: never one with another IGDB id;
 * with both release years known, within one year; with either unknown (Steam stubs have none),
 * only when they share a platform family (God of War on PS2 is not the Steam God of War).
 */
export function sameGame(
  candidate: Candidate,
  igdb: { igdbId: number; year: number | null; families: ReleasePlatform[] },
): boolean {
  if (candidate.igdbId !== null && candidate.igdbId !== igdb.igdbId) return false;
  if (candidate.igdbId === igdb.igdbId) return true;
  if (igdb.year !== null && candidate.releaseDate !== null) {
    return Math.abs(candidate.releaseDate.getUTCFullYear() - igdb.year) <= 1;
  }
  const families = candidateFamilies(candidate);
  return igdb.families.some((f) => families.has(f));
}

/** Writes IGDB id (if missing), platform families and first release (if missing) on matched games. */
async function enrich(rows: { id: string; igdbId: number; families: string[]; releaseDate: Date | null }[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const values = Prisma.join(
      part.map((r) => Prisma.sql`(${r.id}, ${r.igdbId}::int, ${r.families}::text[], ${r.releaseDate}::timestamp)`),
    );
    await prisma.$executeRaw`
      UPDATE "Game" AS g SET
        "igdbId" = COALESCE(g."igdbId", v.igdb),
        platforms = ARRAY(SELECT DISTINCT p FROM unnest(g.platforms || v.fams) AS p ORDER BY p),
        "releaseDate" = COALESCE(g."releaseDate", v.rd)
      FROM (VALUES ${values}) AS v(id, igdb, fams, rd)
      WHERE g.id = v.id
        AND (g."igdbId" IS NULL OR NOT (g.platforms @> v.fams) OR (g."releaseDate" IS NULL AND v.rd IS NOT NULL))`;
  }
}

export async function resolveIgdbGames(
  input: IgdbCatalogGame[],
  { create = true, extraFamilies = {} }: IgdbResolveOptions = {},
): Promise<IgdbResolveResult> {
  const games = [...new Map(input.map((g) => [g.igdbId, g])).values()];
  const result: IgdbResolveResult = { ids: new Map(), created: 0, matched: 0, skipped: 0 };
  if (games.length === 0) return result;
  const families = (g: IgdbCatalogGame) => familiesOf(g.platforms, extraFamilies);
  const releaseOf = (g: IgdbCatalogGame) =>
    g.firstReleaseDate !== undefined ? new Date(g.firstReleaseDate * 1000) : null;
  const matched: { id: string; game: IgdbCatalogGame }[] = [];

  // 1. Same IGDB id (listed games first when several carry it).
  const known = await prisma.game.findMany({
    where: { igdbId: { in: games.map((g) => g.igdbId) } },
    select: { id: true, igdbId: true, stub: true },
    orderBy: [{ stub: "asc" }, { createdAt: "asc" }],
  });
  for (const row of known) if (row.igdbId !== null && !result.ids.has(row.igdbId)) result.ids.set(row.igdbId, row.id);
  for (const g of games) {
    const id = result.ids.get(g.igdbId);
    if (id) matched.push({ id, game: g });
  }

  // 2. Steam appid.
  let pending = games.filter((g) => !result.ids.has(g.igdbId));
  const withSteam = pending.filter((g) => g.steamAppIds.length > 0);
  if (withSteam.length > 0) {
    const bySteam = await steamGameIds(withSteam.flatMap((g) => g.steamAppIds));
    const missing = withSteam.filter((g) => !g.steamAppIds.some((a) => bySteam.has(a)));
    if (create && missing.length > 0) {
      const createdIds = await ensureSteamGames(missing.map((g) => ({ appId: g.steamAppIds[0], name: g.name })));
      for (const [appId, id] of createdIds) bySteam.set(appId, id);
    }
    for (const g of withSteam) {
      const appId = g.steamAppIds.find((a) => bySteam.has(a));
      if (appId === undefined) continue;
      const id = bySteam.get(appId)!;
      result.ids.set(g.igdbId, id);
      matched.push({ id, game: g });
    }
  }

  // 3. Same name.
  pending = games.filter((g) => !result.ids.has(g.igdbId));
  const byName = await candidatesByName([...new Set(pending.map((g) => cleanIgdbName(g.name)).filter(Boolean))]);
  const unknown: IgdbCatalogGame[] = [];
  for (const g of pending) {
    const pick = pickByName(byName.get(cleanIgdbName(g.name)), g, families(g));
    if (pick && pick !== "ambiguous") {
      result.ids.set(g.igdbId, pick.id);
      matched.push({ id: pick.id, game: g });
    } else if (pick === "ambiguous") {
      // Two catalog games could be this one: never guess.
      result.skipped++;
    } else {
      // No game of that name, or only ones with another IGDB id or year (a remake, a namesake).
      unknown.push(g);
    }
  }

  result.matched = matched.length;
  await enrich(matched.map(({ id, game }) => ({ id, igdbId: game.igdbId, families: families(game), releaseDate: releaseOf(game) })));

  if (!create) {
    result.skipped += unknown.length;
    return result;
  }

  // 4. Stubs, created under a lock (another job may be creating the same IGDB games).
  for (let i = 0; i < unknown.length; i += CHUNK) {
    const part = unknown.slice(i, i + CHUNK);
    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CREATE_LOCK}::bigint)`;
      const raced = await tx.game.findMany({
        where: { igdbId: { in: part.map((g) => g.igdbId) } },
        select: { id: true, igdbId: true },
      });
      const already = new Map(raced.map((r) => [r.igdbId!, r.id]));
      // Re-checked by name too: a game of that name may have been created since the check above
      // (a Steam app, another job's stub). One that is this game is used; an ambiguous name waits.
      const byNameNow = await candidatesByName(
        [...new Set(part.filter((g) => !already.has(g.igdbId)).map((g) => cleanIgdbName(g.name)))],
        tx,
      );
      const matchedNow = new Map<number, string>();
      const fresh = part.filter((g) => {
        if (already.has(g.igdbId)) return false;
        const pick = pickByName(byNameNow.get(cleanIgdbName(g.name)), g, families(g));
        if (pick && pick !== "ambiguous") matchedNow.set(g.igdbId, pick.id);
        return pick === null;
      });
      const bases = fresh.map((g) => ({ g, base: slugify(g.name.replace(/['’]/g, "")) || `igdb-${g.igdbId}` }));
      const taken = new Set(
        (await tx.game.findMany({ where: { slug: { in: bases.map((b) => b.base) } }, select: { slug: true } })).map((r) => r.slug),
      );
      const data = bases.map(({ g, base }) => {
        const slug = taken.has(base) ? `${base}-${g.igdbId}` : base;
        taken.add(slug);
        return {
          slug,
          name: cleanIgdbName(g.name),
          igdbId: g.igdbId,
          platforms: families(g),
          releaseDate: releaseOf(g),
          coverUrl: g.coverImageId && /^[a-z0-9]+$/i.test(g.coverImageId) ? `${IGDB_COVER_URL}/${g.coverImageId}.jpg` : null,
          achievementCount: 0,
          stub: true,
        };
      });
      // `<slug>-<igdbId>` can only clash with a game created meanwhile under that very slug.
      await tx.game.createMany({ data, skipDuplicates: true });
      const rows = await tx.game.findMany({
        where: { igdbId: { in: part.map((g) => g.igdbId) } },
        select: { id: true, igdbId: true },
      });
      return { rows, count: data.length, matchedNow };
    }, { timeout: 60_000, maxWait: 20_000 });
    for (const row of created.rows) if (row.igdbId !== null && !result.ids.has(row.igdbId)) result.ids.set(row.igdbId, row.id);
    for (const [igdbId, id] of created.matchedNow) {
      if (result.ids.has(igdbId)) continue;
      result.ids.set(igdbId, id);
      result.matched++;
      const game = part.find((g) => g.igdbId === igdbId)!;
      await enrich([{ id, igdbId, families: families(game), releaseDate: releaseOf(game) }]);
    }
    result.created += created.count;
  }
  result.skipped += unknown.filter((g) => !result.ids.has(g.igdbId)).length;
  return result;
}

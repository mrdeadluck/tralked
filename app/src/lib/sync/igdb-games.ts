import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { IgdbCatalogGame } from "@/lib/integrations/igdb/catalog-types";
import { familiesOf, type ReleasePlatform } from "@/lib/releases/platforms";
import { slugify } from "./catalog";
import { ensureSteamGames, steamGameIds } from "./steam-games";

/**
 * Finds the catalog game of each IGDB game without ever creating a second row for a game the
 * catalog already has (Plano 4, F10: releases and the console catalog import). In order:
 * 1. a game with the same IGDB id;
 * 2. the Steam game of an appid IGDB links to (a Steam stub is created for an appid the catalog
 *    does not have yet, so the Steam app list import finds it later instead of adding it again);
 * 3. a game with the same name, ignoring case and trademark signs (expression index on
 *    lower(name)), that has no other IGDB id and whose release year is within one year of IGDB's
 *    when both are known; two such games make the name ambiguous and the IGDB game is skipped;
 * 4. otherwise, a name-only stub (name, platforms, IGDB id, first release, cover), out of the
 *    listings until the IGDB details step fills it in (lib/sync/igdb-catalog.ts).
 * Matched games get the IGDB id (when they had none), the platform families and the first release
 * date (when they had none). Creation runs under an advisory lock, so two jobs never create the
 * same IGDB game twice.
 */

const CHUNK = 500;
const IGDB_COVER_URL = "https://images.igdb.com/igdb/image/upload/t_cover_big";
const CREATE_LOCK = 0x16db_ca7a; // pg_advisory_xact_lock key of IGDB game creation

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

const lowerName = (name: string) => name.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const yearOf = (unixSeconds: number | undefined) =>
  unixSeconds === undefined ? null : new Date(unixSeconds * 1000).getUTCFullYear();

type Candidate = { id: string; name: string; igdbId: number | null; releaseDate: Date | null };

async function candidatesByName(names: string[]): Promise<Map<string, Candidate[]>> {
  const out = new Map<string, Candidate[]>();
  if (names.length === 0) return out;
  const rows = await prisma.$queryRaw<(Candidate & { key: string })[]>`
    SELECT id, name, "igdbId", "releaseDate", lower(name) AS key
    FROM "Game" WHERE lower(name) = ANY(${names}::text[])`;
  for (const row of rows) out.set(row.key, [...(out.get(row.key) ?? []), row]);
  return out;
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
  const byName = await candidatesByName([...new Set(pending.map((g) => lowerName(g.name)).filter(Boolean))]);
  const unknown: IgdbCatalogGame[] = [];
  for (const g of pending) {
    const year = yearOf(g.firstReleaseDate);
    const fits = (byName.get(lowerName(g.name)) ?? []).filter(
      (c) =>
        (c.igdbId === null || c.igdbId === g.igdbId) &&
        (year === null || c.releaseDate === null || Math.abs(c.releaseDate.getUTCFullYear() - year) <= 1),
    );
    const sameYear = fits.filter((c) => c.releaseDate !== null && year !== null && c.releaseDate.getUTCFullYear() === year);
    const pick = fits.length === 1 ? fits[0] : sameYear.length === 1 ? sameYear[0] : null;
    if (pick) {
      result.ids.set(g.igdbId, pick.id);
      matched.push({ id: pick.id, game: g });
    } else if (fits.length > 1) {
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
      const fresh = part.filter((g) => !already.has(g.igdbId));
      const bases = fresh.map((g) => ({ g, base: slugify(g.name.replace(/['’]/g, "")) || `igdb-${g.igdbId}` }));
      const taken = new Set(
        (await tx.game.findMany({ where: { slug: { in: bases.map((b) => b.base) } }, select: { slug: true } })).map((r) => r.slug),
      );
      const data = bases.map(({ g, base }) => {
        const slug = taken.has(base) ? `${base}-${g.igdbId}` : base;
        taken.add(slug);
        return {
          slug,
          name: g.name.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim(),
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
      return { rows, count: data.length };
    }, { timeout: 60_000, maxWait: 20_000 });
    for (const row of created.rows) if (row.igdbId !== null && !result.ids.has(row.igdbId)) result.ids.set(row.igdbId, row.id);
    result.created += created.count;
  }
  result.skipped += unknown.filter((g) => !result.ids.has(g.igdbId)).length;
  return result;
}

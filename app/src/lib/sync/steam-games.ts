import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { slugTaken, takenSlugs } from "@/lib/catalog/slug-taken";
import { cleanName } from "@/lib/integrations/steam/store";
import { slugify } from "./catalog";

/** Rows per query: keeps every statement well under Postgres' bind-parameter limit. */
const CHUNK = 1_000;

/** Name of a game Steam knows only by its appid (the details job replaces it). */
export const placeholderSteamName = (appId: number) => `Jogo ${appId} da Steam`;

/** URL slug of a Steam app name ("Tom Clancy's" → "tom-clancys", like the seed's "baldurs-gate-3"). */
export const steamSlugBase = (name: string, appId: number) =>
  slugify(cleanName(name).replace(/['’]/g, "")) || `app-${appId}`;

/**
 * Names given before the 2026-11 catalog work: the old `syncGame` named an app IGDB did not know
 * `Steam App <appid>` (slug `steam-app-<appid>`), as a listed game. Treated as a placeholder too.
 */
export const LEGACY_PLACEHOLDER = /^Steam App \d+$/;

/**
 * A name still the placeholder of an app known only by its appid: `Jogo <appid> da Steam`, or the
 * legacy `Steam App <n>`. Such a game is never listed (stub) until it has its real name.
 */
export const isPlaceholderName = (name: string, appId: number | null) =>
  LEGACY_PLACEHOLDER.test(name) || (appId !== null && name === placeholderSteamName(appId));

/** A slug given from a placeholder name (`jogo-<appid>-da-steam…` or the legacy `steam-app-<n>…`). */
export const isPlaceholderSlug = (slug: string, appId: number) =>
  slug.startsWith(steamSlugBase(placeholderSteamName(appId), appId)) || /^steam-app-\d+(?:-\d+)?$/.test(slug);

/**
 * The slug a game with a placeholder slug (`jogo-<appid>-da-steam` or the legacy `steam-app-<n>`,
 * given while Steam knew it only by appid) takes once its real name is known: the real name's slug,
 * or `<slug>-<appid>` when taken (by a game or a redirect: slugTaken). Safe to change: a placeholder name is never a real game title,
 * and pages link to games by their current slug; an old bookmark of the placeholder URL gets a 404.
 * Games with a real slug keep it (`{}`), so a published URL never changes.
 */
export async function slugAfterPlaceholder(
  tx: Prisma.TransactionClient,
  game: { id: string; slug: string },
  realName: string,
  appId: number,
): Promise<{ slug?: string }> {
  if (!isPlaceholderSlug(game.slug, appId)) return {};
  if (isPlaceholderName(realName, appId)) return {};
  const base = steamSlugBase(realName, appId);
  for (const slug of [base, `${base}-${appId}`]) {
    if (!(await slugTaken(slug, tx, game.id))) return { slug };
  }
  return {};
}

export type PlaceholderGame = {
  id: string;
  slug: string;
  name: string;
  steamAppId: number;
  stub: boolean;
  detailsSyncedAt: Date | null;
};

/** Steam games still named with a placeholder (either form), optionally only these appids. */
export async function placeholderGames(appIds?: number[]): Promise<PlaceholderGame[]> {
  if (appIds && appIds.length === 0) return [];
  const only = appIds ? Prisma.sql`AND "steamAppId" = ANY(${appIds}::int[])` : Prisma.empty;
  return prisma.$queryRaw<PlaceholderGame[]>`
    SELECT id, slug, name, "steamAppId", stub, "detailsSyncedAt" FROM "Game"
    WHERE "steamAppId" IS NOT NULL
      AND (name ~ '^Steam App [0-9]+$' OR name = 'Jogo ' || "steamAppId" || ' da Steam')
      ${only}
    ORDER BY "steamAppId"`;
}

/**
 * Gives a placeholder-named game its real name: name, slug (slugAfterPlaceholder, collision-safe)
 * and, while it has no store details yet, a place at the front of the details queue so its cover
 * and art arrive. Its `stub` flag is left as is (a stub becomes listed only with its details).
 * Re-checked under a row lock: a game renamed meanwhile is left alone (returns null), so running
 * twice changes nothing. A placeholder or empty `realName` is refused.
 */
export async function renamePlaceholderGame(
  gameId: string,
  realName: string,
  now: Date = new Date(),
): Promise<{ name: string; slug: string } | null> {
  const name = cleanName(realName);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<PlaceholderGame[]>`
      SELECT id, slug, name, "steamAppId", stub, "detailsSyncedAt" FROM "Game" WHERE id = ${gameId} FOR UPDATE`;
    const game = rows[0];
    if (!game || game.steamAppId === null || !isPlaceholderName(game.name, game.steamAppId)) return null;
    if (!name || isPlaceholderName(name, game.steamAppId)) return null;
    const { slug } = await slugAfterPlaceholder(tx, game, name, game.steamAppId);
    const updated = await tx.game.update({
      where: { id: game.id },
      data: {
        name,
        ...(slug && { slug }),
        ...(game.detailsSyncedAt === null && { detailsRequestedAt: now }),
      },
      select: { name: true, slug: true },
    });
    return updated;
  });
}

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** appid → game id of the Steam games already in the catalog. */
export async function steamGameIds(appIds: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  for (const part of chunks([...new Set(appIds)])) {
    const rows = await prisma.game.findMany({
      where: { steamAppId: { in: part } },
      select: { id: true, steamAppId: true },
    });
    for (const r of rows) if (r.steamAppId !== null) result.set(r.steamAppId, r.id);
  }
  return result;
}

/**
 * pg_advisory_xact_lock key taken by whatever creates or adopts name-only catalog rows that are
 * matched by name (IGDB stubs in lib/sync/igdb-games.ts, and their adoption below).
 */
export const CATALOG_CREATE_LOCK = 0x16db_ca7a;

/**
 * Steam apps that are an IGDB game of the console catalog (Plano 4, F10): a game with an IGDB id,
 * no appid and PC among its platforms, whose name is the app's name (Postgres lower() on both
 * sides, like the index). Only when that game is the ONLY catalog game of that name and the app the
 * only one of the batch with it: "Chess" or "Solitaire" with namesakes is never adopted. The game
 * (stub or already listed by the IGDB details step) takes the appid and leaves `detailsSyncedAt`
 * empty, so the Steam details job fills in its store page, instead of a second row being created.
 * Returns appid → game id of the adopted games.
 */
async function adoptIgdbStubs(tx: Prisma.TransactionClient, apps: [number, string][]): Promise<Map<number, string>> {
  const adopted = new Map<number, string>();
  const part = apps.filter(([appId, name]) => !isPlaceholderName(name, appId));
  if (part.length === 0) return adopted;
  const pairs = await tx.$queryRaw<{ appId: number; id: string }[]>`
    WITH apps AS (
      SELECT a AS app_id, lower(n) AS key
      FROM unnest(${part.map(([appId]) => appId)}::int[], ${part.map(([, name]) => name)}::text[]) AS t(a, n)
    ),
    lone_apps AS (SELECT key, min(app_id) AS app_id FROM apps GROUP BY key HAVING count(*) = 1),
    named AS (
      SELECT lower(g.name) AS key, count(*) AS games, min(g.id) AS id,
             bool_and(g."steamAppId" IS NULL AND g."igdbId" IS NOT NULL AND 'PC' = ANY(g.platforms)) AS adoptable
      FROM "Game" g JOIN lone_apps a ON lower(g.name) = a.key
      GROUP BY lower(g.name)
    )
    SELECT a.app_id AS "appId", n.id FROM lone_apps a JOIN named n ON n.key = a.key
    WHERE n.games = 1 AND n.adoptable`;
  for (const { appId, id } of pairs) {
    const updated = await tx.$executeRaw`
      UPDATE "Game" SET "steamAppId" = ${appId}::int, "detailsSyncedAt" = NULL, "updatedAt" = now()
      WHERE id = ${id} AND "steamAppId" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "Game" WHERE "steamAppId" = ${appId}::int)`;
    if (updated === 1) adopted.set(appId, id);
  }
  return adopted;
}

export type EnsureOptions = {
  /** New games are queued first for the details job (someone needs them now). */
  requestDetails?: boolean;
  now?: Date;
};

/**
 * Makes sure every app is in the catalog and returns appid → game id. An app that is a game of the
 * IGDB console catalog (adoptIgdbStubs) gives that game its appid. Other apps not there yet become
 * name-only stubs (`stub` true: unlisted until the details job fills them in) with a unique slug:
 * the name's slug, or `<slug>-<appid>` when another game (or another app of the batch) has it or
 * it is an old URL of a joined game (a redirect: takenSlugs).
 * Idempotent and safe to run concurrently: existing games are never touched, and an app created
 * meanwhile by someone else is simply found.
 */
export async function ensureSteamGames(
  apps: { appId: number; name?: string | null }[],
  { requestDetails = false, now = new Date() }: EnsureOptions = {},
): Promise<Map<number, string>> {
  const unique = new Map<number, string>();
  for (const a of apps) {
    if (!Number.isInteger(a.appId) || a.appId <= 0) continue;
    const name = cleanName(a.name ?? "") || unique.get(a.appId) || placeholderSteamName(a.appId);
    unique.set(a.appId, name);
  }
  const ids = await steamGameIds([...unique.keys()]);
  const missing = [...unique].filter(([appId]) => !ids.has(appId));

  for (const chunk of chunks(missing)) {
    const rowsFor = async (db: Prisma.TransactionClient | typeof prisma, part: [number, string][]) => {
      const bases = part.map(([appId, name]) => ({ appId, name, base: steamSlugBase(name, appId) }));
      const taken = await takenSlugs(bases.map((b) => b.base), db);
      return bases.map(({ appId, name, base }) => {
        const slug = taken.has(base) ? `${base}-${appId}` : base;
        taken.add(slug);
        return {
          slug,
          name,
          steamAppId: appId,
          platforms: ["PC"],
          achievementCount: 0,
          stub: true,
          ...(requestDetails && { detailsRequestedAt: now }),
        };
      });
    };
    // Under the catalog lock (Plano 4, F10): an IGDB game that is this app takes its appid, and
    // the rest are created before the lock is released, so an IGDB import running at the same
    // time (it re-checks names under the same lock) finds them instead of adding the game again.
    let adopted = new Map<number, string>();
    let data: Awaited<ReturnType<typeof rowsFor>>;
    try {
      ({ adopted, data } = await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CATALOG_CREATE_LOCK}::bigint)`;
          const taken = await adoptIgdbStubs(tx, chunk);
          const rows = await rowsFor(tx, chunk.filter(([appId]) => !taken.has(appId)));
          await tx.game.createMany({ data: rows, skipDuplicates: true });
          return { adopted: taken, data: rows };
        },
        { timeout: 60_000, maxWait: 20_000 },
      ));
    } catch (error) {
      // An appid adopted elsewhere meanwhile: no adoption for this chunk, plain creation.
      if (!isUniqueViolation(error)) throw error;
      adopted = new Map();
      data = await rowsFor(prisma, chunk);
      await prisma.game.createMany({ data, skipDuplicates: true });
    }
    for (const [appId, id] of adopted) ids.set(appId, id);
    const part = chunk.filter(([appId]) => !adopted.has(appId));

    // Skipped rows: the app was created meanwhile (fine), or its slug was (retried with the appid).
    const created = await steamGameIds(part.map(([appId]) => appId));
    for (const row of data) {
      const id = created.get(row.steamAppId);
      if (id) {
        ids.set(row.steamAppId, id);
        continue;
      }
      const retrySlug = `${steamSlugBase(row.name, row.steamAppId)}-${row.steamAppId}`;
      if (await prisma.gameSlugRedirect.findUnique({ where: { fromSlug: retrySlug }, select: { fromSlug: true } })) {
        console.warn(`Catalog: could not create Steam app ${row.steamAppId} (slug taken by a redirect)`);
        continue;
      }
      try {
        const game = await prisma.game.create({
          data: { ...row, slug: retrySlug },
          select: { id: true },
        });
        ids.set(row.steamAppId, game.id);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const raced = await steamGameIds([row.steamAppId]);
        const racedId = raced.get(row.steamAppId);
        if (racedId) ids.set(row.steamAppId, racedId);
        else console.warn(`Catalog: could not create Steam app ${row.steamAppId} (slug taken)`);
      }
    }
  }
  return ids;
}

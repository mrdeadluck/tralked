import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { cleanName } from "@/lib/integrations/steam/store";
import { slugify } from "./catalog";

/** Rows per query: keeps every statement well under Postgres' bind-parameter limit. */
const CHUNK = 1_000;

/** Name of a game Steam knows only by its appid (the details job replaces it). */
export const placeholderSteamName = (appId: number) => `Jogo ${appId} da Steam`;

/** URL slug of a Steam app name ("Tom Clancy's" → "tom-clancys", like the seed's "baldurs-gate-3"). */
export const steamSlugBase = (name: string, appId: number) =>
  slugify(cleanName(name).replace(/['’]/g, "")) || `app-${appId}`;

/** A name still the placeholder of an app known only by its appid. */
export const isPlaceholderName = (name: string, appId: number | null) =>
  appId !== null && name === placeholderSteamName(appId);

/**
 * The slug a game with a placeholder slug (`jogo-<appid>-da-steam`, given while Steam knew it only
 * by appid) takes once its real name is known: the real name's slug, or `<slug>-<appid>` when
 * taken. Safe to change: a placeholder game is a stub, never listed, prerendered or in the sitemap,
 * and pages link to it by its current slug; an old bookmark of the placeholder URL gets a 404.
 * Games with a real slug keep it (`{}`), so a published URL never changes.
 */
export async function slugAfterPlaceholder(
  tx: Prisma.TransactionClient,
  game: { id: string; slug: string },
  realName: string,
  appId: number,
): Promise<{ slug?: string }> {
  if (!game.slug.startsWith(steamSlugBase(placeholderSteamName(appId), appId))) return {};
  if (isPlaceholderName(realName, appId)) return {};
  const base = steamSlugBase(realName, appId);
  for (const slug of [base, `${base}-${appId}`]) {
    const taken = await tx.game.findUnique({ where: { slug }, select: { id: true } });
    if (!taken || taken.id === game.id) return { slug };
  }
  return {};
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

export type EnsureOptions = {
  /** New games are queued first for the details job (someone needs them now). */
  requestDetails?: boolean;
  now?: Date;
};

/**
 * Makes sure every app is in the catalog and returns appid → game id. Apps not there yet become
 * name-only stubs (`stub` true: unlisted until the details job fills them in) with a unique slug:
 * the name's slug, or `<slug>-<appid>` when another game (or another app of the batch) has it.
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

  for (const part of chunks(missing)) {
    const bases = part.map(([appId, name]) => ({ appId, name, base: steamSlugBase(name, appId) }));
    const taken = new Set(
      (
        await prisma.game.findMany({
          where: { slug: { in: [...new Set(bases.map((b) => b.base))] } },
          select: { slug: true },
        })
      ).map((g) => g.slug),
    );
    const data = bases.map(({ appId, name, base }) => {
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
    await prisma.game.createMany({ data, skipDuplicates: true });

    // Skipped rows: the app was created meanwhile (fine), or its slug was (retried with the appid).
    const created = await steamGameIds(part.map(([appId]) => appId));
    for (const row of data) {
      const id = created.get(row.steamAppId);
      if (id) {
        ids.set(row.steamAppId, id);
        continue;
      }
      try {
        const game = await prisma.game.create({
          data: { ...row, slug: `${steamSlugBase(row.name, row.steamAppId)}-${row.steamAppId}` },
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

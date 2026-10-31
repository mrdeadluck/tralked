import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { describeGameRef, type GameRef } from "@/lib/content/guide-schema";
import { toPointer, type ApiIssue } from "./errors";

export type ResolvedGame = { id: string; slug: string; name: string };

const gameSelect = { id: true, slug: true, name: true } as const;

/** Finds a game by slug, Steam appid or IGDB id. */
export function findGame(ref: GameRef): Promise<ResolvedGame | null> {
  if (ref.slug !== undefined) return prisma.game.findUnique({ where: { slug: ref.slug }, select: gameSelect });
  if (ref.steamAppId !== undefined) {
    return prisma.game.findUnique({ where: { steamAppId: ref.steamAppId }, select: gameSelect });
  }
  return prisma.game.findFirst({ where: { igdbId: ref.igdbId }, orderBy: { slug: "asc" }, select: gameSelect });
}

/** Resolves every ref; unknown games become issues at `basePath` (+ index for lists). */
export async function resolveGames(
  refs: GameRef[],
  basePath: (string | number)[],
): Promise<{ games: ResolvedGame[]; issues: ApiIssue[] }> {
  const found = await Promise.all(refs.map(findGame));
  const issues: ApiIssue[] = [];
  const games: ResolvedGame[] = [];
  found.forEach((game, i) => {
    if (!game) {
      issues.push({
        path: toPointer([...basePath, i]),
        message: `Jogo não encontrado (${describeGameRef(refs[i])}). Procure o jogo em GET /api/v1/games?q=…`,
      });
    } else if (!games.some((g) => g.id === game.id)) {
      games.push(game);
    }
  });
  return { games, issues };
}

export type GameSearchHit = {
  id: string;
  slug: string;
  name: string;
  steamAppId: number | null;
  igdbId: number | null;
  aliases: string[];
  /** The game's guide, if any (one guide per game). */
  guide: { id: string; status: string; source: string | null } | null;
};

const SEARCH_LIMIT = 20;

/**
 * Catalog search for bots: exact `slug`, `steamAppId` or `igdbId`, or `q` (part of the name, or
 * an alias). A malformed parameter is reported with its name (`?steamAppId`).
 */
export async function searchGames(
  params: URLSearchParams,
): Promise<{ ok: true; games: GameSearchHit[] } | { ok: false; param: string; message: string }> {
  const select = {
    id: true,
    slug: true,
    name: true,
    steamAppId: true,
    igdbId: true,
    aliases: true,
    guide: { select: { id: true, status: true, source: true } },
  } as const;

  for (const name of ["steamAppId", "igdbId"] as const) {
    const raw = params.get(name);
    if (raw === null) continue;
    if (!/^\d{1,10}$/.test(raw)) return { ok: false, param: `?${name}`, message: `${name} deve ser um número inteiro` };
    const games = await prisma.game.findMany({ where: { [name]: Number(raw) }, select, take: SEARCH_LIMIT });
    return { ok: true, games };
  }

  const slug = params.get("slug");
  if (slug !== null) {
    const game = await prisma.game.findUnique({ where: { slug: slug.trim() }, select });
    return { ok: true, games: game ? [game] : [] };
  }

  const q = params.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 100) {
    return { ok: false, param: "?q", message: "Envie q (2 a 100 caracteres), slug, steamAppId ou igdbId" };
  }
  const games = await prisma.game.findMany({
    where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { aliases: { has: q } }, { slug: q }] },
    orderBy: { name: "asc" },
    select,
    take: SEARCH_LIMIT,
  });
  return { ok: true, games };
}

const base = () => env.APP_URL.replace(/\/+$/, "");
export const articleUrl = (slug: string) => `${base()}/noticias/${slug}`;
export const guideUrl = (gameSlug: string) => `${base()}/jogos/${gameSlug}/guia`;

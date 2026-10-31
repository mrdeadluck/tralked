import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getIgdb, mapToSkills } from "@/lib/integrations";
import { normalizePlatformTitle, normalizeTitle } from "@/lib/integrations/title-match";
import { slugify } from "./catalog";

const IGDB_COVER_URL = "https://images.igdb.com/igdb/image/upload/t_cover_big";

/** Normalized name or alias -> game id; names shared by two games are ambiguous (null). */
export type NameIndex = Map<string, string | null>;

/**
 * Name index of the listed catalog. Name-only stubs of the full Steam catalog (~150k) stay out:
 * they are matched one by one by exact name (findStubByName), so a sync never loads them all.
 */
export async function loadNameIndex(): Promise<NameIndex> {
  const games = await prisma.game.findMany({ where: { stub: false }, select: { id: true, name: true, aliases: true } });
  const index: NameIndex = new Map();
  for (const game of games) {
    for (const name of new Set([game.name, ...game.aliases].map(normalizeTitle))) {
      if (!name) continue;
      index.set(name, index.has(name) && index.get(name) !== game.id ? null : game.id);
    }
  }
  return index;
}

/** The one stub whose name is exactly `name` (ignoring case), or null (none, or ambiguous). */
async function findStubByName(name: string): Promise<string | null> {
  const trimmed = name.replace(/[™®©]/g, "").trim();
  if (!trimmed) return null;
  const rows = await prisma.game.findMany({
    where: { stub: true, name: { equals: trimmed, mode: "insensitive" } },
    select: { id: true },
    take: 2,
  });
  return rows.length === 1 ? rows[0].id : null;
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

async function linkPlatform(gameId: string, platform: string, externalId: string) {
  await prisma.gamePlatformLink.createMany({
    data: [{ gameId, platform, externalId }],
    skipDuplicates: true,
  });
}

export type ResolveOptions = {
  /** Ask IGDB for unknown titles (default true). Play-time-only titles skip it: no budget for it. */
  igdb?: boolean;
};

/**
 * Finds the catalog game of a platform title, in order: the platform link (PSN
 * npCommunicationId or store title id, Xbox titleId, RA game id), the normalized name or an alias
 * of a listed game, the exact name of a stub of the full Steam catalog, then IGDB by exact name
 * (matched to the catalog by igdbId). A title nobody knows yet becomes a new game, with IGDB
 * metadata and skills when IGDB knows it. The link is stored so the next sync is a single lookup.
 * `names` is updated in place with created games.
 */
export async function resolvePlatformGame(
  platform: string,
  title: { externalId: string; name: string; platformLabel: string },
  names: NameIndex,
  { igdb: useIgdb = true }: ResolveOptions = {},
): Promise<string> {
  const link = await prisma.gamePlatformLink.findUnique({
    where: { platform_externalId: { platform, externalId: title.externalId } },
    select: { gameId: true },
  });
  if (link) return link.gameId;

  const normalized = normalizePlatformTitle(title.name);
  const byName = names.get(normalized) ?? names.get(normalizeTitle(title.name));
  if (byName) {
    await linkPlatform(byName, platform, title.externalId);
    return byName;
  }
  const stub = await findStubByName(title.name);
  if (stub) {
    await linkPlatform(stub, platform, title.externalId);
    names.set(normalized, stub);
    return stub;
  }

  let igdb = null;
  if (useIgdb) {
    try {
      igdb = await getIgdb().findByName(title.name);
    } catch (error) {
      // Best effort: without IGDB the game is still created, just without metadata.
      console.warn(`Platform sync: IGDB lookup failed for a ${platform} title`, error);
    }
  }
  if (igdb) {
    const known = await prisma.game.findFirst({ where: { igdbId: igdb.igdbId }, select: { id: true } });
    if (known) {
      await linkPlatform(known.id, platform, title.externalId);
      return known.id;
    }
  }

  const name = igdb?.name ?? title.name;
  const skills = igdb ? mapToSkills(igdb) : [];
  const create = async (slug: string) =>
    prisma.game.create({
      data: {
        slug,
        name,
        igdbId: igdb?.igdbId,
        summary: igdb?.summary,
        releaseDate: igdb?.releaseDate,
        criticScore:
          igdb?.aggregatedRating !== undefined ? Math.round(igdb.aggregatedRating) : undefined,
        coverUrl: igdb?.coverImageId ? `${IGDB_COVER_URL}/${igdb.coverImageId}.jpg` : undefined,
        timeToBeatCompleteMin:
          igdb?.timeToBeatCompleteSec !== undefined
            ? Math.round(igdb.timeToBeatCompleteSec / 60)
            : undefined,
        platforms: [title.platformLabel],
        // Steam achievement count; this game's achievements are counted per platform.
        achievementCount: 0,
        skills: { create: skills.map((skill) => ({ skill })) },
        platformLinks: { create: [{ platform, externalId: title.externalId }] },
      },
      select: { id: true },
    });

  const base = slugify(name) || `${platform}-${slugify(title.externalId)}`;
  let game;
  try {
    game = await create(base);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Slug taken by another game, or a concurrent sync linked this title first.
    const raced = await prisma.gamePlatformLink.findUnique({
      where: { platform_externalId: { platform, externalId: title.externalId } },
      select: { gameId: true },
    });
    if (raced) return raced.gameId;
    game = await create(`${base}-${platform}-${slugify(title.externalId)}`);
  }
  names.set(normalized, game.id);
  return game.id;
}

import { Prisma } from "@/generated/prisma/client";
import { gamesByIgdbIds } from "@/lib/catalog/igdb-aliases";
import { slugTaken } from "@/lib/catalog/slug-taken";
import { prisma } from "@/lib/db";
import { getIgdb, mapToSkills } from "@/lib/integrations";
import { consoleOfLabel, familyOfLabel } from "@/lib/releases/platforms";
import { normalizePlatformTitle, normalizeTitle, withoutEdition } from "@/lib/integrations/title-match";
import { regionOf } from "@/lib/trophies/lists";
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

/**
 * The one stub named `name`, or null (none, or ambiguous): first the exact name ignoring case
 * (`lower(name) = lower($1)`, served by the expression index `Game_name_lower_idx`, migration
 * 20261102090000_releases_calendar), then the same name folded like the catalog search
 * (`searchName = tralked_search_name($1)`, served by the trigram index): apostrophes, accents and
 * punctuation aside, so `Marvel’s Wolverine` finds `Marvel's Wolverine` and `Ghost of Yotei` finds
 * `Ghost of Yōtei`. Never a scan of the ~150k stubs.
 */
export async function findStubByName(name: string): Promise<string | null> {
  const trimmed = name.replace(/[™®©]/g, "").trim();
  if (!trimmed) return null;
  const exact = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Game" WHERE stub AND lower(name) = lower(${trimmed}) LIMIT 2`;
  if (exact.length > 0) return exact.length === 1 ? exact[0].id : null;
  const folded = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Game" WHERE "searchName" = tralked_search_name(${trimmed}) AND stub LIMIT 2`;
  return folded.length === 1 ? folded[0].id : null;
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

async function linkPlatform(gameId: string, platform: string, externalId: string) {
  await prisma.gamePlatformLink.createMany({
    data: [{ gameId, platform, externalId }],
    skipDuplicates: true,
  });
}

/**
 * What a new game of a platform title records as Game.platforms and Game.consoles: PSN and Xbox
 * labels ("PS5") become the family ("PLAYSTATION") plus the console slug ("ps5"); a label naming no
 * console ("Xbox") gives the family only. Retro labels ("Mega Drive") stay as written.
 */
function platformsOfLabel(platform: string, label: string): { platforms: string[]; consoles: string[] } {
  if (platform !== "psn" && platform !== "xbox") return { platforms: [label], consoles: [] };
  // A PSN list may span consoles ("PS4,PS5"): every one of them is recorded.
  const parts = label.split(/[,+]/).map((part) => part.trim()).filter(Boolean);
  const family = parts.map(familyOfLabel).find(Boolean) ?? null;
  if (!family) return { platforms: [label], consoles: [] };
  const consoles = [...new Set(parts.map(consoleOfLabel).filter((c): c is string => c !== null))];
  return { platforms: [family], consoles };
}

export type ResolveOptions = {
  /** Ask IGDB for unknown titles (default true). Play-time-only titles skip it: no budget for it. */
  igdb?: boolean;
  /** PSN concept of the title (played-games list), when known: groups a game's regional lists. */
  conceptId?: number | null;
  /**
   * Platform ids of the concept: its store title ids, and the trophy lists known to be of it. A
   * link of any of them says which game the concept is.
   */
  conceptTitleIds?: readonly string[];
  /**
   * A name of the concept without Japanese or Korean script. A title whose own name has that script
   * is first looked for (and, when new, named) by it.
   */
  conceptName?: string | null;
};

/**
 * A catalog game known by this name: the normalized name or an alias of a listed game, the name of
 * a stub (findStubByName), or the same without a store edition. `remember`: found outside the name
 * index (the index learns it).
 */
async function knownByName(names: NameIndex, name: string): Promise<{ id: string; remember: boolean } | null> {
  const byName = names.get(normalizePlatformTitle(name)) ?? names.get(normalizeTitle(name));
  if (byName) return { id: byName, remember: false };
  const stub = await findStubByName(name);
  if (stub) return { id: stub, remember: true };
  // A store edition of a known game (`… Digital Deluxe Edition`) is that game.
  const editionOf = withoutEdition(name);
  if (editionOf) {
    const known = names.get(normalizePlatformTitle(editionOf)) ?? names.get(normalizeTitle(editionOf)) ?? (await findStubByName(editionOf));
    if (known) return { id: known, remember: true };
  }
  return null;
}

/**
 * The game a PSN concept is already on: the game of its oldest trophy list stored with that
 * concept, else the game most of the concept's linked ids point to (tie: the first id linked).
 */
async function conceptGame(platform: string, conceptId: number | null | undefined, ids: readonly string[]): Promise<string | null> {
  if (conceptId != null) {
    const list = await prisma.trophyList.findFirst({
      where: { platform, conceptId },
      orderBy: [{ createdAt: "asc" }, { externalId: "asc" }],
      select: { gameId: true },
    });
    if (list) return list.gameId;
  }
  if (ids.length === 0) return null;
  const links = await prisma.gamePlatformLink.findMany({
    where: { platform, externalId: { in: [...ids] } },
    select: { gameId: true, externalId: true },
  });
  const votes = new Map<string, { count: number; first: number }>();
  for (const link of links) {
    const at = ids.indexOf(link.externalId);
    const vote = votes.get(link.gameId) ?? { count: 0, first: at };
    votes.set(link.gameId, { count: vote.count + 1, first: Math.min(vote.first, at) });
  }
  const [best] = [...votes].sort(([, a], [, b]) => b.count - a.count || a.first - b.first);
  return best?.[0] ?? null;
}

/**
 * Finds the catalog game of a platform title, in order: the platform link (PSN
 * npCommunicationId or store title id, Xbox titleId, RA game id), the PSN concept when given (a
 * trophy list stored with it, or a link of one of its ids: see conceptGame), the normalized name or an alias
 * of a listed game, the name of a stub of the full Steam catalog (findStubByName), the same without
 * a store edition (`… Deluxe Edition`), then IGDB by exact name (matched to the catalog by igdbId). A title nobody knows yet becomes a new game, with IGDB
 * metadata and skills when IGDB knows it. A title named in Japanese or Korean script whose concept
 * has a name without it goes through those name steps (and IGDB, and naming a new game) by the
 * concept's name first. The link is stored so the next sync is a single lookup.
 * `names` is updated in place with created games.
 */
export async function resolvePlatformGame(
  platform: string,
  title: { externalId: string; name: string; platformLabel: string },
  names: NameIndex,
  { igdb: useIgdb = true, conceptId, conceptTitleIds = [], conceptName }: ResolveOptions = {},
): Promise<string> {
  const link = await prisma.gamePlatformLink.findUnique({
    where: { platform_externalId: { platform, externalId: title.externalId } },
    select: { gameId: true },
  });
  if (link) return link.gameId;

  // Another region or console of a game the catalog already has (its name may be in Japanese).
  const ofConcept = await conceptGame(platform, conceptId, conceptTitleIds.filter((id) => id !== title.externalId));
  if (ofConcept) {
    await linkPlatform(ofConcept, platform, title.externalId);
    return ofConcept;
  }

  const normalized = normalizePlatformTitle(title.name);
  // A Japanese-named version of a concept with a name in Latin script is looked for by that name
  // first (the catalog holds the game under it), then by its own.
  const lookupName = regionOf(title.name) !== null && conceptName && regionOf(conceptName) === null ? conceptName : title.name;
  for (const name of new Set([lookupName, title.name])) {
    const known = await knownByName(names, name);
    if (!known) continue;
    await linkPlatform(known.id, platform, title.externalId);
    if (known.remember) names.set(normalized, known.id);
    return known.id;
  }

  let igdb = null;
  if (useIgdb) {
    try {
      igdb = await getIgdb().findByName(lookupName);
    } catch (error) {
      // Best effort: without IGDB the game is still created, just without metadata.
      console.warn(`Platform sync: IGDB lookup failed for a ${platform} title`, error);
    }
  }
  if (igdb) {
    // By IGDB id or alias (the id of a duplicate joined into a game is never created again).
    const known = (await gamesByIgdbIds([igdb.igdbId])).get(igdb.igdbId);
    if (known) {
      await linkPlatform(known, platform, title.externalId);
      return known;
    }
  }

  const name = igdb?.name ?? lookupName;
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
        timeToBeatHastyMin: igdb?.timeToBeatHastySec !== undefined ? Math.round(igdb.timeToBeatHastySec / 60) : undefined,
        timeToBeatNormalMin: igdb?.timeToBeatNormalSec !== undefined ? Math.round(igdb.timeToBeatNormalSec / 60) : undefined,
        ...platformsOfLabel(platform, title.platformLabel),
        // Steam achievement count; this game's achievements are counted per platform.
        achievementCount: 0,
        skills: { create: skills.map((skill) => ({ skill })) },
        platformLinks: { create: [{ platform, externalId: title.externalId }] },
      },
      select: { id: true },
    });

  const base = slugify(name) || `${platform}-${slugify(title.externalId)}`;
  const fallback = `${base}-${platform}-${slugify(title.externalId)}`;
  let game;
  try {
    // A game's slug or an old URL of a joined game (a redirect) is taken.
    game = await create((await slugTaken(base)) ? fallback : base);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Slug taken by another game, or a concurrent sync linked this title first.
    const raced = await prisma.gamePlatformLink.findUnique({
      where: { platform_externalId: { platform, externalId: title.externalId } },
      select: { gameId: true },
    });
    if (raced) return raced.gameId;
    game = await create(fallback);
  }
  names.set(normalized, game.id);
  if (lookupName !== title.name) names.set(normalizePlatformTitle(lookupName), game.id);
  return game.id;
}

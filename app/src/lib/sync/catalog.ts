import { Prisma, type Game } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getIgdb, getRawg, getSgdb, getSteam, mapToSkills } from "@/lib/integrations";
import { IgdbRateLimitError } from "@/lib/integrations/igdb/client";

const IGDB_COVER_URL = "https://images.igdb.com/igdb/image/upload/t_cover_big";
const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

/**
 * Best-effort metadata sources (IGDB, RAWG, SteamGridDB): a failure only leaves fields empty.
 * Except an IGDB rate limit: skills come from IGDB, so the whole game sync fails and is retried
 * later instead of creating the game without skills.
 */
async function bestEffort<T>(source: string, appId: number, call: () => Promise<T>, fallback: T) {
  try {
    return await call();
  } catch (error) {
    if (error instanceof IgdbRateLimitError) throw error;
    console.warn(`Catalog: ${source} failed for Steam app ${appId}`, error);
    return fallback;
  }
}

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * Creates or refreshes a game of the catalog from Steam (achievements + global rarity) and
 * IGDB/RAWG/SteamGridDB (skills, art, score, time to beat). Returns null, without touching
 * the catalog, when the game has no achievements.
 *
 * Skills come from the IGDB genre mapping only while the game has none, so a manual override
 * (admin) is never overwritten by a refresh.
 */
export async function syncGame(appId: number): Promise<Game | null> {
  const steam = getSteam();
  const schema = await steam.getSchemaForGame(appId);
  if (schema.length === 0) return null;

  const [percentages, igdb, sgdbArt, existing] = await Promise.all([
    bestEffort("Steam rarity", appId, () => steam.getGlobalAchievementPercentages(appId), {}),
    bestEffort("IGDB", appId, () => getIgdb().findBySteamAppId(appId), null),
    bestEffort("SteamGridDB", appId, () => getSgdb().getArt(appId), {}),
    prisma.game.findUnique({ where: { steamAppId: appId }, select: { name: true } }),
  ]);
  const name = igdb?.name ?? existing?.name ?? `Steam App ${appId}`;
  const rawg = await bestEffort("RAWG", appId, () => getRawg().findBySteamAppId(appId, name), null);

  const metadata = {
    name,
    summary: igdb?.summary,
    releaseDate: igdb?.releaseDate,
    criticScore:
      igdb?.aggregatedRating !== undefined
        ? Math.round(igdb.aggregatedRating)
        : rawg?.metacritic,
    coverUrl:
      sgdbArt.coverUrl ??
      (igdb?.coverImageId ? `${IGDB_COVER_URL}/${igdb.coverImageId}.jpg` : undefined),
    heroUrl: sgdbArt.heroUrl,
    logoUrl: sgdbArt.logoUrl,
    igdbId: igdb?.igdbId,
    rawgId: rawg?.rawgId,
    timeToBeatCompleteMin:
      igdb?.timeToBeatCompleteSec !== undefined
        ? Math.round(igdb.timeToBeatCompleteSec / 60)
        : undefined,
    achievementCount: schema.length,
  };
  const skills = igdb ? mapToSkills(igdb) : [];

  const write = () =>
    prisma.$transaction(async (tx) => {
      const current = await tx.game.findUnique({
        where: { steamAppId: appId },
        include: { skills: true },
      });
      let game: Game;
      if (current) {
        game = await tx.game.update({ where: { id: current.id }, data: metadata });
      } else {
        const base = slugify(name) || `app-${appId}`;
        const taken = await tx.game.findUnique({ where: { slug: base }, select: { id: true } });
        game = await tx.game.create({
          data: { ...metadata, slug: taken ? `${base}-${appId}` : base, steamAppId: appId, platforms: ["PC"] },
        });
      }

      if ((current?.skills.length ?? 0) === 0 && skills.length > 0) {
        await tx.gameSkill.createMany({
          data: skills.map((skill) => ({ gameId: game.id, skill })),
          skipDuplicates: true,
        });
      }

      const rows = await tx.achievement.findMany({ where: { gameId: game.id } });
      const byApiName = new Map(rows.map((r) => [r.apiName, r]));
      const fields = (a: (typeof schema)[number]) => ({
        name: a.name,
        description: a.description ?? null,
        iconUrl: a.iconUrl ?? null,
        hidden: a.hidden,
        ...(percentages[a.apiName] !== undefined && { globalPct: percentages[a.apiName] }),
      });

      await tx.achievement.createMany({
        data: schema
          .filter((a) => !byApiName.has(a.apiName))
          .map((a) => ({ gameId: game.id, apiName: a.apiName, ...fields(a) })),
        skipDuplicates: true,
      });
      for (const a of schema) {
        const row = byApiName.get(a.apiName);
        if (!row) continue;
        const next = fields(a);
        const changed = (Object.keys(next) as (keyof typeof next)[]).some(
          (key) => next[key] !== row[key],
        );
        if (changed) await tx.achievement.update({ where: { id: row.id }, data: next });
      }
      return game;
    }, TRANSACTION_OPTIONS);

  try {
    return await write();
  } catch (error) {
    // Two users importing the same new game at once: the loser finds it on the retry.
    if (!isUniqueViolation(error)) throw error;
    return write();
  }
}

/**
 * Games whose last refresh attempt is oldest (never attempted first). Ordering by attempt,
 * not success, keeps a game that keeps failing from starving the batch.
 */
async function staleGames(limit: number, where: Prisma.GameWhereInput) {
  const games = await prisma.game.findMany({
    where,
    orderBy: { lastSyncAttemptAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { id: true, steamAppId: true },
  });
  const now = new Date();
  await prisma.game.updateMany({
    where: { id: { in: games.map((g) => g.id) } },
    data: { lastSyncAttemptAt: now },
  });
  return games;
}

/** Weekly job: re-syncs the `limit` stalest games (metadata, achievements, rarity). */
export async function syncCatalog(
  limit = 25,
  where: Prisma.GameWhereInput = {},
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  for (const { steamAppId } of await staleGames(limit, where)) {
    try {
      await syncGame(steamAppId);
      processed++;
    } catch (error) {
      failed++;
      console.error(`Catalog: could not sync Steam app ${steamAppId}`, error);
    }
  }
  return { processed, failed };
}

/**
 * Daily job: refreshes the global unlock percentage of the `limit` stalest games.
 * Only affects achievements recorded from now on: XP already in the ledger is frozen.
 */
export async function refreshRarity(
  limit = 50,
  where: Prisma.GameWhereInput = {},
): Promise<{ processed: number; failed: number }> {
  const steam = getSteam();
  let processed = 0;
  let failed = 0;
  for (const { id, steamAppId } of await staleGames(limit, where)) {
    try {
      const percentages = await steam.getGlobalAchievementPercentages(steamAppId);
      const rows = await prisma.achievement.findMany({
        where: { gameId: id },
        select: { id: true, apiName: true, globalPct: true },
      });
      await prisma.$transaction(
        rows
          .filter((r) => percentages[r.apiName] !== undefined && percentages[r.apiName] !== r.globalPct)
          .map((r) =>
            prisma.achievement.update({
              where: { id: r.id },
              data: { globalPct: percentages[r.apiName] },
            }),
          ),
      );
      processed++;
    } catch (error) {
      failed++;
      console.error(`Rarity: could not refresh Steam app ${steamAppId}`, error);
    }
  }
  return { processed, failed };
}

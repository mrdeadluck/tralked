import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { plainText } from "@/lib/content/schema";
import { assertPublicHost, resolveHost, type ResolveHost } from "@/lib/integrations/rss";
import { prisma } from "@/lib/db";
import { SKILLS, type SkillId } from "@/lib/engine/types";

/**
 * Game overrides from the admin: the skills (genres) a game trains and its aliases (used to match
 * external news and platform titles). Skills drive every player's skill XP for the game, so the
 * owners of the game are recomputed after a change.
 */

/** Genres a game can train ("sabio" comes from guides and the forum, never from a game). */
export const GAME_SKILLS = SKILLS.filter((s) => s.id !== "sabio");
const GAME_SKILL_IDS = GAME_SKILLS.map((s) => s.id) as [SkillId, ...SkillId[]];

export const gameOverrideSchema = z.strictObject({
  gameId: z.string().min(1).max(64),
  skills: z.array(z.enum(GAME_SKILL_IDS)).max(GAME_SKILL_IDS.length),
  aliases: z.array(plainText(120)).max(30, "No máximo 30 nomes alternativos"),
});
export type GameOverride = z.output<typeof gameOverrideSchema>;

/** Owners recomputed right away after a skill change; the cron catches up on the rest. */
export const RECOMPUTE_LIMIT = 500;

export async function updateGameOverrides(
  input: GameOverride,
): Promise<{ ok: true; slug: string; owners: string[]; skillsChanged: boolean } | { ok: false; error: string }> {
  const game = await prisma.game.findUnique({
    where: { id: input.gameId },
    select: { slug: true, skills: { select: { skill: true } } },
  });
  if (!game) return { ok: false, error: "Este jogo não existe mais." };

  const skills = [...new Set(input.skills)].sort();
  const seen = new Set<string>();
  const aliases = input.aliases.filter((alias) => {
    const key = alias.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const before = game.skills.map((s) => s.skill).sort();
  const skillsChanged = before.join() !== skills.join();

  await prisma.$transaction([
    prisma.game.update({ where: { id: input.gameId }, data: { aliases } }),
    ...(skillsChanged
      ? [
          prisma.gameSkill.deleteMany({ where: { gameId: input.gameId } }),
          prisma.gameSkill.createMany({ data: skills.map((skill) => ({ gameId: input.gameId, skill })) }),
        ]
      : []),
  ]);

  const owners = skillsChanged
    ? [
        ...new Set(
          (
            await prisma.userGame.findMany({
              where: { gameId: input.gameId },
              select: { userId: true },
              take: RECOMPUTE_LIMIT,
            })
          ).map((o) => o.userId),
        ),
      ]
    : [];
  return { ok: true, slug: game.slug, owners, skillsChanged };
}

export const GAMES_PER_PAGE = 40;

export type AdminGameRow = {
  id: string;
  slug: string;
  name: string;
  steamAppId: number | null;
  skills: string[];
  aliases: string[];
  media: number;
  news: number;
  lastSyncAttemptAt: Date | null;
};

export async function listAdminGames(q: string | null, requestedPage = 1) {
  const where: Prisma.GameWhereInput = q
    ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q.toLowerCase() } }, { aliases: { has: q } }] }
    : {};
  const total = await prisma.game.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / GAMES_PER_PAGE));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const games = await prisma.game.findMany({
    where,
    orderBy: { name: "asc" },
    skip: (page - 1) * GAMES_PER_PAGE,
    take: GAMES_PER_PAGE,
    select: {
      id: true,
      slug: true,
      name: true,
      steamAppId: true,
      aliases: true,
      lastSyncAttemptAt: true,
      skills: { select: { skill: true } },
      _count: { select: { media: true, externalNews: true } },
    },
  });
  const rows: AdminGameRow[] = games.map((g) => ({
    id: g.id,
    slug: g.slug,
    name: g.name,
    steamAppId: g.steamAppId,
    skills: g.skills.map((s) => s.skill),
    aliases: g.aliases,
    media: g._count.media,
    news: g._count.externalNews,
    lastSyncAttemptAt: g.lastSyncAttemptAt,
  }));
  return { rows, total, page, pageCount };
}

export async function getAdminGame(gameId: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      slug: true,
      name: true,
      steamAppId: true,
      igdbId: true,
      aliases: true,
      skills: { select: { skill: true } },
      _count: { select: { media: true, externalNews: true, users: true } },
    },
  });
  return game ? { ...game, skills: game.skills.map((s) => s.skill) } : null;
}

// ---------- News feeds ----------

const FEED_ID = z.string().min(1).max(64);

export const feedSchema = z.strictObject({
  id: FEED_ID.optional(),
  name: plainText(80),
  url: z
    .url({ protocol: /^https$/, hostname: z.regexes.domain, error: "Use o endereço https:// do feed RSS" })
    .max(2048),
  active: z.boolean(),
});
export type FeedInput = z.output<typeof feedSchema>;
export const feedIdSchema = z.strictObject({ id: FEED_ID });

const isUniqueViolation = (error: unknown) => (error as { code?: unknown })?.code === "P2002";

/**
 * Creates or edits a feed. The host must resolve to public internet addresses only (the fetcher
 * checks again on every read and on every redirect), so a feed can't point at internal services.
 */
export async function saveFeed(
  input: FeedInput,
  resolve: ResolveHost = resolveHost,
): Promise<{ ok: true } | { ok: false; error: string; field?: string }> {
  try {
    await assertPublicHost(new URL(input.url).hostname, resolve);
  } catch {
    return { ok: false, error: "Esse endereço não leva a um site público (rede interna ou domínio inexistente).", field: "url" };
  }
  const data = { name: input.name, url: input.url, active: input.active };
  try {
    if (input.id) {
      const { count } = await prisma.newsFeed.updateMany({ where: { id: input.id }, data });
      if (count === 0) return { ok: false, error: "Este feed não existe mais." };
    } else {
      await prisma.newsFeed.create({ data });
    }
    return { ok: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return { ok: false, error: "Esse feed já está cadastrado.", field: "url" };
  }
}

export async function deleteFeed(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { count } = await prisma.newsFeed.deleteMany({ where: { id } });
  return count === 1 ? { ok: true } : { ok: false, error: "Este feed não existe mais." };
}

export async function listFeeds() {
  return prisma.newsFeed.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
}

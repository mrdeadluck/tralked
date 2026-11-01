import type { Db } from "@/lib/community/limits";
import { playtimeGameId } from "@/lib/engine/playtime";
import { blockedEitherWay } from "./relations";

/**
 * Activity feed of the people a user follows (Plano 4, F9): rare achievements (at most 5% of
 * players), 100% completions, hours milestones (10 h and up), articles they wrote and gallery
 * photos. Game activity and photos only come from public profiles (the same rule as the profile
 * and the gallery); published articles are public anyway. Blocked users (either way) are left out.
 * Per user and dynamic: never cached.
 */

export const FEED_PAGE_SIZE = 20;
/** Deepest page served (older activity stays on each profile). */
export const FEED_MAX_PAGE = 10;
/** Rare achievement threshold (global unlock %), the same as Precisão's. */
export const FEED_RARE_PCT = 5;
/** Smallest hours milestone shown. */
export const FEED_MIN_HOURS = 10;

export type FeedPerson = { handle: string; displayName: string; avatarUrl: string | null };

export type FeedItem =
  | { kind: "rare"; key: string; at: Date; user: FeedPerson; title: string; pct: number; game: { slug: string; name: string } }
  | { kind: "perfect"; key: string; at: Date; user: FeedPerson; game: { slug: string; name: string }; platform: string }
  | { kind: "hours"; key: string; at: Date; user: FeedPerson; hours: number; game: { slug: string; name: string } }
  | { kind: "article"; key: string; at: Date; user: FeedPerson; title: string; slug: string }
  | { kind: "photo"; key: string; at: Date; user: FeedPerson; photoId: string; caption: string | null };

export type FeedPage = { items: FeedItem[]; page: number; hasMore: boolean; following: number };

const person = { select: { handle: true, displayName: true, avatarUrl: true } } as const;

/** One page of the feed of `viewerId` (1-based, at most FEED_MAX_PAGE). */
export async function getFeed(db: Db, viewerId: string, requestedPage = 1, now: Date = new Date()): Promise<FeedPage> {
  const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), FEED_MAX_PAGE);
  const [follows, blocked] = await Promise.all([
    db.follow.findMany({
      where: { followerId: viewerId },
      select: { followeeId: true, followee: { select: { profilePublic: true } } },
    }),
    blockedEitherWay(db, viewerId),
  ]);
  const followed = follows.filter((f) => !blocked.has(f.followeeId));
  const all = followed.map((f) => f.followeeId);
  const open = followed.filter((f) => f.followee.profilePublic).map((f) => f.followeeId);
  if (all.length === 0) return { items: [], page, hasMore: false, following: 0 };

  // Enough of each source to fill pages 1..page once merged (plus one to know there is more).
  const take = page * FEED_PAGE_SIZE + 1;
  const [rare, perfect, hours, articles, photos] = await Promise.all([
    open.length === 0
      ? []
      : db.userAchievement.findMany({
          where: { userId: { in: open }, suspicious: false, achievement: { globalPct: { lte: FEED_RARE_PCT } } },
          orderBy: { unlockedAt: "desc" },
          take,
          select: {
            userId: true,
            achievementId: true,
            unlockedAt: true,
            user: person,
            achievement: { select: { name: true, globalPct: true, game: { select: { slug: true, name: true } } } },
          },
        }),
    open.length === 0
      ? []
      : db.userGame.findMany({
          where: { userId: { in: open }, completedAt: { not: null, lte: now } },
          orderBy: { completedAt: "desc" },
          take,
          select: {
            userId: true,
            platform: true,
            completedAt: true,
            user: person,
            game: { select: { slug: true, name: true } },
          },
        }),
    open.length === 0
      ? []
      : db.xpLedgerEntry.findMany({
          where: { userId: { in: open }, source: "playtime", voidedAt: null },
          orderBy: { createdAt: "desc" },
          // Milestones under FEED_MIN_HOURS are skipped after reading.
          take: take * 3,
          select: { id: true, sourceKey: true, createdAt: true, user: person },
        }),
    db.article.findMany({
      where: { status: "published", publishedAt: { lte: now }, author: { userId: { in: all } } },
      orderBy: { publishedAt: "desc" },
      take,
      select: { id: true, slug: true, title: true, publishedAt: true, author: { select: { user: person } } },
    }),
    open.length === 0
      ? []
      : db.photo.findMany({
          where: { authorId: { in: open }, status: "visible" },
          orderBy: { createdAt: "desc" },
          take,
          select: { id: true, caption: true, createdAt: true, author: person },
        }),
  ]);

  const milestones = hours
    .map((e) => ({ e, hours: Number(e.sourceKey.split(":")[2]), gameId: playtimeGameId(e.sourceKey) }))
    .filter((m) => Number.isFinite(m.hours) && m.hours >= FEED_MIN_HOURS && m.gameId);
  const games = await db.game.findMany({
    where: { id: { in: [...new Set(milestones.map((m) => m.gameId))] } },
    select: { id: true, slug: true, name: true },
  });
  const gameById = new Map(games.map((g) => [g.id, g]));

  const items: FeedItem[] = [
    ...rare.map(
      (r): FeedItem => ({
        kind: "rare",
        key: `rare:${r.userId}:${r.achievementId}`,
        at: r.unlockedAt,
        user: r.user,
        title: r.achievement.name,
        pct: r.achievement.globalPct ?? 0,
        game: r.achievement.game,
      }),
    ),
    ...perfect.map(
      (p): FeedItem => ({
        kind: "perfect",
        key: `perfect:${p.userId}:${p.game.slug}:${p.platform}`,
        at: p.completedAt!,
        user: p.user,
        game: p.game,
        platform: p.platform,
      }),
    ),
    ...milestones.flatMap(({ e, hours: h, gameId }): FeedItem[] => {
      const game = gameById.get(gameId);
      return game ? [{ kind: "hours", key: `hours:${e.id}`, at: e.createdAt, user: e.user, hours: h, game }] : [];
    }),
    ...articles.flatMap((a): FeedItem[] =>
      a.author.user
        ? [{ kind: "article", key: `article:${a.id}`, at: a.publishedAt, user: a.author.user, title: a.title, slug: a.slug }]
        : [],
    ),
    ...photos.flatMap((p): FeedItem[] =>
      p.author ? [{ kind: "photo", key: `photo:${p.id}`, at: p.createdAt, user: p.author, photoId: p.id, caption: p.caption }] : [],
    ),
  ].sort((a, b) => b.at.getTime() - a.at.getTime() || a.key.localeCompare(b.key));

  const start = (page - 1) * FEED_PAGE_SIZE;
  return {
    items: items.slice(start, start + FEED_PAGE_SIZE),
    page,
    hasMore: items.length > start + FEED_PAGE_SIZE && page < FEED_MAX_PAGE,
    following: all.length,
  };
}

import { prisma } from "@/lib/db";
import { toLocalDay } from "@/lib/engine/streak";

// Plain, testable queries. Caching is applied by the calling components ("use cache").

export type ArticleCategory = "GAMES" | "GUIAS" | "COMUNIDADE";
export type ArticlePlatform = "PC" | "PLAYSTATION" | "XBOX" | "NINTENDO";

export type ArticleCard = {
  slug: string;
  title: string;
  subtitle: string | null;
  category: ArticleCategory;
  platforms: ArticlePlatform[];
  imageLabel: string;
  /** Without the leading "@". */
  authorHandle: string;
  /** 0 = list, 1 = side highlight, 2 = main highlight */
  featured: number;
  likes: number;
  comments: number;
  humanAuthored: boolean;
  publishedAt: Date;
  game: { slug: string; name: string } | null;
};

export type ArticleFull = ArticleCard & {
  /** Markdown */
  body: string;
  game: { slug: string; name: string; hasGuide: boolean } | null;
};

export type HomeNews = {
  hero: ArticleCard;
  side: ArticleCard[];
  latest: ArticleCard[];
};

export type TopPlayer = { handle: string; level: number; totalXp: number };

export type TodayMission = {
  title: string;
  progress: number;
  goal: number;
  rewardXp: number;
};

const cardSelect = {
  slug: true,
  title: true,
  subtitle: true,
  category: true,
  platforms: true,
  imageLabel: true,
  featured: true,
  likes: true,
  comments: true,
  humanAuthored: true,
  publishedAt: true,
  author: { select: { handle: true } },
  game: { select: { slug: true, name: true } },
} as const;

type CardRow = {
  slug: string;
  title: string;
  subtitle: string | null;
  category: string;
  platforms: string[];
  imageLabel: string;
  featured: number;
  likes: number;
  comments: number;
  humanAuthored: boolean;
  publishedAt: Date;
  author: { handle: string };
  game: { slug: string; name: string } | null;
};

function toCard(row: CardRow): ArticleCard {
  return {
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    category: row.category as ArticleCategory,
    platforms: row.platforms as ArticlePlatform[],
    imageLabel: row.imageLabel,
    authorHandle: row.author.handle,
    featured: row.featured,
    likes: row.likes,
    comments: row.comments,
    humanAuthored: row.humanAuthored,
    publishedAt: row.publishedAt,
    game: row.game,
  };
}

export async function getHomeNews(): Promise<HomeNews> {
  const [hero, side, latest] = await Promise.all([
    prisma.article.findFirstOrThrow({
      where: { featured: 2 },
      orderBy: { publishedAt: "desc" },
      select: cardSelect,
    }),
    prisma.article.findMany({
      where: { featured: 1 },
      orderBy: { publishedAt: "desc" },
      take: 4,
      select: cardSelect,
    }),
    prisma.article.findMany({
      where: { featured: 0 },
      orderBy: { publishedAt: "desc" },
      select: cardSelect,
    }),
  ]);
  return { hero: toCard(hero), side: side.map(toCard), latest: latest.map(toCard) };
}

export async function getArticle(slug: string): Promise<ArticleFull | null> {
  const row = await prisma.article.findUnique({
    where: { slug },
    select: {
      ...cardSelect,
      body: true,
      game: { select: { slug: true, name: true, guide: { select: { status: true } } } },
    },
  });
  if (!row) return null;
  return {
    ...toCard(row),
    body: row.body,
    game: row.game
      ? {
          slug: row.game.slug,
          name: row.game.name,
          hasGuide: row.game.guide?.status === "published",
        }
      : null,
  };
}

export async function getAllArticleSlugs(): Promise<string[]> {
  const rows = await prisma.article.findMany({ select: { slug: true } });
  return rows.map((r) => r.slug);
}

export async function getTopPlayers(limit: number): Promise<TopPlayer[]> {
  const rows = await prisma.userStats.findMany({
    where: { user: { profilePublic: true } },
    orderBy: { totalXp: "desc" },
    take: limit,
    select: { totalXp: true, level: true, user: { select: { handle: true } } },
  });
  return rows.map((r) => ({ handle: r.user.handle, level: r.level, totalXp: r.totalXp }));
}

/** First daily mission of the user for the local day of `now`. */
export async function getTodayMission(
  userId: string,
  now: Date,
): Promise<TodayMission | null> {
  const mission = await prisma.mission.findFirst({
    where: { userId, kind: "daily", periodKey: toLocalDay(now) },
    orderBy: { id: "asc" },
  });
  if (!mission) return null;
  const condition = mission.condition as { minCount?: number } | null;
  return {
    title: mission.title,
    progress: mission.progress,
    goal: condition?.minCount || 1,
    rewardXp: mission.rewardXp,
  };
}

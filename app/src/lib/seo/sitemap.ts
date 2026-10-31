import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";

/** Public pages without data of their own. */
export const STATIC_PATHS = [
  "/",
  "/noticias",
  "/jogos",
  "/forum",
  "/galeria",
  "/highscores",
  "/desenvolvedores",
  "/privacidade",
  "/termos",
  "/licencas",
] as const;

/** Sitemaps hold at most 50,000 URLs; each kind is capped well below that. */
const MAX_PER_KIND = 10_000;

export type SitemapData = {
  games: { slug: string; updatedAt: Date }[];
  guides: { slug: string; updatedAt: Date }[];
  articles: { slug: string; updatedAt: Date }[];
  threads: { id: string; lastPostAt: Date }[];
};

/** Everything public and indexable: games, published guides and articles, visible forum threads. */
export async function loadSitemapData(): Promise<SitemapData> {
  const [games, guides, articles, threads] = await Promise.all([
    prisma.game.findMany({ select: { slug: true, updatedAt: true }, orderBy: { slug: "asc" }, take: MAX_PER_KIND }),
    prisma.guide.findMany({
      where: { status: "published" },
      select: { updatedAt: true, game: { select: { slug: true } } },
      orderBy: { updatedAt: "desc" },
      take: MAX_PER_KIND,
    }),
    prisma.article.findMany({
      where: { status: "published" },
      select: { slug: true, updatedAt: true },
      orderBy: { publishedAt: "desc" },
      take: MAX_PER_KIND,
    }),
    prisma.forumThread.findMany({
      where: { status: { in: ["open", "locked"] } },
      select: { id: true, lastPostAt: true },
      orderBy: { lastPostAt: "desc" },
      take: MAX_PER_KIND,
    }),
  ]);
  return {
    games,
    guides: guides.map((g) => ({ slug: g.game.slug, updatedAt: g.updatedAt })),
    articles,
    threads,
  };
}

/** Pure: absolute sitemap entries for `base` (the public origin). */
export function buildSitemap(data: SitemapData, base: string): MetadataRoute.Sitemap {
  const url = (path: string) => new URL(path, base).toString();
  return [
    ...STATIC_PATHS.map((path) => ({
      url: url(path),
      changeFrequency: path === "/" || path === "/noticias" ? ("hourly" as const) : ("weekly" as const),
      priority: path === "/" ? 1 : 0.6,
    })),
    ...data.articles.map((a) => ({ url: url(`/noticias/${a.slug}`), lastModified: a.updatedAt, priority: 0.8 })),
    ...data.games.map((g) => ({ url: url(`/jogos/${g.slug}`), lastModified: g.updatedAt, priority: 0.7 })),
    ...data.guides.map((g) => ({ url: url(`/jogos/${g.slug}/guia`), lastModified: g.updatedAt, priority: 0.9 })),
    ...data.threads.map((t) => ({ url: url(`/forum/t/${t.id}`), lastModified: t.lastPostAt, priority: 0.4 })),
  ];
}

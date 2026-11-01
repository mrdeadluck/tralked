import { z } from "zod";
import { prisma } from "@/lib/db";

/** Feed of published articles for robots (GET /api/v1/articles): what the site already says. */

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

const sinceSchema = z.iso.datetime({ offset: true });
const limitSchema = z.string().regex(/^\d{1,4}$/).transform(Number).pipe(z.number().int().min(1).max(MAX_LIMIT));

export type FeedArticle = {
  id: string;
  slug: string;
  title: string;
  category: string;
  publishedAt: string;
  source: "editorial" | "bot";
  /** Slugs of the games the article is about. */
  games: string[];
};

/**
 * Published articles from any author, newest first, with `publishedAt >= since`
 * (default: the last 7 days). A malformed parameter is reported with its name (`?limit`).
 */
export async function listRecentArticles(
  params: URLSearchParams,
): Promise<{ ok: true; articles: FeedArticle[] } | { ok: false; param: string; message: string }> {
  let since = new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rawSince = params.get("since");
  if (rawSince !== null) {
    if (!sinceSchema.safeParse(rawSince).success) {
      return {
        ok: false,
        param: "?since",
        message: "since deve ser um horário ISO 8601 com fuso (ex.: 2026-10-01T00:00:00Z; codifique + como %2B)",
      };
    }
    since = new Date(rawSince);
  }

  let limit = DEFAULT_LIMIT;
  const rawLimit = params.get("limit");
  if (rawLimit !== null) {
    const parsed = limitSchema.safeParse(rawLimit);
    if (!parsed.success) {
      return { ok: false, param: "?limit", message: `limit deve ser um número inteiro de 1 a ${MAX_LIMIT}` };
    }
    limit = parsed.data;
  }

  const rows = await prisma.article.findMany({
    where: { status: "published", publishedAt: { gte: since } },
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      slug: true,
      title: true,
      category: true,
      publishedAt: true,
      source: true,
      games: { where: { game: { stub: false } }, select: { game: { select: { slug: true } } }, orderBy: { game: { slug: "asc" } } },
    },
  });
  return {
    ok: true,
    articles: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      category: row.category,
      publishedAt: row.publishedAt.toISOString(),
      source: row.source === "bot" ? "bot" : "editorial",
      games: row.games.map((g) => g.game.slug),
    })),
  };
}

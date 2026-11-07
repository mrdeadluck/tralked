import { shareImageUrl } from "./share-image";

/*
 * Machine-readable lists of the latest news: the Google News sitemap (articles of the last two
 * days, what Google News and Discover read first) and an RSS 2.0 feed (Google Publisher Center,
 * Feedly, Flipboard, MSN Start and other aggregators). Builders are pure; every text is escaped.
 */

export type FeedArticle = {
  slug: string;
  title: string;
  excerpt: string | null;
  category: string;
  authorLabel: string;
  publishedAt: Date;
  imageUrl: string | null;
  wideImageUrl?: string | null;
};

export const PUBLICATION_NAME = "Tralked";
/** Where the RSS feed is served (app/feed.xml/route.ts). */
export const FEED_PATH = "/feed.xml";
/** Where the Google News sitemap is served (app/sitemap-noticias.xml/route.ts). */
export const NEWS_SITEMAP_PATH = "/sitemap-noticias.xml";
/** Google News only takes articles published in the last two days. */
export const NEWS_SITEMAP_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
/** And at most 1,000 of them per sitemap. */
const NEWS_SITEMAP_MAX = 1000;

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

/** Text safe inside an XML element or attribute; control characters XML 1.0 forbids are dropped. */
export function xmlEscape(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

const articleUrl = (slug: string, base: string) => new URL(`/noticias/${slug}`, base).toString();

/** Absolute picture for feeds: relative site paths become absolute, anything else is dropped. */
function feedImage(article: FeedArticle, base: string): string | null {
  const url = shareImageUrl({ wideImageUrl: article.wideImageUrl, imageUrl: article.imageUrl });
  if (!url) return null;
  return url.startsWith("/") ? new URL(url, base).toString() : url;
}

/** Google News sitemap: the articles of the last two days (`now` is the reference instant). */
export function buildNewsSitemap(articles: FeedArticle[], base: string, now: Date): string {
  const since = now.getTime() - NEWS_SITEMAP_WINDOW_MS;
  const recent = articles
    .filter((a) => a.publishedAt.getTime() >= since && a.publishedAt.getTime() <= now.getTime())
    .slice(0, NEWS_SITEMAP_MAX);
  const entries = recent.map(
    (a) => `<url><loc>${xmlEscape(articleUrl(a.slug, base))}</loc><news:news><news:publication><news:name>${PUBLICATION_NAME}</news:name><news:language>pt</news:language></news:publication><news:publication_date>${a.publishedAt.toISOString()}</news:publication_date><news:title>${xmlEscape(a.title)}</news:title></news:news></url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">',
    ...entries,
    "</urlset>",
    "",
  ].join("\n");
}

/** RSS 2.0 with the latest articles, newest first; `self` is the feed's own path. */
export function buildRss(articles: FeedArticle[], base: string, self: string): string {
  const site = new URL("/", base).toString();
  const newsUrl = new URL("/noticias", base).toString();
  const items = articles.map((a) => {
    const url = articleUrl(a.slug, base);
    const image = feedImage(a, base);
    return [
      "<item>",
      `<title>${xmlEscape(a.title)}</title>`,
      `<link>${xmlEscape(url)}</link>`,
      `<guid isPermaLink="true">${xmlEscape(url)}</guid>`,
      `<pubDate>${a.publishedAt.toUTCString()}</pubDate>`,
      `<dc:creator>${xmlEscape(a.authorLabel.replace(/^@/, ""))}</dc:creator>`,
      `<category>${xmlEscape(a.category)}</category>`,
      a.excerpt ? `<description>${xmlEscape(a.excerpt)}</description>` : "",
      image ? `<media:content url="${xmlEscape(image)}" medium="image"/>` : "",
      "</item>",
    ]
      .filter(Boolean)
      .join("");
  });
  const latest = articles[0]?.publishedAt;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">',
    "<channel>",
    `<title>${PUBLICATION_NAME}: notícias de games</title>`,
    `<link>${xmlEscape(newsUrl)}</link>`,
    `<atom:link href="${xmlEscape(new URL(self, base).toString())}" rel="self" type="application/rss+xml"/>`,
    "<description>Notícias de games, guias de conquistas 100% e a vida da comunidade, da redação do Tralked.</description>",
    "<language>pt-BR</language>",
    ...(latest ? [`<lastBuildDate>${latest.toUTCString()}</lastBuildDate>`] : []),
    `<image><url>${xmlEscape(new URL("/apple-icon.png", base).toString())}</url><title>${PUBLICATION_NAME}</title><link>${xmlEscape(site)}</link></image>`,
    ...items,
    "</channel>",
    "</rss>",
    "",
  ].join("\n");
}

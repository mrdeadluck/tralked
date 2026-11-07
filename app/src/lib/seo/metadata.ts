import type { Metadata } from "next";
import { FEED_PATH } from "./news-feeds";

/*
 * Shared pieces of page metadata. Next merges metadata shallowly: a page that sets `openGraph`
 * replaces the layout's whole object, so pages spread SITE_OPEN_GRAPH to keep the site name and
 * locale. Canonical URLs are set page by page (relative; metadataBase makes them absolute): a
 * canonical in the root layout would be inherited by every page that sets none and point them all
 * at the home page.
 */

export const SITE_OPEN_GRAPH = { siteName: "Tralked", locale: "pt_BR", type: "website" } as const;

/** The site's share picture (app/opengraph-image.tsx), for pages whose own picture is missing. */
export const SITE_SHARE_IMAGE = "/opengraph-image";

/** `alternates.canonical` for a site path: query strings (filters, pages, tracking) are left out. */
export function canonical(path: string): Pick<Metadata, "alternates"> {
  return { alternates: { canonical: path } };
}

/**
 * Canonical plus the RSS feed's <link rel="alternate">, for the pages feed readers and aggregators
 * look at (home, /noticias). Not in the root layout: a page's own `alternates` would drop it, and a
 * <link> rendered in the layout body breaks the partial prerender's resume.
 */
export function canonicalWithFeed(path: string): Pick<Metadata, "alternates"> {
  return {
    alternates: {
      canonical: path,
      types: { "application/rss+xml": [{ url: FEED_PATH, title: "Tralked: notícias de games" }] },
    },
  };
}

/**
 * Every page that sets no robots of its own: indexable, and Google may show a large picture
 * (Discover only shows big cards with max-image-preview:large), full snippets and video previews.
 */
export const SITE_ROBOTS = {
  index: true,
  follow: true,
  googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
} as const;

/** Kept out of the index, links still followed (thin or empty pages that lead to real ones). */
export const NOINDEX_FOLLOW = { index: false, follow: true } as const;

/**
 * A game page says something beyond its name when it has store details (not a name-only stub of
 * the Steam catalog) and either a summary or an achievement list. The rest stays out of the index:
 * ~200k empty pages would weigh on how search engines judge the whole site.
 */
export function gameIndexable(game: { stub: boolean; summary: string | null; achievementCount: number }): boolean {
  if (game.stub) return false;
  return game.achievementCount > 0 || (game.summary?.trim().length ?? 0) >= 40;
}

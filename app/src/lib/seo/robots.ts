import type { MetadataRoute } from "next";
import { AI_TRAINING_CRAWLERS } from "./ai-crawlers";

/**
 * Private areas (admin, account, API, notifications, newsletter links) stay out of search engines,
 * and so do the sign-in pages (nothing to index; crawlers hit them thousands of times a day).
 */
export const DISALLOWED_PATHS = [
  "/admin",
  "/conta",
  "/api",
  "/notificacoes",
  "/newsletter",
  "/confirmar-email",
  "/entrar",
  "/cadastrar",
];

/**
 * Listings every catalog game has, nearly all empty: its forum section and its gallery filter.
 * Search crawlers walked one of each per game they found (2026-11-03..05: 99% of /forum/[categoria]
 * and 95% of /galeria hits, most of the site's CPU after the game pages). Forum sections with
 * topics are opened again one by one (buildRobots); threads (/forum/t/) and the forum index
 * (/forum, not under "/forum/") stay open. Longer rules win, so an Allow beats "/forum/".
 */
export const EMPTY_LISTING_PATHS = ["/forum/", "/galeria?jogo=", "/galeria?*&jogo=", "/jogos?*exclusivos=", "/jogos?*trofeus="];

/** `openForumSections`: segments of the forum sections with content (categories, games with topics). */
export function buildRobots(base: string, openForumSections: readonly string[] = []): MetadataRoute.Robots {
  return {
    rules: [
      // AI training crawlers: the whole site is off limits (the proxy also answers them 403).
      { userAgent: [...AI_TRAINING_CRAWLERS], disallow: "/" },
      {
        userAgent: "*",
        allow: ["/", "/forum/t/", ...openForumSections.map((segment) => `/forum/${segment}`)],
        disallow: [...DISALLOWED_PATHS, ...EMPTY_LISTING_PATHS],
      },
    ],
    sitemap: new URL("/sitemap.xml", base).toString(),
  };
}

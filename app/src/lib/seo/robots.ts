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

export function buildRobots(base: string): MetadataRoute.Robots {
  return {
    rules: [
      // AI training crawlers: the whole site is off limits (the proxy also answers them 403).
      { userAgent: [...AI_TRAINING_CRAWLERS], disallow: "/" },
      { userAgent: "*", allow: "/", disallow: DISALLOWED_PATHS },
    ],
    sitemap: new URL("/sitemap.xml", base).toString(),
  };
}

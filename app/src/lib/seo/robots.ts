import type { MetadataRoute } from "next";

/** Private areas (admin, account, API, notifications, newsletter links) stay out of search engines. */
export const DISALLOWED_PATHS = ["/admin", "/conta", "/api", "/notificacoes", "/newsletter"];

export function buildRobots(base: string): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: DISALLOWED_PATHS },
    sitemap: new URL("/sitemap.xml", base).toString(),
  };
}

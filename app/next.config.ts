import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  /* config options here */
  // Clickjacking, sniffing and referrer protection on every response (src/lib/security-headers.ts).
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  cacheComponents: true,
  /*
   * `feed`: public lists whose writes already invalidate their tags (news, forum, gallery,
   * highscores, player headers: publishing, posting, moderation and the daily snapshot call
   * revalidateTag/updateTag). Time only refreshes what no write marks: view counts, "há 5 min",
   * XP rankings. 15 min instead of the built-in `minutes` (1 min) cut background re-renders of the
   * home, the news and the forum sections up to 15 times, and the 1-day expiry (instead of 1 h)
   * keeps long-tail pages (old articles, game forum sections) cached between crawler visits.
   */
  cacheLife: {
    feed: { stale: 300, revalidate: 900, expire: 86_400 },
  },
  partialPrefetching: false,
  // No preload `Link` headers from React: Next replays a prerendered route's headers on its
  // prefetch responses too, so every page prefetching "/" (the logo) or a game page downloaded that
  // route's hero art (up to 5 MB). Preloads stay in each page's own <head> as <link> tags instead.
  reactMaxHeadersLength: 0,
  // The dev badge overlaps the page in e2e screenshots and trips axe in dev mode.
  devIndicators: false,
  // Every build worker opens its own Postgres pool (up to 10 connections): on a many-core machine
  // the default worker count exhausts Postgres' 100 connections. NEXT_BUILD_CPUS caps the workers.
  ...(process.env.NEXT_BUILD_CPUS ? { experimental: { cpus: Number(process.env.NEXT_BUILD_CPUS) } } : {}),
  // The default social image reads its fonts from disk at request time: ship them with that route.
  outputFileTracingIncludes: {
    "/opengraph-image": ["./assets/fonts/*.ttf"],
  },
  // Steam art is hotlinked from Steam's CDNs (never stored): store/library art, achievement icons
  // and avatars. Query strings stay allowed because Steam versions its files with `?t=`.
  images: {
    remotePatterns: [
      // Vercel Blob: gallery photos and the images bots upload for guides.
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com", pathname: "/**" },
      { protocol: "https", hostname: "shared.akamai.steamstatic.com", pathname: "/store_item_assets/**" },
      { protocol: "https", hostname: "shared.fastly.steamstatic.com", pathname: "/store_item_assets/**" },
      { protocol: "https", hostname: "shared.fastly.steamstatic.com", pathname: "/community_assets/**" },
      { protocol: "https", hostname: "avatars.fastly.steamstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "avatars.akamai.steamstatic.com", pathname: "/**" },
      { protocol: "https", hostname: "cdn.cloudflare.steamstatic.com", pathname: "/steam/apps/**" },
      { protocol: "https", hostname: "cdn.akamai.steamstatic.com", pathname: "/steam/apps/**" },
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

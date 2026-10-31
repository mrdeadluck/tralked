import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: false,
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

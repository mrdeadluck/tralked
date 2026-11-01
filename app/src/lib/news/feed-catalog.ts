import type { NewsFeedArea } from "./areas";

/**
 * Curated external headline feeds for the Entretenimento and Tecnologia areas (Plan 4 F7).
 * Each URL was checked on 2026-10-31: HTTP 200 over https, valid RSS 2.0, read by
 * `fetchFeed` without redirects. pt-BR first, then reputable English sources.
 *
 * Who adds them: `pnpm news:feeds` (scripts/news-feeds.ts) on a real database, active; the
 * development seed adds them paused, so tests and `pnpm dev` never fetch the internet.
 * The admin manages them afterwards in /admin/feeds (pause, edit, delete).
 */
export type RecommendedFeed = { name: string; url: string; area: NewsFeedArea; language: "pt-BR" | "en" };

export const RECOMMENDED_FEEDS: RecommendedFeed[] = [
  // Entretenimento: anime, movies and series (only game-related headlines are kept).
  { name: "Legião dos Heróis", url: "https://www.legiaodosherois.com.br/feed", area: "ENTRETENIMENTO", language: "pt-BR" },
  { name: "AnimeNew", url: "https://animenew.com.br/feed/", area: "ENTRETENIMENTO", language: "pt-BR" },
  { name: "IGN Movies", url: "https://feeds.feedburner.com/ign/movies-articles", area: "ENTRETENIMENTO", language: "en" },
  { name: "IGN TV", url: "https://feeds.feedburner.com/ign/tv-articles", area: "ENTRETENIMENTO", language: "en" },
  { name: "Anime News Network", url: "https://www.animenewsnetwork.com/all/rss.xml?ann-edition=w", area: "ENTRETENIMENTO", language: "en" },
  // Tecnologia: hardware, PC, consoles and AI.
  { name: "Tecnoblog", url: "https://tecnoblog.net/feed/", area: "TECNOLOGIA", language: "pt-BR" },
  { name: "TecMundo", url: "https://rss.tecmundo.com.br/feed", area: "TECNOLOGIA", language: "pt-BR" },
  { name: "Adrenaline", url: "https://www.adrenaline.com.br/feed/", area: "TECNOLOGIA", language: "pt-BR" },
  { name: "Canaltech", url: "https://canaltech.com.br/rss/", area: "TECNOLOGIA", language: "pt-BR" },
  { name: "Tom's Hardware", url: "https://www.tomshardware.com/feeds.xml", area: "TECNOLOGIA", language: "en" },
  { name: "The Verge (IA)", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", area: "TECNOLOGIA", language: "en" },
];

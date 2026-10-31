import { prisma } from "@/lib/db";
import { normalizeTitle } from "@/lib/integrations/title-match";
import { fetchFeed, resolveHost, type FeedItem, type ResolveHost } from "@/lib/integrations/rss";
import { classifyHeadline, toNewsFeedArea, type CatalogMatch } from "@/lib/news/areas";

/** Names shorter than this (normalized) only match with their exact case: "HK", "RE4". */
const SHORT_NAME = 4;

type GameNames = { gameId: string; names: { text: string; short: boolean; multiWord: boolean }[] };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function loadMatcher(games: { id: string; name: string; aliases: string[] }[]) {
  const list: GameNames[] = games.map((g) => ({
    gameId: g.id,
    names: [g.name, ...g.aliases]
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => {
        const normalized = normalizeTitle(n);
        const multiWord = normalized.includes(" ");
        return normalized.length < SHORT_NAME
          ? { text: n, short: true, multiWord }
          : { text: normalized, short: false, multiWord };
      })
      .filter((n) => n.text.length > 0),
  }));

  /**
   * The game an item is about: its name or an alias appears as whole words in the title. The
   * longest match wins ("Hollow Knight Silksong" over "Hollow Knight"); a tie between two
   * games is ambiguous and matches nothing.
   */
  return (title: string): CatalogMatch | null => {
    const normalized = ` ${normalizeTitle(title)} `;
    let best: { gameId: string; length: number; multiWord: boolean } | null = null;
    let tie = false;
    for (const game of list) {
      for (const name of game.names) {
        const hit = name.short
          ? new RegExp(`(^|[^A-Za-z0-9])${escape(name.text)}([^A-Za-z0-9]|$)`).test(title)
          : normalized.includes(` ${name.text} `);
        if (!hit) continue;
        const length = name.text.length;
        if (!best || length > best.length) {
          best = { gameId: game.gameId, length, multiWord: name.multiWord };
          tie = false;
        } else if (length === best.length && best.gameId !== game.gameId) {
          tie = true;
        }
      }
    }
    return best && !tie ? { gameId: best.gameId, multiWord: best.multiWord } : null;
  };
}

export type ExternalNewsResult = { processed: number; failed: number; created: number };

/**
 * Cron job: reads every active RSS feed and stores the items that belong to the feed's area
 * (GAMES: about a catalog game, matched by name or alias; ENTRETENIMENTO / TECNOLOGIA: see the
 * rule in src/lib/news/areas.ts). Only title, link, publication name, date and area are kept,
 * never the text. Items are unique by URL, so re-reading a feed adds nothing.
 */
export async function syncExternalNews(
  fetchImpl: typeof fetch = globalThis.fetch,
  resolve: ResolveHost = resolveHost,
): Promise<ExternalNewsResult> {
  const [feeds, games] = await Promise.all([
    prisma.newsFeed.findMany({ where: { active: true } }),
    prisma.game.findMany({ select: { id: true, name: true, aliases: true } }),
  ]);
  const gameOf = loadMatcher(games);

  let processed = 0;
  let failed = 0;
  let created = 0;
  for (const feed of feeds) {
    let items: FeedItem[];
    try {
      items = await fetchFeed(feed.url, fetchImpl, resolve);
    } catch (error) {
      failed++;
      console.error(`News: could not read feed ${feed.name}`, error instanceof Error ? error.message : error);
      continue;
    }
    const area = toNewsFeedArea(feed.area);
    const rows = items.flatMap((item) => {
      const kept = classifyHeadline(area, item.title, gameOf(item.title));
      return kept
        ? [{ gameId: kept.gameId, title: item.title, url: item.url, source: feed.name, publishedAt: item.publishedAt, area }]
        : [];
    });
    const result = await prisma.externalNews.createMany({ data: rows, skipDuplicates: true });
    created += result.count;
    processed++;
  }
  return { processed, failed, created };
}

import { cacheLife, cacheTag } from "next/cache";
import { prisma } from "@/lib/db";
import { toLocalDay } from "@/lib/engine/streak";

/**
 * Steam concurrent players on the game page (item 14). The worker samples hourly; a sample older
 * than FRESH_MS is not shown as "now" (the game left the sampled top, or the worker stopped), and
 * the day's peak only counts on its own America/Sao_Paulo day.
 */

const FRESH_MS = 3 * 3_600_000;

export type SteamPlayersView = {
  /** Players in the last sample; null when the sample is too old to call "now". */
  current: number | null;
  /** Highest sample of today (America/Sao_Paulo); null when today has none. */
  todayPeak: number | null;
  /** Highest sample Tralked ever measured. */
  allTimePeak: number;
};

type Row = {
  current: number;
  sampledAt: Date;
  todayPeak: number;
  todayPeakDay: Date;
  allTimePeak: number;
};

export function steamPlayersView(row: Row | null, now: Date): SteamPlayersView | null {
  if (!row) return null;
  const fresh = now.getTime() - row.sampledAt.getTime() <= FRESH_MS;
  // `todayPeakDay` is a DATE column: Prisma returns it as UTC midnight of that day.
  const today = row.todayPeakDay.toISOString().slice(0, 10) === toLocalDay(now);
  if (!fresh && row.allTimePeak <= 0) return null;
  return {
    current: fresh ? row.current : null,
    todayPeak: fresh && today ? row.todayPeak : null,
    allTimePeak: row.allTimePeak,
  };
}

export async function loadSteamPlayers(gameId: string, now: Date = new Date()): Promise<SteamPlayersView | null> {
  const row = await prisma.steamPlayerCount.findUnique({
    where: { gameId },
    select: { current: true, sampledAt: true, todayPeak: true, todayPeakDay: true, allTimePeak: true },
  });
  return steamPlayersView(row, now);
}

/**
 * Cached apart from the game profile (hours): the worker writes every hour, nothing revalidates it.
 * Expires after a day, not 2 h: the shortest expiry inside a page is the page's, and 2 h made every
 * game page a full re-render (80–290 ms of CPU) for crawlers walking the catalog's long tail. A
 * page idle for hours shows the older count once while the new one renders.
 */
export async function getSteamPlayers(gameId: string): Promise<SteamPlayersView | null> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 900, expire: 86_400 });
  cacheTag(`steam-players:${gameId}`);
  return loadSteamPlayers(gameId);
}

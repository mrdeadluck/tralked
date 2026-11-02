import { prisma } from "@/lib/db";
import { toLocalDay } from "@/lib/engine/streak";
import { timeoutSignal } from "@/lib/integrations/http";

/**
 * Steam concurrent players of the most popular Steam games (item 14), sampled every hour by the
 * steam-players worker (scripts/steam-players-worker.ts, .github/workflows/steam-players.yml).
 * Each game keeps one SteamPlayerCount row, rewritten in place: the last sample, the day's highest
 * sample (America/Sao_Paulo day) and the highest sample Tralked ever measured. Steam has no
 * official all-time peak, and per-sample history would not fit the free database.
 *
 * ISteamUserStats/GetNumberOfCurrentPlayers needs no key, so sampling never spends the
 * STEAM_API_KEY daily quota the syncs and the details worker share.
 */

const PLAYERS_URL = "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/";

/** Steam is refusing us (rate limit or outage): the run should stop instead of hammering. */
export class SteamThrottledError extends Error {
  constructor(readonly status: number) {
    super(`Steam GetNumberOfCurrentPlayers answered HTTP ${status}`);
    this.name = "SteamThrottledError";
  }
}

/**
 * Current players of one app, or null when Steam has no count for it (unknown app, tools, games
 * Steam does not track: HTTP 404 or `result` other than 1). Throws SteamThrottledError on 429/5xx.
 */
export async function fetchCurrentPlayers(appId: number, fetchImpl: typeof fetch = globalThis.fetch): Promise<number | null> {
  const url = `${PLAYERS_URL}?appid=${appId}`;
  const res = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: timeoutSignal() });
  if (res.status === 429 || res.status >= 500) throw new SteamThrottledError(res.status);
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { response?: { player_count?: unknown; result?: unknown } } | null;
  const count = body?.response?.player_count;
  if (body?.response?.result !== 1 || typeof count !== "number" || !Number.isInteger(count) || count < 0) return null;
  return count;
}

export type PlayerSample = { gameId: string; count: number };

export type SampleResult = {
  samples: PlayerSample[];
  /** Games Steam had no count for. */
  missing: number;
  /** Requests that failed (network, timeout, throttling). */
  failed: number;
  /** Stopped early because Steam kept refusing us. */
  throttled: boolean;
};

/**
 * Samples every game with at most `concurrency` requests in flight. After `maxThrottled` refusals
 * (429/5xx) no new request starts: what was read is still returned and written.
 */
export async function samplePlayers(
  games: { id: string; steamAppId: number }[],
  {
    concurrency = 16,
    maxThrottled = 20,
    fetchImpl = globalThis.fetch,
  }: { concurrency?: number; maxThrottled?: number; fetchImpl?: typeof fetch } = {},
): Promise<SampleResult> {
  const result: SampleResult = { samples: [], missing: 0, failed: 0, throttled: false };
  let throttledCount = 0;
  let next = 0;
  const worker = async () => {
    while (next < games.length && !result.throttled) {
      const game = games[next++];
      try {
        const count = await fetchCurrentPlayers(game.steamAppId, fetchImpl);
        if (count === null) result.missing++;
        else result.samples.push({ gameId: game.id, count });
      } catch (error) {
        result.failed++;
        if (error instanceof SteamThrottledError && ++throttledCount >= maxThrottled) result.throttled = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, games.length) }, worker));
  return result;
}

/** The Steam games to sample: the most popular of the catalog (SteamSpy owners, Game.popularity). */
export function topSteamGames(limit: number): Promise<{ id: string; steamAppId: number }[]> {
  return prisma.game
    .findMany({
      where: { steamAppId: { not: null }, popularity: { gt: 0 } },
      orderBy: [{ popularity: "desc" }, { id: "asc" }],
      take: limit,
      select: { id: true, steamAppId: true },
    })
    .then((rows) => rows.map((r) => ({ id: r.id, steamAppId: r.steamAppId! })));
}

/**
 * Writes the samples in one statement: the current count, the day's peak (reset when the
 * America/Sao_Paulo day changes) and the highest peak measured (with when it was measured).
 */
export async function recordPlayerCounts(samples: PlayerSample[], now: Date = new Date()): Promise<number> {
  if (samples.length === 0) return 0;
  const day = toLocalDay(now);
  return prisma.$executeRaw`
    INSERT INTO "SteamPlayerCount" AS p
      ("gameId", current, "sampledAt", "todayPeak", "todayPeakDay", "allTimePeak", "allTimePeakAt")
    SELECT s.id, s.n, ${now}, s.n, ${day}::date, s.n, ${now}
    FROM unnest(${samples.map((s) => s.gameId)}::text[], ${samples.map((s) => s.count)}::int[]) AS s(id, n)
    WHERE EXISTS (SELECT 1 FROM "Game" g WHERE g.id = s.id)
    ON CONFLICT ("gameId") DO UPDATE SET
      current = EXCLUDED.current,
      "sampledAt" = EXCLUDED."sampledAt",
      "todayPeak" = CASE WHEN p."todayPeakDay" = EXCLUDED."todayPeakDay"
                         THEN GREATEST(p."todayPeak", EXCLUDED.current) ELSE EXCLUDED.current END,
      "todayPeakDay" = EXCLUDED."todayPeakDay",
      "allTimePeakAt" = CASE WHEN EXCLUDED.current > p."allTimePeak" THEN EXCLUDED."sampledAt" ELSE p."allTimePeakAt" END,
      "allTimePeak" = GREATEST(p."allTimePeak", EXCLUDED.current)`;
}

import { timeoutSignal } from "../http";
import type { RetroAchievement, RetroApi, RetroGame, RetroGameProgress, RetroProfile } from "./types";

/**
 * RetroAchievements official Web API (https://api-docs.retroachievements.org), authenticated
 * with the web API key of Tralked's service account. The key travels in the query string, so
 * errors are rebuilt from scratch: they carry the endpoint name and HTTP status only, never a
 * URL (and never the key).
 */

const BASE = "https://retroachievements.org/API";
const MEDIA = "https://media.retroachievements.org";
const PAGE_SIZE = 500;

export type RetroClientConfig = {
  apiKey: string;
  /** The service account's username (sent as `z`, accepted by every endpoint). */
  username?: string;
  fetch?: typeof fetch;
};

type ProfileRecord = { User?: string; ULID?: string; Motto?: string; UserPic?: string };

type CompletionRecord = {
  GameID: number;
  Title: string;
  ConsoleName?: string;
  MaxPossible?: number;
  NumAwarded?: number;
  NumAwardedHardcore?: number;
  MostRecentAwardedDate?: string;
};

type AchievementRecord = {
  ID: number;
  Title: string;
  Description?: string;
  Points?: number;
  NumAwarded?: number;
  BadgeName?: string;
  DateEarned?: string;
  DateEarnedHardcore?: string;
};

type GameProgressRecord = {
  NumDistinctPlayers?: number;
  UserTotalPlaytime?: number;
  Achievements?: Record<string, AchievementRecord>;
};

/** RA dates are `YYYY-MM-DD HH:MM:SS` in UTC, or ISO 8601. */
export function parseRetroDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

const absolute = (path: string | undefined, base: string) =>
  path ? (path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`) : null;

export function createRetroClient({
  apiKey,
  username,
  fetch: fetchImpl = globalThis.fetch,
}: RetroClientConfig): RetroApi {
  async function get<T>(endpoint: string, params: Record<string, string>): Promise<T | null> {
    const url = new URL(`${BASE}/${endpoint}.php`);
    url.searchParams.set("y", apiKey);
    if (username) url.searchParams.set("z", username);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let res: Response;
    try {
      res = await fetchImpl(url.toString(), {
        headers: { Accept: "application/json" },
        signal: timeoutSignal(),
      });
    } catch {
      // Network errors may echo the request URL, which holds the key.
      throw new Error(`RetroAchievements ${endpoint} request failed`);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`RetroAchievements ${endpoint} failed with HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async findProfile(user): Promise<RetroProfile | null> {
      const body = await get<ProfileRecord>("API_GetUserProfile", { u: user });
      if (!body?.User || !body.ULID) return null;
      return {
        user: body.User,
        ulid: body.ULID,
        motto: body.Motto ?? "",
        avatarUrl: absolute(body.UserPic, MEDIA),
      };
    },

    async getGames(user): Promise<RetroGame[]> {
      const games: RetroGame[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await get<{ Total?: number; Results?: CompletionRecord[] }>(
          "API_GetUserCompletionProgress",
          { u: user, c: String(PAGE_SIZE), o: String(offset) },
        );
        const results = page?.Results ?? [];
        for (const g of results) {
          games.push({
            gameId: String(g.GameID),
            title: g.Title,
            consoleName: g.ConsoleName ?? "",
            maxPossible: g.MaxPossible ?? 0,
            numAwarded: g.NumAwarded ?? 0,
            numAwardedHardcore: g.NumAwardedHardcore ?? 0,
            lastPlayed: parseRetroDate(g.MostRecentAwardedDate),
          });
        }
        if (results.length < PAGE_SIZE || games.length >= (page?.Total ?? 0)) return games;
      }
    },

    async getGameProgress(user, gameId): Promise<RetroGameProgress> {
      const body = await get<GameProgressRecord>("API_GetGameInfoAndUserProgress", {
        u: user,
        g: gameId,
      });
      const players = body?.NumDistinctPlayers ?? 0;
      const achievements = Object.values(body?.Achievements ?? {}).map(
        (a): RetroAchievement => {
          const hardcoreAt = parseRetroDate(a.DateEarnedHardcore);
          const earnedAt = hardcoreAt ?? parseRetroDate(a.DateEarned);
          return {
            id: String(a.ID),
            name: a.Title,
            description: a.Description || null,
            iconUrl: a.BadgeName ? `${MEDIA}/Badge/${a.BadgeName}.png` : null,
            points: a.Points ?? 0,
            rarityPct:
              players > 0 && a.NumAwarded !== undefined
                ? Math.round((a.NumAwarded / players) * 10_000) / 100
                : null,
            earned: earnedAt !== null,
            earnedAt,
            hardcore: hardcoreAt !== null,
          };
        },
      );
      return {
        playtimeMin: body?.UserTotalPlaytime ?? null,
        achievements,
      };
    },
  };
}

import { env } from "@/lib/env";
import { pickClient } from "../availability";
import { timeoutSignal } from "../http";
import { parseRetroDate } from "./client";

/**
 * RetroAchievements catalog endpoints (item 15): the consoles, each console's games with
 * achievements, and one game's achievement set without any player. Same authentication and the
 * same care with the key as ./client.ts (errors never carry the URL).
 */

const BASE = "https://retroachievements.org/API";
const MEDIA = "https://media.retroachievements.org";
const LIST_TIMEOUT_MS = 60_000;

export type RetroConsole = { id: number; name: string };

export type RetroCatalogEntry = {
  id: number;
  title: string;
  consoleId: number;
  consoleName: string;
  /** RA image path (`/Images/020895.png`), null when RA has none. */
  iconPath: string | null;
  achievementCount: number;
  points: number;
  /** When RA last changed the set (DateModified). */
  modifiedAt: Date | null;
};

export type RetroSetAchievement = {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  points: number;
  /** Share of the game's players that unlocked it (0-100), null when unknown. */
  rarityPct: number | null;
};

export interface RetroCatalogApi {
  /** Active game systems. */
  getConsoles(): Promise<RetroConsole[]>;
  /** Games of one console that have achievements (RA `f=1`). */
  getGameList(consoleId: number): Promise<RetroCatalogEntry[]>;
  /** The game's achievement set (official achievements), or null for an unknown game. */
  getGameAchievements(gameId: number): Promise<RetroSetAchievement[] | null>;
}

type ConsoleRecord = { ID?: number; Name?: string; Active?: boolean; IsGameSystem?: boolean };
type GameListRecord = {
  ID?: number;
  Title?: string;
  ConsoleID?: number;
  ConsoleName?: string;
  ImageIcon?: string;
  NumAchievements?: number;
  Points?: number;
  DateModified?: string | null;
};
type ExtendedRecord = {
  NumDistinctPlayers?: number;
  Achievements?: Record<
    string,
    { ID?: number; Title?: string; Description?: string; Points?: number; NumAwarded?: number; BadgeName?: string; DisplayOrder?: number }
  >;
};

const IMAGE_PATH = /^\/Images\/[A-Za-z0-9_.-]+$/;

export function createRetroCatalogClient({
  apiKey,
  username,
  fetch: fetchImpl = globalThis.fetch,
}: {
  apiKey: string;
  username?: string;
  fetch?: typeof fetch;
}): RetroCatalogApi {
  async function get<T>(endpoint: string, params: Record<string, string>): Promise<T | null> {
    const url = new URL(`${BASE}/${endpoint}.php`);
    url.searchParams.set("y", apiKey);
    if (username) url.searchParams.set("z", username);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let res: Response;
    try {
      // The game lists of the big consoles (thousands of games) take longer than other calls.
      const signal = endpoint === "API_GetGameList" ? AbortSignal.timeout(LIST_TIMEOUT_MS) : timeoutSignal();
      res = await fetchImpl(url.toString(), { headers: { Accept: "application/json" }, signal });
    } catch {
      throw new Error(`RetroAchievements ${endpoint} request failed`);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`RetroAchievements ${endpoint} failed with HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async getConsoles() {
      const rows = (await get<ConsoleRecord[]>("API_GetConsoleIDs", { a: "1", g: "1" })) ?? [];
      return rows
        .filter((c) => typeof c.ID === "number" && c.Name && c.Active !== false && c.IsGameSystem !== false)
        .map((c) => ({ id: c.ID!, name: c.Name! }));
    },

    async getGameList(consoleId) {
      const rows = (await get<GameListRecord[]>("API_GetGameList", { i: String(consoleId), f: "1" })) ?? [];
      return rows
        .filter((g) => typeof g.ID === "number" && g.Title && (g.NumAchievements ?? 0) > 0)
        .map((g) => ({
          id: g.ID!,
          title: g.Title!.trim(),
          consoleId: g.ConsoleID ?? consoleId,
          consoleName: g.ConsoleName ?? "",
          iconPath: g.ImageIcon && IMAGE_PATH.test(g.ImageIcon) ? g.ImageIcon : null,
          achievementCount: g.NumAchievements ?? 0,
          points: g.Points ?? 0,
          modifiedAt: parseRetroDate(g.DateModified),
        }));
    },

    async getGameAchievements(gameId) {
      const body = await get<ExtendedRecord>("API_GetGameExtended", { i: String(gameId) });
      if (!body) return null;
      const players = body.NumDistinctPlayers ?? 0;
      return Object.values(body.Achievements ?? {})
        .filter((a) => typeof a.ID === "number" && a.Title)
        .sort((a, b) => (a.DisplayOrder ?? 0) - (b.DisplayOrder ?? 0) || a.ID! - b.ID!)
        .map((a) => ({
          id: String(a.ID),
          name: a.Title!,
          description: a.Description || null,
          iconUrl: a.BadgeName ? `${MEDIA}/Badge/${a.BadgeName}.png` : null,
          points: a.Points ?? 0,
          rarityPct:
            players > 0 && a.NumAwarded !== undefined ? Math.round((a.NumAwarded / players) * 10_000) / 100 : null,
        }));
    },
  };
}

/** Offline catalog: the fixture's Sonic (id 990001, the seeded player's game) and two SNES games. */
export function createRetroCatalogFixture(): RetroCatalogApi {
  const games: RetroCatalogEntry[] = [
    { id: 990001, title: "Sonic the Hedgehog", consoleId: 1, consoleName: "Mega Drive", iconPath: "/Images/067895.png", achievementCount: 4, points: 88, modifiedAt: new Date("2026-01-01T00:00:00Z") },
    { id: 990002, title: "Legend of Zelda, The: A Link to the Past", consoleId: 3, consoleName: "SNES/Super Famicom", iconPath: null, achievementCount: 2, points: 30, modifiedAt: null },
    { id: 990003, title: "~Hack~ Super Mario World: Kaizo", consoleId: 3, consoleName: "SNES/Super Famicom", iconPath: null, achievementCount: 1, points: 10, modifiedAt: null },
  ];
  const sets: Record<number, RetroSetAchievement[]> = {
    990001: [
      { id: "9901", name: "Primeira fase", description: "Complete a Green Hill Zone 1.", iconUrl: null, points: 3, rarityPct: 80.5 },
      { id: "9902", name: "Sem anéis", description: "Derrote um chefe sem anéis.", iconUrl: null, points: 25, rarityPct: 3.2 },
      { id: "9903", name: "Esmeralda", description: "Pegue uma esmeralda do caos.", iconUrl: null, points: 10, rarityPct: 22.4 },
      { id: "9904", name: "Final verdadeiro", description: "Pegue as seis esmeraldas.", iconUrl: null, points: 50, rarityPct: 1.1 },
    ],
    990002: [
      { id: "9921", name: "Mestre Espada", description: "Pegue a Master Sword.", iconUrl: null, points: 10, rarityPct: 40 },
      { id: "9922", name: "Ganon", description: "Derrote Ganon.", iconUrl: null, points: 20, rarityPct: 12 },
    ],
  };
  return {
    async getConsoles() {
      return [
        { id: 1, name: "Mega Drive" },
        { id: 3, name: "SNES/Super Famicom" },
      ];
    },
    async getGameList(consoleId) {
      return games.filter((g) => g.consoleId === consoleId).map((g) => ({ ...g }));
    },
    async getGameAchievements(gameId) {
      return sets[gameId]?.map((a) => ({ ...a })) ?? (games.some((g) => g.id === gameId) ? [] : null);
    },
  };
}

let instance: RetroCatalogApi | undefined;

/** Real client with RA_API_KEY, the fixture where allowed, PlatformNotConfiguredError in production. */
export function getRetroCatalog(): RetroCatalogApi {
  instance ??= pickClient(
    "retro",
    (apiKey) => createRetroCatalogClient({ apiKey, username: env.RA_USERNAME }),
    createRetroCatalogFixture,
  );
  return instance;
}

/** Tests only: forgets the memoized client. */
export function resetRetroCatalog(): void {
  instance = undefined;
}

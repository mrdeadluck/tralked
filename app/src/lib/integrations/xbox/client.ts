import { timeoutSignal } from "../http";
import type { XboxAchievement, XboxApi, XboxProfile, XboxTitle } from "./types";

/**
 * Xbox Live through OpenXBL (xbl.io), an unofficial proxy of the Xbox Live APIs. The API key
 * belongs to Tralked's own service account; users never hand over credentials.
 * Errors only ever carry the endpoint name and HTTP status, never the key.
 */

const BASE = "https://xbl.io/api/v2";

export type XboxClientConfig = {
  apiKey: string;
  fetch?: typeof fetch;
};

type Setting = { id: string; value: string };

type TitleRecord = {
  titleId: string | number;
  name: string;
  achievement?: {
    currentAchievements?: number;
    totalAchievements?: number;
    currentGamerscore?: number;
    totalGamerscore?: number;
    progressPercentage?: number;
  };
  titleHistory?: { lastTimePlayed?: string };
};

type AchievementRecord = {
  id: string | number;
  name: string;
  description?: string;
  lockedDescription?: string;
  isSecret?: boolean;
  progressState?: string;
  progression?: { timeUnlocked?: string };
  mediaAssets?: { type?: string; url?: string }[];
  rewards?: { type?: string; value?: string | number }[];
  rarity?: { currentPercentage?: number };
};

// Xbox reports locked achievements with this placeholder time.
const NEVER = "0001-01-01T00:00:00.0000000Z";

const dateOrNull = (value: string | undefined) => {
  if (!value || value === NEVER) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000 ? null : date;
};

export function createXboxClient({
  apiKey,
  fetch: fetchImpl = globalThis.fetch,
}: XboxClientConfig): XboxApi {
  async function get<T>(path: string, what: string): Promise<T | "private" | null> {
    const res = await fetchImpl(`${BASE}${path}`, {
      headers: {
        "X-Authorization": apiKey,
        Accept: "application/json",
        "Accept-Language": "pt-BR",
      },
      signal: timeoutSignal(),
    });
    if (res.status === 403) return "private";
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Xbox ${what} failed with HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async findProfile(gamertag): Promise<XboxProfile | null> {
      const search = await get<{
        people?: { xuid?: string; id?: string; gamertag?: string; modernGamertag?: string }[];
      }>(`/search/${encodeURIComponent(gamertag)}`, "search");
      if (search === null || search === "private") return null;
      const wanted = gamertag.toLowerCase();
      const person = (search.people ?? []).find(
        (p) => p.gamertag?.toLowerCase() === wanted || p.modernGamertag?.toLowerCase() === wanted,
      );
      const xuid = person?.xuid ?? person?.id;
      if (!person || !xuid) return null;

      const account = await get<{ profileUsers?: { id: string; settings?: Setting[] }[] }>(
        `/account/${encodeURIComponent(xuid)}`,
        "account",
      );
      if (account === null || account === "private") return null;
      const settings = new Map(
        (account.profileUsers?.[0]?.settings ?? []).map((s) => [s.id, s.value]),
      );
      return {
        xuid,
        gamertag: settings.get("Gamertag") ?? person.gamertag ?? gamertag,
        bio: settings.get("Bio") ?? "",
        avatarUrl: settings.get("GameDisplayPicRaw") ?? null,
      };
    },

    async getTitles(xuid): Promise<XboxTitle[] | "private"> {
      const body = await get<{ titles?: TitleRecord[] }>(
        `/achievements/player/${encodeURIComponent(xuid)}`,
        "titles",
      );
      if (body === "private") return "private";
      return (body?.titles ?? []).map((t) => ({
        titleId: String(t.titleId),
        name: t.name,
        currentAchievements: t.achievement?.currentAchievements ?? 0,
        totalAchievements: t.achievement?.totalAchievements ?? 0,
        currentGamerscore: t.achievement?.currentGamerscore ?? 0,
        totalGamerscore: t.achievement?.totalGamerscore ?? 0,
        progress: t.achievement?.progressPercentage ?? 0,
        lastPlayed: dateOrNull(t.titleHistory?.lastTimePlayed),
      }));
    },

    async getAchievements(xuid, titleId): Promise<XboxAchievement[] | "private"> {
      const body = await get<{ achievements?: AchievementRecord[] }>(
        `/achievements/player/${encodeURIComponent(xuid)}/${encodeURIComponent(titleId)}`,
        "achievements",
      );
      if (body === "private") return "private";
      return (body?.achievements ?? []).map((a) => {
        const unlocked = a.progressState === "Achieved";
        const score = a.rewards?.find((r) => r.type === "Gamerscore")?.value;
        return {
          id: String(a.id),
          name: a.name,
          description: a.description || a.lockedDescription || null,
          iconUrl: a.mediaAssets?.find((m) => m.type === "Icon")?.url ?? null,
          hidden: a.isSecret ?? false,
          gamerscore: Number(score ?? 0) || 0,
          unlocked,
          unlockedAt: unlocked ? dateOrNull(a.progression?.timeUnlocked) : null,
          rarityPct: a.rarity?.currentPercentage ?? null,
        };
      });
    },
  };
}

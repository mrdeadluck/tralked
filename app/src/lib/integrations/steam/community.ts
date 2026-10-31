import { createPoliteFetch, isSteamCdnUrl, readJson, readText, type PoliteFetch } from "./polite-fetch";
import { decodeEntities } from "./text";
import type { SteamApi, SteamPlayerAchievement, SteamSchemaAchievement } from "./types";

const COMMUNITY = "https://steamcommunity.com";
const WEB_API = "https://api.steampowered.com";
/** MrDead_'s public profile: its per-game achievement pages double as the games' schema. */
export const DEFAULT_REFERENCE_STEAM_ID = "76561198012210783";
/** Global percentages also give the canonical apiName casing; kept briefly to avoid re-asking. */
const PERCENTAGES_TTL_MS = 60 * 60_000;

export type SteamCommunityConfig = {
  /** Public profile whose achievement pages are read as the schema of every game. */
  referenceSteamId?: string;
  /** Defaults to a throttled fetch (1.2 s per host, Tralked User-Agent, backoff on 429/5xx). */
  fetch?: PoliteFetch;
  now?: () => number;
};

// ---------- Minimal XML reading (Steam's community XML is flat and CDATA-wrapped) ----------

/**
 * A SteamID64 of an individual account (what profile URLs and vanity lookups must give):
 * 76561197960265728 + a 32-bit account number, so 76561197960265729..76561202255233023. New ids
 * will soon roll past 76561199999999999 into 765612…, which a fixed 7656119 prefix would refuse.
 */
export const STEAM_ID64 = /^76561(?:19[7-9]|20[0-2])\d{9}$/;

/** Text of the first `<name>` element in `xml` (CDATA or escaped text), or undefined. */
export function xmlTag(xml: string, name: string): string | undefined {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  if (!match) return undefined;
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(match[1]);
  return cdata ? cdata[1] : decodeEntities(match[1].trim());
}

export type CommunityAchievement = {
  apiName: string;
  name: string;
  description?: string;
  iconUrl?: string;
  unlockedAt: Date | null;
};

const cdnUrl = (url: string | undefined) => (isSteamCdnUrl(url) ? url : undefined);

export type ParsedAchievementPage =
  | { status: "private" }
  | { status: "unavailable" }
  | { status: "ok"; achievements: CommunityAchievement[] };

/** Parses `/stats/<app>/achievements/?xml=1`. Apinames come lowercased from Steam. */
export function parseAchievementPage(xml: string): ParsedAchievementPage {
  const error = xmlTag(xml, "error");
  if (error !== undefined) return /private/i.test(error) ? { status: "private" } : { status: "unavailable" };
  if (!xml.includes("<playerstats")) return { status: "unavailable" };
  const privacy = xmlTag(xml, "privacyState");
  if (privacy !== undefined && privacy !== "public") return { status: "private" };

  const achievements: CommunityAchievement[] = [];
  for (const [, attributes, body] of xml.matchAll(/<achievement(\s[^>]*)?>([\s\S]*?)<\/achievement>/g)) {
    const apiName = xmlTag(body, "apiname");
    const name = xmlTag(body, "name");
    if (!apiName || !name) continue;
    const timestamp = Number(xmlTag(body, "unlockTimestamp") ?? 0);
    const closed = /closed="1"/.test(attributes ?? "");
    achievements.push({
      apiName,
      name,
      description: xmlTag(body, "description") || undefined,
      // "Closed" is Steam's word for unlocked: the closed icon is the colored one. Only Steam CDN
      // URLs are kept (they are hotlinked as is).
      iconUrl: cdnUrl(xmlTag(body, "iconClosed")),
      unlockedAt: closed && timestamp > 0 ? new Date(timestamp * 1000) : null,
    });
  }
  return { status: "ok", achievements };
}

export type ParsedProfile = {
  steamId: string;
  personaName: string;
  avatarUrl: string;
  profilePublic: boolean;
};

/** Parses `/profiles/<id64>/?xml=1` (or `/id/<vanity>/?xml=1`). Null when the profile does not exist. */
export function parseProfile(xml: string): ParsedProfile | null {
  const steamId = xmlTag(xml, "steamID64");
  if (!steamId || !STEAM_ID64.test(steamId) || xmlTag(xml, "error") !== undefined) return null;
  return {
    steamId,
    personaName: xmlTag(xml, "steamID") ?? steamId,
    avatarUrl: cdnUrl(xmlTag(xml, "avatarFull")) ?? "",
    profilePublic: xmlTag(xml, "privacyState") === "public",
  };
}

// ---------- Adapter ----------

const profileBase = (steamId: string) => `${COMMUNITY}/profiles/${encodeURIComponent(steamId)}`;

/**
 * Steam without an API key: the public community XML pages and the keyless Web API endpoint.
 * - `getOwnedGames` is not available (the games list needs a login): returns `"unsupported"` and
 *   the sync probes the catalog's games instead.
 * - `getSchemaForGame` reads the achievement page of a public reference profile.
 * - Apinames are restored to Steam's own casing from the global percentages (the XML
 *   lowercases them), so rows match the ones the keyed client would write.
 */
export function createSteamCommunity(config: SteamCommunityConfig = {}): SteamApi & {
  resolveVanity(vanity: string): Promise<string | null>;
} {
  const referenceSteamId = config.referenceSteamId ?? DEFAULT_REFERENCE_STEAM_ID;
  const politeFetch = config.fetch ?? createPoliteFetch();
  const now = config.now ?? Date.now;
  const percentagesCache = new Map<number, { at: number; value: Promise<Record<string, number>> }>();

  async function getText(url: string): Promise<string> {
    const res = await politeFetch(url);
    if (!res.ok) throw new Error(`Steam community ${new URL(url).pathname} failed with HTTP ${res.status}`);
    return readText(res);
  }

  async function fetchPercentages(appId: number): Promise<Record<string, number>> {
    const url = `${WEB_API}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appId}`;
    const res = await politeFetch(url);
    // Apps without stats answer 403/404 (or 400 for unknown ids): no percentages.
    if (res.status === 400 || res.status === 403 || res.status === 404) return {};
    if (!res.ok) throw new Error(`Steam API global percentages failed with HTTP ${res.status}`);
    const data = await readJson<{
      achievementpercentages?: { achievements?: { name: string; percent: number | string }[] };
    }>(res);
    const result: Record<string, number> = {};
    for (const a of data.achievementpercentages?.achievements ?? []) result[a.name] = Number(a.percent);
    return result;
  }

  function percentages(appId: number): Promise<Record<string, number>> {
    const cached = percentagesCache.get(appId);
    if (cached && now() - cached.at < PERCENTAGES_TTL_MS) return cached.value;
    const value = fetchPercentages(appId);
    percentagesCache.set(appId, { at: now(), value });
    value.catch(() => percentagesCache.delete(appId));
    return value;
  }

  /** lowercase apiname → Steam's casing. */
  async function canonicalNames(appId: number): Promise<Map<string, string>> {
    const names = Object.keys(await percentages(appId));
    return new Map(names.map((name) => [name.toLowerCase(), name]));
  }

  /**
   * Reads one achievement page. Steam redirects some apps to a friendly name
   * (`/stats/TF2?tab=achievements`) and apps without stats to the profile itself.
   */
  async function achievementPage(steamId: string, appId: number): Promise<ParsedAchievementPage> {
    let url = `${profileBase(steamId)}/stats/${appId}/achievements/?xml=1`;
    for (let hop = 0; hop < 3; hop++) {
      const res = await politeFetch(url, { redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        const target = location ? new URL(location, url) : null;
        // Only Steam's own friendly-name redirect is followed (same host, https).
        const pinned = target?.protocol === "https:" && target.hostname === "steamcommunity.com";
        const stats = pinned ? target.pathname.match(/^(.*\/stats\/[^/]+)\/?(?:achievements\/?)?$/) : null;
        if (!target || !stats) return { status: "unavailable" };
        url = `${target.origin}${stats[1]}/achievements/?xml=1`;
        continue;
      }
      if (res.status === 404) return { status: "unavailable" };
      if (!res.ok) throw new Error(`Steam community achievements of app ${appId} failed with HTTP ${res.status}`);
      return parseAchievementPage(await readText(res));
    }
    return { status: "unavailable" };
  }

  return {
    async getPlayerSummary(steamId) {
      const profile = parseProfile(await getText(`${profileBase(steamId)}/?xml=1`));
      if (!profile) throw new Error(`Steam player ${steamId} not found`);
      return profile;
    },

    async getOwnedGames() {
      return "unsupported";
    },

    async getSchemaForGame(appId): Promise<SteamSchemaAchievement[]> {
      const page = await achievementPage(referenceSteamId, appId);
      if (page.status === "private") {
        throw new Error(`Steam reference profile ${referenceSteamId} is private`);
      }
      if (page.status !== "ok" || page.achievements.length === 0) return [];
      const canonical = await canonicalNames(appId);
      return page.achievements.map((a) => ({
        apiName: canonical.get(a.apiName.toLowerCase()) ?? a.apiName,
        name: a.name,
        description: a.description,
        iconUrl: a.iconUrl,
        // The public page does not say which achievements are hidden.
        hidden: false,
      }));
    },

    async getGlobalAchievementPercentages(appId) {
      return { ...(await percentages(appId)) };
    },

    async getPlayerAchievements(steamId, appId): Promise<SteamPlayerAchievement[] | "private"> {
      const page = await achievementPage(steamId, appId);
      if (page.status === "private") return "private";
      if (page.status !== "ok" || page.achievements.length === 0) return [];
      const canonical = await canonicalNames(appId);
      return page.achievements.map((a) => ({
        apiName: canonical.get(a.apiName.toLowerCase()) ?? a.apiName,
        unlockedAt: a.unlockedAt,
      }));
    },

    /** SteamID64 of a custom profile URL (`/id/<vanity>`), or null when it does not exist. */
    async resolveVanity(vanity) {
      const xml = await getText(`${COMMUNITY}/id/${encodeURIComponent(vanity)}/?xml=1`);
      return parseProfile(xml)?.steamId ?? null;
    },
  };
}

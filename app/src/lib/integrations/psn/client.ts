import type { TrophyTier } from "@/lib/engine/trophies";
import { timeoutSignal } from "../http";
import type { PsnApi, PsnPlayedGame, PsnProfile, PsnServiceName, PsnTitle, PsnTrophy } from "./types";

/**
 * Unofficial PlayStation Network client (the endpoints the PlayStation App uses, as documented
 * by the psn-api project). It authenticates as Tralked's own service account: the account's
 * NPSSO cookie is exchanged server-side for an access/refresh token pair, which is cached in
 * memory and refreshed when it expires. Users never hand over credentials.
 *
 * Errors only ever carry the endpoint name and HTTP status: never the NPSSO or a token.
 */

const AUTH_BASE = "https://ca.account.sony.com/api/authz/v3/oauth";
const LEGACY_PROFILE_BASE = "https://us-prof.np.community.playstation.net/userProfile/v1/users";
const TROPHY_BASE = "https://m.np.playstation.com/api/trophy/v1";
const GAMELIST_BASE = "https://m.np.playstation.com/api/gamelist/v2";
const PLAYED_PAGE_SIZE = 200;
/** Store title ids per `titles/trophyTitles` request: PSN answers 400 past five. */
const TITLE_LISTS_BATCH = 5;
/** Safety stop for the played-games pagination (200 × 50 = 10k games). */
const MAX_PLAYED_PAGES = 50;
// Public client id/secret of the PlayStation App (not secrets of Tralked).
const CLIENT_ID = "09515159-7237-4370-9b40-3806e67c0891";
const CLIENT_BASIC =
  "Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=";
const REDIRECT_URI = "com.scee.psxandroid.scecompcall://redirect";
const SCOPE = "psn:mobile.v2.core psn:clientapp";
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const TITLES_PAGE_SIZE = 800;
const PROFILE_FIELDS = "npId,onlineId,accountId,avatarUrls,aboutMe";

export type PsnClientConfig = {
  npsso: string;
  fetch?: typeof fetch;
  /** Injectable for tests. */
  now?: () => number;
};

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
};

type Counts = Partial<Record<TrophyTier, number>>;

type TitleRecord = {
  npCommunicationId: string;
  npServiceName?: string;
  trophyTitleName: string;
  trophyTitlePlatform?: string;
  progress?: number;
  definedTrophies?: Counts;
  earnedTrophies?: Counts;
  lastUpdatedDateTime?: string;
};

type TrophyDefinition = {
  trophyId: number;
  trophyHidden?: boolean;
  trophyType: string;
  trophyName?: string;
  trophyDetail?: string;
  trophyIconUrl?: string;
};

type EarnedRecord = {
  trophyId: number;
  earned?: boolean;
  earnedDateTime?: string;
  trophyEarnedRate?: string;
};

const TIERS: TrophyTier[] = ["bronze", "silver", "gold", "platinum"];

const tierOf = (type: string): TrophyTier =>
  (TIERS as string[]).includes(type) ? (type as TrophyTier) : "bronze";

const counts = (c: Counts | undefined): Record<TrophyTier, number> => ({
  bronze: c?.bronze ?? 0,
  silver: c?.silver ?? 0,
  gold: c?.gold ?? 0,
  platinum: c?.platinum ?? 0,
});

const dateOrNull = (value: string | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const rateOrNull = (value: string | undefined) => {
  if (value === undefined || value === "") return null;
  const pct = Number(value);
  return Number.isFinite(pct) ? pct : null;
};

type PlayedRecord = {
  titleId?: string;
  name?: string;
  localizedName?: string;
  category?: string;
  playDuration?: string;
  firstPlayedDateTime?: string;
  lastPlayedDateTime?: string;
  concept?: { id?: number; name?: string; titleIds?: unknown[] };
};

type TitleListsRecord = {
  titles?: { npTitleId?: string; trophyTitles?: { npCommunicationId?: string }[] }[];
};

/**
 * Minutes of an ISO 8601 duration as PSN writes `playDuration` ("PT228H56M33S", "P1DT2H"), rounded
 * down; null when it cannot be read.
 */
export function parsePlayDuration(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value.trim());
  if (!match || value.trim() === "P" || value.trim() === "PT") return null;
  const [, days, hours, minutes, seconds] = match;
  const total =
    Number(days ?? 0) * 1440 + Number(hours ?? 0) * 60 + Number(minutes ?? 0) + Number(seconds ?? 0) / 60;
  return Number.isFinite(total) ? Math.floor(total) : null;
}

export class PsnAuthError extends Error {
  /** `reason`: Sony's OAuth error code (e.g. `login_required`), never the NPSSO or a token. */
  constructor(step: string, status?: number, reason?: string) {
    super(`PSN authentication failed at ${step}${status ? ` (HTTP ${status})` : ""}${reason ? `: ${reason}` : ""}`);
    this.name = "PsnAuthError";
  }
}

export function createPsnClient({
  npsso,
  fetch: fetchImpl = globalThis.fetch,
  now = Date.now,
}: PsnClientConfig): PsnApi {
  let tokens: { access: string; expiresAt: number; refresh: string; refreshExpiresAt: number } | null =
    null;
  // One authentication at a time: concurrent callers share the in-flight request.
  let pending: Promise<string> | null = null;

  async function requestTokens(form: Record<string, string>, step: string): Promise<void> {
    const res = await fetchImpl(`${AUTH_BASE}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: CLIENT_BASIC,
      },
      body: new URLSearchParams(form).toString(),
      signal: timeoutSignal(),
    });
    if (!res.ok) throw new PsnAuthError(step, res.status);
    const data = (await res.json()) as TokenResponse;
    tokens = {
      access: data.access_token,
      expiresAt: now() + data.expires_in * 1000 - TOKEN_EXPIRY_MARGIN_MS,
      refresh: data.refresh_token,
      refreshExpiresAt: now() + data.refresh_token_expires_in * 1000 - TOKEN_EXPIRY_MARGIN_MS,
    };
  }

  async function loginWithNpsso(): Promise<void> {
    const url = new URL(`${AUTH_BASE}/authorize`);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPE);
    const res = await fetchImpl(url.toString(), {
      headers: { Cookie: `npsso=${npsso}` },
      redirect: "manual",
      signal: timeoutSignal(),
    });
    const location = res.headers.get("location") ?? "";
    const query = new URLSearchParams(location.includes("?") ? location.split("?")[1] : "");
    const code = query.get("code");
    // No code: the NPSSO expired or is invalid (a new one must be put in PSN_NPSSO). Sony's error
    // code (only word characters kept) says which.
    if (!code) throw new PsnAuthError("authorize", res.status, query.get("error")?.replace(/\W/g, "").slice(0, 40) || undefined);
    await requestTokens(
      {
        code,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
        token_format: "jwt",
      },
      "token",
    );
  }

  async function authenticate(): Promise<string> {
    if (tokens && now() < tokens.refreshExpiresAt) {
      try {
        await requestTokens(
          {
            refresh_token: tokens.refresh,
            grant_type: "refresh_token",
            token_format: "jwt",
            scope: SCOPE,
          },
          "refresh",
        );
        return tokens.access;
      } catch {
        // Refresh token revoked: fall back to a fresh NPSSO login below.
        tokens = null;
      }
    }
    await loginWithNpsso();
    return tokens!.access;
  }

  async function accessToken(): Promise<string> {
    if (tokens && now() < tokens.expiresAt) return tokens.access;
    pending ??= authenticate().finally(() => {
      pending = null;
    });
    return pending;
  }

  /** GET with the service account's token; 403 means the user's data is private. */
  async function get<T>(url: string, what: string): Promise<T | "private" | null> {
    const token = await accessToken();
    const res = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Accept-Language": "pt-BR",
      },
      signal: timeoutSignal(),
    });
    if (res.status === 403) {
      const body = await res.text().catch(() => "");
      // Sony's reason (an error code and message, no personal data) tells privacy from other refusals.
      console.warn(`PSN ${what}: HTTP 403 ${body.slice(0, 200)}`);
      return "private";
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`PSN ${what} failed with HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  const serviceQuery = (serviceName: PsnServiceName) =>
    // `trophy2` (PS5) is the API default; PS3/PS4/Vita sets must ask for `trophy`.
    serviceName === "trophy" ? "?npServiceName=trophy" : "";

  return {
    async findProfile(onlineId): Promise<PsnProfile | null> {
      const url = new URL(`${LEGACY_PROFILE_BASE}/${encodeURIComponent(onlineId)}/profile2`);
      url.searchParams.set("fields", PROFILE_FIELDS);
      const body = await get<{
        profile?: {
          accountId: string;
          onlineId: string;
          aboutMe?: string;
          avatarUrls?: { size: string; avatarUrl: string }[];
        };
      }>(url.toString(), "profile");
      if (body === null || body === "private" || !body.profile) return null;
      const { profile } = body;
      // The trophy list is what sync reads: probe it to tell the user up front.
      const probe = await get<unknown>(
        `${TROPHY_BASE}/users/${profile.accountId}/trophyTitles?limit=1`,
        "trophy titles",
      );
      const avatars = profile.avatarUrls ?? [];
      return {
        accountId: profile.accountId,
        onlineId: profile.onlineId,
        aboutMe: profile.aboutMe ?? "",
        avatarUrl: avatars.at(-1)?.avatarUrl ?? null,
        isPrivate: probe === "private",
      };
    },

    async getTitles(accountId): Promise<PsnTitle[] | "private"> {
      const titles: PsnTitle[] = [];
      for (let offset = 0; ; ) {
        const page = await get<{ trophyTitles?: TitleRecord[]; nextOffset?: number }>(
          `${TROPHY_BASE}/users/${encodeURIComponent(accountId)}/trophyTitles?limit=${TITLES_PAGE_SIZE}&offset=${offset}`,
          "trophy titles",
        );
        if (page === "private") return "private";
        if (page === null) return titles;
        for (const t of page.trophyTitles ?? []) {
          titles.push({
            npTitleId: t.npCommunicationId,
            serviceName: t.npServiceName === "trophy" ? "trophy" : "trophy2",
            name: t.trophyTitleName,
            platform: t.trophyTitlePlatform ?? "",
            progress: t.progress ?? 0,
            trophyCounts: counts(t.definedTrophies),
            earnedCounts: counts(t.earnedTrophies),
            lastPlayed: dateOrNull(t.lastUpdatedDateTime),
          });
        }
        if (!page.nextOffset || page.nextOffset <= offset) return titles;
        offset = page.nextOffset;
      }
    },

    async getTrophies(accountId, npTitleId, serviceName): Promise<PsnTrophy[] | "private"> {
      const title = encodeURIComponent(npTitleId);
      const query = serviceQuery(serviceName);
      const definitions = await get<{ trophies?: TrophyDefinition[] }>(
        `${TROPHY_BASE}/npCommunicationIds/${title}/trophyGroups/all/trophies${query}`,
        "title trophies",
      );
      if (definitions === "private") return "private";
      const earned = await get<{ trophies?: EarnedRecord[] }>(
        `${TROPHY_BASE}/users/${encodeURIComponent(accountId)}/npCommunicationIds/${title}/trophyGroups/all/trophies${query}`,
        "earned trophies",
      );
      if (earned === "private") return "private";
      const earnedById = new Map((earned?.trophies ?? []).map((t) => [t.trophyId, t]));
      return (definitions?.trophies ?? []).map((d) => {
        const mine = earnedById.get(d.trophyId);
        const isEarned = mine?.earned === true;
        return {
          trophyId: String(d.trophyId),
          name: d.trophyName ?? `Troféu ${d.trophyId}`,
          description: d.trophyDetail ?? null,
          iconUrl: d.trophyIconUrl ?? null,
          hidden: d.trophyHidden ?? false,
          tier: tierOf(d.trophyType),
          earned: isEarned,
          earnedAt: isEarned ? dateOrNull(mine?.earnedDateTime) : null,
          rarityPct: rateOrNull(mine?.trophyEarnedRate),
        };
      });
    },

    async getPlayedGames(accountId): Promise<PsnPlayedGame[] | "private"> {
      const games: PsnPlayedGame[] = [];
      for (let page = 0, offset = 0; page < MAX_PLAYED_PAGES; page++) {
        const url = new URL(`${GAMELIST_BASE}/users/${encodeURIComponent(accountId)}/titles`);
        url.searchParams.set("categories", "ps4_game,ps5_native_game");
        url.searchParams.set("limit", String(PLAYED_PAGE_SIZE));
        url.searchParams.set("offset", String(offset));
        const body = await get<{ titles?: PlayedRecord[]; nextOffset?: number }>(url.toString(), "played games");
        if (body === "private") return "private";
        if (body === null) return games;
        for (const t of body.titles ?? []) {
          const playtimeMin = parsePlayDuration(t.playDuration);
          const name = (t.localizedName || t.name || t.concept?.name || "").trim();
          if (!t.titleId || !name || playtimeMin === null) continue;
          games.push({
            titleId: t.titleId,
            name,
            category: t.category ?? "unknown",
            playtimeMin,
            firstPlayedAt: dateOrNull(t.firstPlayedDateTime),
            lastPlayedAt: dateOrNull(t.lastPlayedDateTime),
            conceptId: typeof t.concept?.id === "number" && Number.isInteger(t.concept.id) ? t.concept.id : null,
            conceptTitleIds: (t.concept?.titleIds ?? []).filter((id): id is string => typeof id === "string" && id !== ""),
          });
        }
        if (!body.nextOffset || body.nextOffset <= offset) return games;
        offset = body.nextOffset;
      }
      return games;
    },

    async getTrophyListsOfTitles(accountId, titleIds): Promise<Map<string, string[]> | "private"> {
      const lists = new Map<string, string[]>();
      const ask = (ids: string[]) =>
        get<TitleListsRecord>(
          `${TROPHY_BASE}/users/${encodeURIComponent(accountId)}/titles/trophyTitles?npTitleIds=${ids.map(encodeURIComponent).join(",")}`,
          "title trophy lists",
        );
      const keep = (ids: string[], body: TitleListsRecord | null) => {
        for (const id of ids) lists.set(id, []);
        for (const t of body?.titles ?? []) {
          if (!t.npTitleId || !lists.has(t.npTitleId)) continue;
          const ids = (t.trophyTitles ?? []).flatMap((l) => (l.npCommunicationId ? [l.npCommunicationId] : []));
          lists.set(t.npTitleId, [...new Set(ids)]);
        }
      };
      const unique = [...new Set(titleIds)];
      for (let i = 0; i < unique.length; i += TITLE_LISTS_BATCH) {
        const batch = unique.slice(i, i + TITLE_LISTS_BATCH);
        const body = await ask(batch);
        if (body === "private") return "private";
        // One id PSN does not know for this player fails the whole batch with 404: ask one by one,
        // and an id that is 404 on its own has no list.
        if (body !== null || batch.length === 1) {
          keep(batch, body);
          continue;
        }
        for (const id of batch) {
          const one = await ask([id]);
          if (one === "private") return "private";
          keep([id], one);
        }
      }
      return lists;
    },
  };
}

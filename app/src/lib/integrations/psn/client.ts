import type { TrophyTier } from "@/lib/engine/trophies";
import { timeoutSignal } from "../http";
import type { PsnApi, PsnProfile, PsnServiceName, PsnTitle, PsnTrophy } from "./types";

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

export class PsnAuthError extends Error {
  constructor(step: string, status?: number) {
    super(`PSN authentication failed at ${step}${status ? ` (HTTP ${status})` : ""}`);
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
    const code = location.includes("?") ? new URLSearchParams(location.split("?")[1]).get("code") : null;
    // No code: the NPSSO expired or is invalid (a new one must be put in PSN_NPSSO).
    if (!code) throw new PsnAuthError("authorize", res.status);
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
    if (res.status === 403) return "private";
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
  };
}

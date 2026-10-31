import { parseProfile, STEAM_ID64, xmlTag } from "./community";
import { STEAM_FIXTURE_PROFILES } from "./fixture";
import { steamMode } from "./index";
import { createPoliteFetch, readText, type PoliteFetch } from "./polite-fetch";
import { decodeEntities } from "./text";

/**
 * Public Steam profile as the connection check reads it: the code the user pasted in the profile
 * "Resumo" (summary). The Web API has no summary, so this always reads the community XML
 * (`/profiles/<id>/?xml=1` or `/id/<vanity>/?xml=1`), with or without STEAM_API_KEY. Offline
 * (STEAM_MODE=fixture) it reads STEAM_FIXTURE_PROFILES.
 */

const COMMUNITY = "https://steamcommunity.com";

export type SteamProfileRef = { kind: "id"; steamId: string } | { kind: "vanity"; vanity: string };

export type SteamPublicProfile = {
  steamId: string;
  personaName: string;
  /** The "Resumo" as plain text. */
  summary: string;
  profilePublic: boolean;
};

export type SteamProfileLookup = { find(ref: SteamProfileRef): Promise<SteamPublicProfile | null> };

/** Steam custom URL names: letters, digits, `_` and `-`. */
const VANITY = /^[A-Za-z0-9_-]{2,32}$/;
const PROFILE_URL = /^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/(profiles|id)\/([^/?#\s]+)(?:[/?#]\S*)?$/i;

/** A profile link (`/profiles/<id>` or `/id/<name>`), a SteamID64 or a custom URL name; null otherwise. */
export function parseSteamProfileInput(input: string): SteamProfileRef | null {
  const value = input.trim();
  const url = PROFILE_URL.exec(value);
  if (url) {
    const [, kind, part] = url;
    if (kind.toLowerCase() === "profiles") return STEAM_ID64.test(part) ? { kind: "id", steamId: part } : null;
    return VANITY.test(part) ? { kind: "vanity", vanity: part } : null;
  }
  if (STEAM_ID64.test(value)) return { kind: "id", steamId: value };
  if (/^https?:|\//i.test(value)) return null;
  return VANITY.test(value) ? { kind: "vanity", vanity: value } : null;
}

/** What is stored while the link is pending (and read back by parseSteamProfileInput). */
export const steamProfileHandle = (ref: SteamProfileRef) => (ref.kind === "id" ? ref.steamId : ref.vanity);

/** The profile's "Resumo" as plain text: Steam sends it as HTML inside CDATA. */
export function parseProfileSummary(xml: string): string {
  const html = xmlTag(xml, "summary") ?? "";
  const text = decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " "));
  return text.replace(/\s+/g, " ").trim();
}

export function createCommunityProfileLookup({ fetch }: { fetch?: PoliteFetch } = {}): SteamProfileLookup {
  // One quick retry: the user is waiting on the confirmation.
  const politeFetch = fetch ?? createPoliteFetch({ retries: 1, backoffMs: 2000 });
  return {
    async find(ref) {
      const url =
        ref.kind === "id"
          ? `${COMMUNITY}/profiles/${encodeURIComponent(ref.steamId)}/?xml=1`
          : `${COMMUNITY}/id/${encodeURIComponent(ref.vanity)}/?xml=1`;
      const res = await politeFetch(url);
      if (!res.ok) throw new Error(`Steam community profile failed with HTTP ${res.status}`);
      const xml = await readText(res);
      const profile = parseProfile(xml);
      if (!profile) return null;
      return {
        steamId: profile.steamId,
        personaName: profile.personaName,
        summary: parseProfileSummary(xml),
        profilePublic: profile.profilePublic,
      };
    },
  };
}

export function createFixtureProfileLookup(): SteamProfileLookup {
  return {
    async find(ref) {
      const found = STEAM_FIXTURE_PROFILES.find((p) =>
        ref.kind === "id" ? p.steamId === ref.steamId : p.vanity.toLowerCase() === ref.vanity.toLowerCase(),
      );
      if (!found) return null;
      return {
        steamId: found.steamId,
        personaName: found.personaName,
        summary: parseProfileSummary(`<summary><![CDATA[${found.summary}]]></summary>`),
        profilePublic: found.profilePublic,
      };
    },
  };
}

let instance: SteamProfileLookup | undefined;

/** Fixture with STEAM_MODE=fixture (tests, e2e), otherwise Steam's public profile pages. */
export function getSteamProfileLookup(): SteamProfileLookup {
  instance ??= steamMode() === "fixture" ? createFixtureProfileLookup() : createCommunityProfileLookup();
  return instance;
}

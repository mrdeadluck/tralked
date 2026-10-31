import { getPsn, getRetro, getSteam, getXbox } from "@/lib/integrations";
import { steamMode } from "@/lib/integrations/steam";
import { getSteamProfileLookup, parseSteamProfileInput } from "@/lib/integrations/steam/profile-lookup";
import type { CodePlatform } from "@/lib/sync/platform-library";

/** Platforms connected on /conta/conexoes: Steam, PSN, Xbox and RetroAchievements. */
export type LinkPlatform = CodePlatform | "steam";

/** A public profile as the connection (and a claim's code check) sees it. */
export type PlatformProfile = {
  /** SteamID64, PSN accountId, Xbox XUID, RA ULID: stable, used as LinkedAccount.externalId. */
  externalId: string;
  /** Canonical display name (Steam persona name, PSN online id, gamertag, RA username). */
  handle: string;
  /** The free text where the user pastes the code: Steam "Resumo", PSN "Sobre mim", Xbox bio, RA motto. */
  text: string;
  /**
   * The trophies/achievements are hidden from the service account, so sync cannot read them
   * (Steam: the profile, or with the Web API key its game details, is not public).
   */
  isPrivate: boolean;
};

/** Reads a profile through the platform's service account; null when the handle does not exist. */
export async function lookupProfile(
  platform: LinkPlatform,
  handle: string,
): Promise<PlatformProfile | null> {
  switch (platform) {
    case "steam": {
      // The public community profile (no service account needed); its summary is the "Resumo".
      const ref = parseSteamProfileInput(handle);
      const profile = ref ? await getSteamProfileLookup().find(ref) : null;
      if (!profile) return null;
      // "Detalhes de jogos" can only be checked with the Web API key (an empty answer means
      // private); without it, the first sync finds out and the connection shows the privacy help.
      const gamesPrivate =
        profile.profilePublic && steamMode() === "api" && (await getSteam().getOwnedGames(profile.steamId)) === "private";
      return {
        externalId: profile.steamId,
        handle: profile.personaName,
        text: profile.summary,
        isPrivate: !profile.profilePublic || gamesPrivate,
      };
    }
    case "psn": {
      const profile = await getPsn().findProfile(handle);
      return profile
        ? {
            externalId: profile.accountId,
            handle: profile.onlineId,
            text: profile.aboutMe,
            isPrivate: profile.isPrivate,
          }
        : null;
    }
    case "xbox": {
      const xbox = getXbox();
      const profile = await xbox.findProfile(handle);
      if (!profile) return null;
      const titles = await xbox.getTitles(profile.xuid);
      return {
        externalId: profile.xuid,
        handle: profile.gamertag,
        text: profile.bio,
        isPrivate: titles === "private",
      };
    }
    case "retro": {
      const profile = await getRetro().findProfile(handle);
      // RetroAchievements progress is always public.
      return profile
        ? { externalId: profile.ulid, handle: profile.user, text: profile.motto, isPrivate: false }
        : null;
    }
  }
}

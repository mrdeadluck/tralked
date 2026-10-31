import { getPsn, getRetro, getXbox } from "@/lib/integrations";
import { getSteamProfileLookup, parseSteamProfileInput } from "@/lib/integrations/steam/profile-lookup";
import type { CodePlatform } from "@/lib/sync/platform-library";

/** Platforms linked with a code pasted in the profile: PSN, Xbox, RetroAchievements and Steam. */
export type LinkPlatform = CodePlatform | "steam";

/** A public profile as the link verification sees it. */
export type PlatformProfile = {
  /** SteamID64, PSN accountId, Xbox XUID, RA ULID: stable, used as LinkedAccount.externalId. */
  externalId: string;
  /** Canonical display name (Steam persona name, PSN online id, gamertag, RA username). */
  handle: string;
  /** The free text where the user pastes the code: Steam "Resumo", PSN "Sobre mim", Xbox bio, RA motto. */
  text: string;
  /** The trophies/achievements are hidden from the service account, so sync cannot read them. */
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
      return profile
        ? {
            externalId: profile.steamId,
            handle: profile.personaName,
            text: profile.summary,
            isPrivate: !profile.profilePublic,
          }
        : null;
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

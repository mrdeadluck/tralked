import { getPsn, getRetro, getXbox } from "@/lib/integrations";
import type { CodePlatform } from "@/lib/sync/platform-library";

/** A public profile as the link verification sees it. */
export type PlatformProfile = {
  /** PSN accountId, Xbox XUID, RA ULID: stable, used as LinkedAccount.externalId. */
  externalId: string;
  /** Canonical display name (PSN online id, gamertag, RA username). */
  handle: string;
  /** The free text where the user pastes the code: PSN "Sobre mim", Xbox bio, RA motto. */
  text: string;
  /** The trophies/achievements are hidden from the service account, so sync cannot read them. */
  isPrivate: boolean;
};

/** Reads a profile through the platform's service account; null when the handle does not exist. */
export async function lookupProfile(
  platform: CodePlatform,
  handle: string,
): Promise<PlatformProfile | null> {
  switch (platform) {
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

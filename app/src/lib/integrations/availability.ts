import { env, hasKey } from "@/lib/env";

/**
 * PSN, Xbox and RetroAchievements are read through a Tralked service account (a credential in
 * the server's env). Without it, development and the test suites use offline fixtures; production
 * never does: a fixture there would link and pay XP for made-up accounts. The connections page
 * shows such a platform as "Em breve" and the sync skips it.
 */

export type KeyedPlatform = "psn" | "xbox" | "retro";

export class PlatformNotConfiguredError extends Error {
  constructor(readonly platform: KeyedPlatform) {
    super(`No ${platform} credential is configured (offline fixtures are not used in production)`);
    this.name = "PlatformNotConfiguredError";
  }
}

/**
 * Fixtures may stand in for a missing credential: outside production, or in production only with
 * the explicit test mode `PLATFORM_FIXTURES=1` (never set on a real deployment).
 */
export function fixturesAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.PLATFORM_FIXTURES?.trim() === "1";
}

/** The platform's service-account credential is set (RA_USERNAME is optional for the RA Web API). */
export function platformCredential(platform: KeyedPlatform): string | undefined {
  switch (platform) {
    case "psn":
      return hasKey("PSN_NPSSO") ? env.PSN_NPSSO : undefined;
    case "xbox":
      return hasKey("XBOX_OPENXBL_KEY") ? env.XBOX_OPENXBL_KEY : undefined;
    case "retro":
      return hasKey("RA_API_KEY") ? env.RA_API_KEY : undefined;
  }
}

/** True when the platform can be read now: with its credential, or on fixtures where allowed. */
export function platformAvailable(platform: KeyedPlatform): boolean {
  return Boolean(platformCredential(platform)) || fixturesAllowed();
}

/** Real client with the credential, otherwise the fixture where allowed; throws in production. */
export function pickClient<T>(platform: KeyedPlatform, real: (credential: string) => T, fixture: () => T): T {
  const credential = platformCredential(platform);
  if (credential) return real(credential);
  if (fixturesAllowed()) return fixture();
  throw new PlatformNotConfiguredError(platform);
}

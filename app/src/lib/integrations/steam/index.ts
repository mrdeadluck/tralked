import { env, hasKey } from "@/lib/env";
import { createSteamClient } from "./client";
import { createSteamFixture } from "./fixture";
import type { SteamApi } from "./types";

export type * from "./types";

let instance: SteamApi | undefined;

/**
 * Real Steam client when STEAM_API_KEY is set, otherwise the offline fixture.
 * Memoized per process, so every caller shares one client (and its token cache / rate limiter).
 */
export function getSteam(): SteamApi {
  instance ??= hasKey("STEAM_API_KEY") && env.STEAM_API_KEY
    ? createSteamClient({ apiKey: env.STEAM_API_KEY })
    : createSteamFixture();
  return instance;
}

/** Tests only: forgets the memoized client. */
export function resetSteam(): void {
  instance = undefined;
}

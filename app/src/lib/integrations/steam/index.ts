import { env, hasKey } from "@/lib/env";
import { createSteamClient } from "./client";
import { createSteamFixture } from "./fixture";
import type { SteamApi } from "./types";

export type * from "./types";

/** Real Steam client when STEAM_API_KEY is set, otherwise the offline fixture. */
export function getSteam(): SteamApi {
  return hasKey("STEAM_API_KEY") && env.STEAM_API_KEY
    ? createSteamClient({ apiKey: env.STEAM_API_KEY })
    : createSteamFixture();
}

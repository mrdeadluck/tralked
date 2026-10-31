import { env, hasKey } from "@/lib/env";
import { createSteamClient } from "./client";
import { createSteamCommunity } from "./community";
import { createSteamFixture } from "./fixture";
import type { SteamApi } from "./types";

export type * from "./types";

/** `api`: Web API with STEAM_API_KEY; `community`: public pages, no key; `fixture`: offline JSON. */
export type SteamMode = "api" | "community" | "fixture";

/**
 * Real key > public community pages > fixture. Without a key, `STEAM_MODE=fixture` picks the
 * offline fixture instead of the network (the test suites and e2e set it); a configured key
 * always wins, so tests that mock a key still get the real client.
 */
export function steamMode(): SteamMode {
  if (hasKey("STEAM_API_KEY")) return "api";
  return process.env.STEAM_MODE?.trim() === "fixture" ? "fixture" : "community";
}

let instance: SteamApi | undefined;

/**
 * The Steam adapter picked by `steamMode()`. Memoized per process, so every caller shares one
 * client (and its throttle / caches).
 */
export function getSteam(): SteamApi {
  if (!instance) {
    const mode = steamMode();
    instance =
      mode === "api" && env.STEAM_API_KEY
        ? createSteamClient({ apiKey: env.STEAM_API_KEY })
        : mode === "fixture"
          ? createSteamFixture()
          : createSteamCommunity();
  }
  return instance;
}

/** Tests only: forgets the memoized client. */
export function resetSteam(): void {
  instance = undefined;
}

import { env } from "@/lib/env";
import { pickClient } from "../availability";
import { createRetroClient } from "./client";
import { createRetroFixture } from "./fixture";
import type { RetroApi } from "./types";

export type * from "./types";

let instance: RetroApi | undefined;

/**
 * Real RetroAchievements client when RA_API_KEY is set (RA_USERNAME goes along when present);
 * otherwise the offline fixture outside production, and PlatformNotConfiguredError in production
 * (see ../availability.ts).
 */
export function getRetro(): RetroApi {
  instance ??= pickClient("retro", (apiKey) => createRetroClient({ apiKey, username: env.RA_USERNAME }), createRetroFixture);
  return instance;
}

/** Tests only: forgets the memoized client. */
export function resetRetro(): void {
  instance = undefined;
}

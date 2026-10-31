import { env, hasKey } from "@/lib/env";
import { createRetroClient } from "./client";
import { createRetroFixture } from "./fixture";
import type { RetroApi } from "./types";

export type * from "./types";

let instance: RetroApi | undefined;

/** Real RetroAchievements client when RA_API_KEY is set, otherwise the offline fixture. */
export function getRetro(): RetroApi {
  instance ??= hasKey("RA_API_KEY") && env.RA_API_KEY
    ? createRetroClient({ apiKey: env.RA_API_KEY, username: env.RA_USERNAME })
    : createRetroFixture();
  return instance;
}

/** Tests only: forgets the memoized client. */
export function resetRetro(): void {
  instance = undefined;
}

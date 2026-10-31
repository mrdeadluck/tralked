import { env, hasKey } from "@/lib/env";
import { createRawgClient } from "./client";
import { createRawgFixture } from "./fixture";
import type { RawgApi } from "./types";

export type * from "./types";

let instance: RawgApi | undefined;

/**
 * Real RAWG client when RAWG_API_KEY is set, otherwise the offline fixture.
 * Memoized per process, so every caller shares one client (and its token cache / rate limiter).
 */
export function getRawg(): RawgApi {
  instance ??= hasKey("RAWG_API_KEY") && env.RAWG_API_KEY
    ? createRawgClient({ apiKey: env.RAWG_API_KEY })
    : createRawgFixture();
  return instance;
}

/** Tests only: forgets the memoized client. */
export function resetRawg(): void {
  instance = undefined;
}

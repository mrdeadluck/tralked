import { env, hasKey } from "@/lib/env";
import { createSgdbClient } from "./client";
import { createSgdbFixture } from "./fixture";
import type { SgdbApi } from "./types";

export type * from "./types";

let instance: SgdbApi | undefined;

/**
 * Real SteamGridDB client when SGDB_API_KEY is set, otherwise the offline fixture.
 * Memoized per process, so every caller shares one client (and its token cache / rate limiter).
 */
export function getSgdb(): SgdbApi {
  instance ??= hasKey("SGDB_API_KEY") && env.SGDB_API_KEY
    ? createSgdbClient({ apiKey: env.SGDB_API_KEY })
    : createSgdbFixture();
  return instance;
}

/** Tests only: forgets the memoized client. */
export function resetSgdb(): void {
  instance = undefined;
}

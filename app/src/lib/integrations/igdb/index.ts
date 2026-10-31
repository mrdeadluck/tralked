import { env, hasKey } from "@/lib/env";
import { createIgdbClient } from "./client";
import { createIgdbFixture } from "./fixture";
import type { IgdbApi } from "./types";

export type * from "./types";

let instance: IgdbApi | undefined;

/**
 * Real IGDB client when Twitch credentials are set, otherwise the offline fixture.
 * Memoized per process, so every caller shares one client (and its token cache / rate limiter).
 */
export function getIgdb(): IgdbApi {
  instance ??= hasKey("IGDB_CLIENT_ID") && env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET
    ? createIgdbClient({
        clientId: env.IGDB_CLIENT_ID,
        clientSecret: env.IGDB_CLIENT_SECRET,
      })
    : createIgdbFixture();
  return instance;
}

/** Tests only: forgets the memoized client. */
export function resetIgdb(): void {
  instance = undefined;
}

import { env, hasKey } from "@/lib/env";
import { createIgdbClient } from "./client";
import { createIgdbFixture } from "./fixture";
import type { IgdbApi } from "./types";

export type * from "./types";

/** Real IGDB client when Twitch credentials are set, otherwise the offline fixture. */
export function getIgdb(): IgdbApi {
  return hasKey("IGDB_CLIENT_ID") && env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET
    ? createIgdbClient({
        clientId: env.IGDB_CLIENT_ID,
        clientSecret: env.IGDB_CLIENT_SECRET,
      })
    : createIgdbFixture();
}

import { env, hasKey } from "@/lib/env";
import { createSgdbClient } from "./client";
import { createSgdbFixture } from "./fixture";
import type { SgdbApi } from "./types";

export type * from "./types";

/** Real SteamGridDB client when SGDB_API_KEY is set, otherwise the offline fixture. */
export function getSgdb(): SgdbApi {
  return hasKey("SGDB_API_KEY") && env.SGDB_API_KEY
    ? createSgdbClient({ apiKey: env.SGDB_API_KEY })
    : createSgdbFixture();
}

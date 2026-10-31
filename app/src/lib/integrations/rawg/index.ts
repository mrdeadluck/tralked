import { env, hasKey } from "@/lib/env";
import { createRawgClient } from "./client";
import { createRawgFixture } from "./fixture";
import type { RawgApi } from "./types";

export type * from "./types";

/** Real RAWG client when RAWG_API_KEY is set, otherwise the offline fixture. */
export function getRawg(): RawgApi {
  return hasKey("RAWG_API_KEY") && env.RAWG_API_KEY
    ? createRawgClient({ apiKey: env.RAWG_API_KEY })
    : createRawgFixture();
}

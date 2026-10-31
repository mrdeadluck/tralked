import { env, hasKey } from "@/lib/env";
import { createPsnClient } from "./client";
import { createPsnFixture } from "./fixture";
import type { PsnApi } from "./types";

export type * from "./types";

let instance: PsnApi | undefined;

/**
 * Real PSN client when the service account's NPSSO is set, otherwise the offline fixture.
 * Memoized per process, so every caller shares one token cache.
 */
export function getPsn(): PsnApi {
  instance ??= hasKey("PSN_NPSSO") && env.PSN_NPSSO
    ? createPsnClient({ npsso: env.PSN_NPSSO })
    : createPsnFixture();
  return instance;
}

/** Tests only: forgets the memoized client. */
export function resetPsn(): void {
  instance = undefined;
}

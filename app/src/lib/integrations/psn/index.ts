import { pickClient } from "../availability";
import { createPsnClient } from "./client";
import { createPsnFixture } from "./fixture";
import type { PsnApi } from "./types";

export type * from "./types";

let instance: PsnApi | undefined;

/**
 * Real PSN client when the service account's NPSSO is set; otherwise the offline fixture outside
 * production, and PlatformNotConfiguredError in production (see ../availability.ts).
 * Memoized per process, so every caller shares one token cache.
 */
export function getPsn(): PsnApi {
  instance ??= pickClient("psn", (npsso) => createPsnClient({ npsso }), createPsnFixture);
  return instance;
}

/** Tests only: forgets the memoized client. */
export function resetPsn(): void {
  instance = undefined;
}

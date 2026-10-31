import { pickClient } from "../availability";
import { createXboxClient } from "./client";
import { createXboxFixture } from "./fixture";
import type { XboxApi } from "./types";

export type * from "./types";

let instance: XboxApi | undefined;

/**
 * Real OpenXBL client when XBOX_OPENXBL_KEY is set; otherwise the offline fixture outside
 * production, and PlatformNotConfiguredError in production (see ../availability.ts).
 */
export function getXbox(): XboxApi {
  instance ??= pickClient("xbox", (apiKey) => createXboxClient({ apiKey }), createXboxFixture);
  return instance;
}

/** Tests only: forgets the memoized client. */
export function resetXbox(): void {
  instance = undefined;
}

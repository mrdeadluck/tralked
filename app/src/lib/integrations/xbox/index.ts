import { env, hasKey } from "@/lib/env";
import { createXboxClient } from "./client";
import { createXboxFixture } from "./fixture";
import type { XboxApi } from "./types";

export type * from "./types";

let instance: XboxApi | undefined;

/** Real OpenXBL client when XBOX_OPENXBL_KEY is set, otherwise the offline fixture. */
export function getXbox(): XboxApi {
  instance ??= hasKey("XBOX_OPENXBL_KEY") && env.XBOX_OPENXBL_KEY
    ? createXboxClient({ apiKey: env.XBOX_OPENXBL_KEY })
    : createXboxFixture();
  return instance;
}

/** Tests only: forgets the memoized client. */
export function resetXbox(): void {
  instance = undefined;
}

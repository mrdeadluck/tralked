import { revalidateTag } from "next/cache";
import { HIGHSCORES_TAG } from "./cached";
import { notifyRankPassed } from "./passed";
import { takeRankSnapshots } from "./snapshot";

/**
 * Daily `highscores` cron: today's rank snapshot, the "@x te passou" notifications it implies
 * (one per player at most), then fresh boards (their arrows changed).
 */
export async function runHighscoresJob() {
  const { fresh, ...result } = await takeRankSnapshots();
  const passed = await notifyRankPassed(fresh);
  try {
    revalidateTag(HIGHSCORES_TAG, { expire: 0 });
  } catch (error) {
    // Outside a Next.js request (scripts) there is no cache to invalidate.
    console.warn("Could not revalidate the highscores cache", error instanceof Error ? error.message : error);
  }
  return { ...result, notified: passed.processed };
}

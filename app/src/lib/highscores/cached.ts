import { cacheLife, cacheTag } from "next/cache";
import { boardFromKey } from "./boards";
import { getBoardView, TOP_SIZE, type BoardView } from "./queries";

/** Cache tag of every highscores board (the daily snapshot and visibility changes invalidate it). */
export const HIGHSCORES_TAG = "highscores";

/**
 * The public top of one board with its rank arrows, cached for 15 min (`feed`): rankings move with
 * every sync, so a short life keeps them fresh without a query per visit. Keyed by `boardKey`.
 */
export async function getBoardCached(key: string): Promise<BoardView> {
  "use cache";
  cacheLife("feed");
  cacheTag(HIGHSCORES_TAG);
  const board = boardFromKey(key);
  if (!board) return { key, rows: [], snapshotDay: null };
  return getBoardView(board, TOP_SIZE);
}

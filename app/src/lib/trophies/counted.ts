import { versionKey } from "./lists";

type CountedRow = {
  achievement: {
    gameId: string;
    platform: string;
    apiName: string;
    list: { platform: string; console: string | null; externalId: string } | null;
  };
  /** Null: unlocked on an unknown date (a dated copy is preferred). */
  unlockedAt: Date | null;
};

/**
 * "Once per console": PSN unlocks are deduplicated by (gameId, versionKey(list), apiName), keeping
 * the earliest unlockedAt (the same trophy earned in two regional lists of one console counts
 * once). Steam, Xbox and RetroAchievements rows, and rows without a list, pass through unchanged.
 * Input order is preserved. Feeds attributes, missions and rank stats; the profile total does not
 * use it (it counts every unlock of every list).
 */
export function countedUnlocks<T extends CountedRow>(rows: T[]): T[] {
  const keyOf = (r: T): string | null =>
    r.achievement.platform === "psn" && r.achievement.list
      ? `${r.achievement.gameId}\u0000${versionKey(r.achievement.list)}\u0000${r.achievement.apiName}`
      : null;
  const earliest = new Map<string, T>();
  for (const r of rows) {
    const key = keyOf(r);
    if (key === null) continue;
    const best = earliest.get(key);
    if (!best || (r.unlockedAt?.getTime() ?? Infinity) < (best.unlockedAt?.getTime() ?? Infinity)) earliest.set(key, r);
  }
  return rows.filter((r) => {
    const key = keyOf(r);
    return key === null || earliest.get(key) === r;
  });
}

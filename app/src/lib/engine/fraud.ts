/**
 * Ids of unlocks that happened in a burst: at least `minCount` unlocks
 * within `windowSec` seconds of each other.
 */
export function findBursts(
  unlocks: { achievementId: string; unlockedAt: Date }[],
  windowSec = 60,
  minCount = 10,
): Set<string> {
  const sorted = [...unlocks].sort(
    (a, b) => a.unlockedAt.getTime() - b.unlockedAt.getTime(),
  );
  const flagged = new Set<string>();
  const windowMs = windowSec * 1000;
  let left = 0;
  for (let right = 0; right < sorted.length; right++) {
    while (
      sorted[right].unlockedAt.getTime() - sorted[left].unlockedAt.getTime() >
      windowMs
    ) {
      left++;
    }
    if (right - left + 1 >= minCount) {
      for (let i = left; i <= right; i++) flagged.add(sorted[i].achievementId);
    }
  }
  return flagged;
}

/** A completion with playtime under 5% of the average is suspicious. */
export function isSpeedPlatinum(
  playtimeMin: number,
  avgCompletionMin: number | null,
): boolean {
  return avgCompletionMin !== null && playtimeMin < 0.05 * avgCompletionMin;
}

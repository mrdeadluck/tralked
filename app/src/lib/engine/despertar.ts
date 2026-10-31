const MAX_STEPS = 12;

/**
 * Levels to show in the "Despertar" sequence between two attribute levels.
 * At most 12 steps, evenly sampled, always ending on `levelAfter`.
 */
export function despertarSteps(levelBefore: number, levelAfter: number): number[] {
  const gained = levelAfter - levelBefore;
  if (gained <= 0) return [];
  if (gained <= MAX_STEPS) {
    return Array.from({ length: gained }, (_, i) => levelBefore + i + 1);
  }
  return Array.from(
    { length: MAX_STEPS },
    (_, i) => levelBefore + Math.round(((i + 1) * gained) / MAX_STEPS),
  );
}

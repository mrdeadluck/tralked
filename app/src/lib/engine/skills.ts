import type { SkillState } from "./types";

/** Points needed to go from `level` to `level + 1`. */
export function skillNeed(level: number): number {
  return Math.round(120 * 1.085 ** level);
}

/** Skill points each of the game's skills receives for an achievement worth `xp`. */
export function skillPointsFor(xp: number, skillCount: number): number {
  return Math.round(xp / 12 / skillCount);
}

export function applySkillPoints(
  state: SkillState,
  points: number,
): { state: SkillState; levelsGained: number } {
  let level = state.level;
  let remaining = state.points + points;
  let levelsGained = 0;
  while (remaining >= skillNeed(level)) {
    remaining -= skillNeed(level);
    level++;
    levelsGained++;
  }
  return { state: { level, points: remaining }, levelsGained };
}

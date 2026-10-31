import { applySkillPoints, skillPointsFor } from "@/lib/engine/skills";
import { SKILLS, type SkillId, type SkillState } from "@/lib/engine/types";

export type LedgerSkillEntry = {
  xp: number;
  skills: string[];
  /** Explicit per-skill points; `null` means derive with `skillPointsFor`. */
  skillPoints: Record<string, number> | null;
};

/**
 * Total skill points each skill earned over the ledger. Entries with explicit `skillPoints` use
 * them; the rest give each skill in `skills` `skillPointsFor(xp, skills.length)`.
 */
export function skillPointTotals(entries: LedgerSkillEntry[]): Record<SkillId, number> {
  const totals = Object.fromEntries(SKILLS.map((s) => [s.id, 0])) as Record<SkillId, number>;
  const known = new Set<string>(SKILLS.map((s) => s.id));

  for (const entry of entries) {
    if (entry.skillPoints) {
      for (const [skill, points] of Object.entries(entry.skillPoints)) {
        if (known.has(skill)) totals[skill as SkillId] += points;
      }
    } else if (entry.skills.length > 0) {
      const points = skillPointsFor(entry.xp, entry.skills.length);
      for (const skill of entry.skills) {
        if (known.has(skill)) totals[skill as SkillId] += points;
      }
    }
  }
  return totals;
}

/**
 * Rebuilds every skill's level/points from the XP ledger, starting at level 1 with 0 points.
 * Order does not matter: points are summed first (see `skillPointTotals`).
 */
export function skillsFromLedger(
  entries: LedgerSkillEntry[],
): Record<SkillId, SkillState> {
  const totals = skillPointTotals(entries);
  return Object.fromEntries(
    SKILLS.map((s) => [
      s.id,
      applySkillPoints({ level: 1, points: 0 }, totals[s.id]).state,
    ]),
  ) as Record<SkillId, SkillState>;
}

import { SKILLS, type SkillId } from "./types";

export type MissionCondition = {
  minCount: number;
  maxGlobalPct?: number;
  skill?: SkillId;
  gameId?: string;
};

export type UnlockEvent = {
  achievementId: string;
  gameId: string;
  globalPct: number | null;
  skills: SkillId[];
  unlockedAt: Date;
  suspicious: boolean;
};

export function missionProgress(
  cond: MissionCondition,
  events: UnlockEvent[],
): { count: number; done: boolean } {
  const count = events.filter(
    (e) =>
      !e.suspicious &&
      (cond.maxGlobalPct === undefined ||
        (e.globalPct !== null && e.globalPct <= cond.maxGlobalPct)) &&
      (cond.skill === undefined || e.skills.includes(cond.skill)) &&
      (cond.gameId === undefined || e.gameId === cond.gameId),
  ).length;
  return { count, done: count >= cond.minCount };
}

/** `{skill}` in the title is replaced by the chosen skill's name. */
export type MissionTemplate = {
  title: string;
  minCount: number;
  maxGlobalPct?: number;
  needsSkill: boolean;
  rewardXp: number;
};

export const DAILY_TEMPLATES: MissionTemplate[] = [
  {
    title: "Desbloqueie 3 conquistas raras",
    minCount: 3,
    maxGlobalPct: 20,
    needsSkill: false,
    rewardXp: 12000,
  },
  {
    title: "Ganhe XP em {skill}",
    minCount: 1,
    needsSkill: true,
    rewardXp: 5000,
  },
  {
    title: "Desbloqueie 5 conquistas",
    minCount: 5,
    needsSkill: false,
    rewardXp: 8000,
  },
];

export const WEEKLY_TEMPLATES: MissionTemplate[] = [
  {
    title: "Desbloqueie 10 conquistas de {skill}",
    minCount: 10,
    needsSkill: true,
    rewardXp: 40000,
  },
  {
    title: "Desbloqueie 10 conquistas raras",
    minCount: 10,
    maxGlobalPct: 20,
    needsSkill: false,
    rewardXp: 50000,
  },
];

/** Deterministic PRNG (mulberry32) seeded from a string (FNV-1a hash). */
function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateMissions(
  seed: string,
  kind: "daily" | "weekly",
  topSkills: SkillId[],
): { title: string; condition: MissionCondition; rewardXp: number }[] {
  const templates = kind === "daily" ? DAILY_TEMPLATES : WEEKLY_TEMPLATES;
  const rng = seededRandom(`${kind}:${seed}`);
  // "sabio" is earned through guides, not achievements, so it can't be a target.
  const earnable = SKILLS.filter((s) => s.id !== "sabio");
  const top = earnable.filter((s) => topSkills.includes(s.id));
  const pool = top.length > 0 ? top : earnable;

  return templates.map((t) => {
    const condition: MissionCondition = { minCount: t.minCount };
    if (t.maxGlobalPct !== undefined) condition.maxGlobalPct = t.maxGlobalPct;
    let title = t.title;
    if (t.needsSkill) {
      const skill = pool[Math.floor(rng() * pool.length)];
      condition.skill = skill.id;
      title = title.replace("{skill}", skill.name);
    }
    return { title, condition, rewardXp: t.rewardXp };
  });
}

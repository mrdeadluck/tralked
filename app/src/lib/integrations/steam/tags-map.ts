import type { SkillId } from "@/lib/engine/types";

/**
 * Only a game's most voted SteamSpy tags describe it; the long tail is noise ("Great Soundtrack",
 * one-off votes for "Puzzle" on a shooter...).
 */
export const TOP_TAGS = 12;

/** Steam user tags (lowercase) that put a game in each skill. Never `sabio` (guides only). */
const SKILL_TAGS: Record<Exclude<SkillId, "sabio">, string[]> = {
  fps: ["fps", "arena shooter", "hero shooter", "tactical shooter"],
  horror: ["survival horror"],
  soulslike: ["souls-like"],
  rpg: ["rpg", "action rpg", "jrpg", "crpg", "party-based rpg", "tactical rpg", "mmorpg", "arpg"],
  roguelike: ["roguelike", "roguelite", "action roguelike", "traditional roguelike", "roguelike deckbuilder"],
  plataforma: ["platformer", "2d platformer", "3d platformer", "precision platformer", "puzzle platformer", "metroidvania"],
  estrategia: [
    "strategy",
    "rts",
    "turn-based strategy",
    "grand strategy",
    "4x",
    "real-time strategy",
    "turn-based tactics",
    "tower defense",
    "city builder",
  ],
  simulacao: [
    "simulation",
    "life sim",
    "farming sim",
    "automobile sim",
    "flight",
    "colony sim",
    "space sim",
    "immersive sim",
    "management",
  ],
  puzzle: ["puzzle", "logic", "puzzle platformer"],
  coop: ["co-op", "online co-op", "local co-op", "co-op campaign"],
};

/**
 * Maps a game's SteamSpy tags (`{ tag: votes }` or a list already ordered by votes) to skills,
 * looking only at its `TOP_TAGS` most voted tags. Besides the listed tags, "Horror" + "Survival"
 * counts as survival horror. "Tactical" and "Shooter" + "First-Person" are left out on purpose:
 * tactical shooters are not strategy games, and open-world games with gunplay are not FPS.
 */
export function mapTagsToSkills(tags: Record<string, number> | string[]): SkillId[] {
  const ordered = Array.isArray(tags)
    ? tags
    : Object.entries(tags)
        .sort((a, b) => b[1] - a[1])
        .map(([tag]) => tag);
  const top = new Set(ordered.slice(0, TOP_TAGS).map((t) => t.trim().toLowerCase()));

  const skills: SkillId[] = [];
  for (const [skill, names] of Object.entries(SKILL_TAGS) as [SkillId, string[]][]) {
    const matches =
      names.some((name) => top.has(name)) ||
      (skill === "horror" && top.has("horror") && top.has("survival"));
    if (matches) skills.push(skill);
  }
  return skills;
}

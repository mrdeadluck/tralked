import type { SkillId } from "@/lib/engine/types";

export type GenreMapInput = {
  genres: string[];
  themes: string[];
  gameModes: string[];
  perspectives: string[];
  keywords: string[];
};

const STRATEGY_GENRES = [
  "strategy",
  "real time strategy (rts)",
  "turn-based strategy (tbs)",
  "tactical",
];

const lower = (items: string[]) => new Set(items.map((s) => s.trim().toLowerCase()));
// Keywords vary in spelling ("souls-like", "rogue-lite"), so drop punctuation too.
const squash = (items: string[]) =>
  new Set(items.map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, "")));

/** Maps IGDB genres/themes/modes/perspectives/keywords to skills (spec §5). Never returns `sabio`. */
export function mapToSkills(input: GenreMapInput): SkillId[] {
  const genres = lower(input.genres);
  // IGDB splits "Horror"/"Survival" between genres and themes depending on the game.
  const categories = lower([...input.genres, ...input.themes]);
  const modes = lower(input.gameModes);
  const perspectives = lower(input.perspectives);
  const keywords = squash(input.keywords);

  const skills: SkillId[] = [];
  const add = (condition: boolean, skill: SkillId) => {
    if (condition) skills.push(skill);
  };

  add(genres.has("shooter") && perspectives.has("first person"), "fps");
  add(categories.has("horror") && categories.has("survival"), "horror");
  add(keywords.has("soulslike"), "soulslike");
  add(genres.has("role-playing (rpg)"), "rpg");
  add(keywords.has("roguelike") || keywords.has("roguelite"), "roguelike");
  add(genres.has("platform"), "plataforma");
  add(STRATEGY_GENRES.some((g) => genres.has(g)), "estrategia");
  add(genres.has("simulator"), "simulacao");
  add(genres.has("puzzle"), "puzzle");
  add(modes.has("co-operative"), "coop");
  return skills;
}

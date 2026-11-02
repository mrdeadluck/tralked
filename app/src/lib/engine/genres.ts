import { SKILLS, type SkillId } from "./types";

/*
 * Which of a game's skills reads as its genre. Skills come from IGDB genres, keywords and game
 * modes (lib/integrations/genre-map.ts) and are stored without order, so a card that showed "the
 * first skill" could call GTA VI "Co-op" or Baldur's Gate 3 "Estratégia". The most specific genre
 * wins: a subgenre the game is known for (Soulslike, Survival Horror, FPS, Roguelike) before the
 * broad IGDB genre (RPG, Plataforma, Puzzle, Simulação, Estratégia). Co-op is a game mode, not a
 * genre: it is listed last and never stands alone as the genre of a card.
 */
const GENRE_ORDER: SkillId[] = [
  "soulslike",
  "horror",
  "fps",
  "roguelike",
  "rpg",
  "plataforma",
  "puzzle",
  "simulacao",
  "estrategia",
  "coop",
];

const NAME = new Map<string, string>(SKILLS.map((s) => [s.id, s.name]));

/** Display name of a skill ("RPG", "Survival Horror"). */
export const genreName = (id: SkillId): string => NAME.get(id) ?? id;

/** The game's genre skills, most specific first, Co-op last (Sábio, the guides skill, left out). */
export function orderedGenres(skills: readonly string[]): SkillId[] {
  const rank = (s: string) => {
    const i = GENRE_ORDER.indexOf(s as SkillId);
    return i === -1 ? GENRE_ORDER.length : i;
  };
  return [...new Set(skills)]
    .filter((s): s is SkillId => s !== "sabio" && NAME.has(s))
    .sort((a, b) => rank(a) - rank(b));
}

/** The genre a card shows for a game; null when it only has a game mode (Co-op) or nothing. */
export function primaryGenre(skills: readonly string[]): SkillId | null {
  const first = orderedGenres(skills)[0];
  return first && first !== "coop" ? first : null;
}

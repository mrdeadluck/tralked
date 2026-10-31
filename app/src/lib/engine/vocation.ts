import { SKILLS, type SkillId, type SkillState } from "./types";

const PAIRS: [SkillId, SkillId, string][] = [
  ["soulslike", "plataforma", "Lâmina Sombria"],
  ["soulslike", "rpg", "Cavaleiro Maculado"],
  ["fps", "horror", "Caçador"],
  ["rpg", "estrategia", "Arquimago"],
  ["roguelike", "estrategia", "Trapaceiro da Sorte"],
  ["puzzle", "coop", "Engenheiro de Portais"],
  ["fps", "coop", "Sobrevivente"],
];

/**
 * Vocation from the two highest trained skills (sabio ignored; ties broken by
 * points). A skill is trained when level > 1 or points > 0.
 */
export function vocationFor(skills: Record<SkillId, SkillState>): string {
  const ranked = SKILLS.filter((s) => s.id !== "sabio")
    .map((s) => ({ ...s, state: skills[s.id] }))
    .filter((s) => s.state.level > 1 || s.state.points > 0)
    .sort(
      (a, b) =>
        b.state.level - a.state.level || b.state.points - a.state.points,
    );
  if (ranked.length === 0) return "Recruta";
  const [first, second] = ranked;
  if (!second) return `Andarilho de ${first.name}`;
  const pair = PAIRS.find(
    ([x, y]) =>
      (x === first.id && y === second.id) ||
      (x === second.id && y === first.id),
  );
  return pair ? pair[2] : `Andarilho de ${first.name}`;
}

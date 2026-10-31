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

/** Vocation from the two highest skills (sabio ignored; ties broken by points). */
export function vocationFor(skills: Record<SkillId, SkillState>): string {
  const ranked = SKILLS.filter((s) => s.id !== "sabio")
    .map((s) => ({ ...s, state: skills[s.id] }))
    .sort(
      (a, b) =>
        b.state.level - a.state.level || b.state.points - a.state.points,
    );
  const [first, second] = ranked;
  const pair = PAIRS.find(
    ([x, y]) =>
      (x === first.id && y === second.id) ||
      (x === second.id && y === first.id),
  );
  return pair ? pair[2] : `Andarilho de ${first.name}`;
}

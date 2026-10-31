export type SkillId =
  | "fps"
  | "horror"
  | "soulslike"
  | "rpg"
  | "roguelike"
  | "plataforma"
  | "estrategia"
  | "simulacao"
  | "puzzle"
  | "coop"
  | "sabio";

export const SKILLS: { id: SkillId; name: string }[] = [
  { id: "fps", name: "FPS" },
  { id: "horror", name: "Survival Horror" },
  { id: "soulslike", name: "Soulslike" },
  { id: "rpg", name: "RPG" },
  { id: "roguelike", name: "Roguelike" },
  { id: "plataforma", name: "Plataforma" },
  { id: "estrategia", name: "Estratégia" },
  { id: "simulacao", name: "Simulação" },
  { id: "puzzle", name: "Puzzle" },
  { id: "coop", name: "Co-op" },
  { id: "sabio", name: "Sábio (guias)" },
];

export type RarityTier = "comum" | "incomum" | "rara" | "epica" | "lendaria";

export type SkillState = { level: number; points: number };

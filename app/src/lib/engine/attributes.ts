import type { SkillId } from "./types";
import { gloryPoints, type TrophyTier } from "./trophies";

export type AttributeId =
  | "vigor"
  | "precisao"
  | "gloria"
  | "colecao"
  | "exploracao"
  | "constancia"
  | "sabedoria";

export const ATTRIBUTES: { id: AttributeId; name: string; description: string }[] = [
  {
    id: "vigor",
    name: "Vigor",
    description: "Cresce com as horas jogadas, com retorno decrescente a cada jogo.",
  },
  {
    id: "precisao",
    name: "Precisão",
    description:
      "Cresce com cada conquista rara (até 5% dos jogadores), com bônus no modo hardcore.",
  },
  {
    id: "gloria",
    name: "Glória",
    description: "Cresce com o valor dos troféus conquistados, de bronze a platina.",
  },
  {
    id: "colecao",
    name: "Coleção",
    description: "Cresce com cada jogo que você completou em 100%.",
  },
  {
    id: "exploracao",
    name: "Exploração",
    description:
      "Cresce com os jogos que você começou a conquistar e com a variedade de gêneros que já jogou.",
  },
  {
    id: "constancia",
    name: "Constância",
    description: "Cresce com os dias em que você jogou e com a sua melhor sequência.",
  },
  {
    id: "sabedoria",
    name: "Sabedoria",
    description:
      "Cresce com guias publicados, respostas que resolveram dúvidas e pontos da habilidade Sábio.",
  },
];

export type AttributeResult = { points: number; level: number };

export function attributeLevel(points: number): number {
  return Math.floor(Math.sqrt(points / 25)) + 1;
}

/** Sum over games of round(40 * log2(1 + hours)). */
export function vigorPoints(playtimesMin: number[]): number {
  return playtimesMin.reduce(
    (acc, min) => acc + Math.round(40 * Math.log2(1 + min / 60)),
    0,
  );
}

/** 30 per achievement at <= 5% global unlock, +15 when earned in hardcore. */
export function precisaoPoints(
  unlocked: { globalPct: number | null; hardcore: boolean }[],
): number {
  return unlocked.reduce((acc, u) => {
    if (u.globalPct === null || u.globalPct > 5) return acc;
    return acc + 30 + (u.hardcore ? 15 : 0);
  }, 0);
}

export function gloriaPoints(tiers: TrophyTier[]): number {
  return tiers.reduce((acc, t) => acc + gloryPoints(t), 0) * 10;
}

export function colecaoPoints(completedGames: number): number {
  return completedGames * 250;
}

export function exploracaoPoints(gamesWithUnlock: number, distinctGenres: number): number {
  return gamesWithUnlock * 20 + distinctGenres * 60;
}

export function constanciaPoints(activeDays: number, bestStreak: number): number {
  return activeDays * 15 + bestStreak * 5;
}

export function sabedoriaPoints(
  sabioPoints: number,
  solvedAnswers: number,
  publishedGuides: number,
): number {
  return sabioPoints + solvedAnswers * 40 + publishedGuides * 100;
}

export type AttributeInput = {
  games: {
    playtimeMin: number;
    unlocked: { globalPct: number | null; hardcore: boolean; tier: TrophyTier }[];
    completed: boolean;
    skills: SkillId[];
  }[];
  activeDays: number;
  bestStreak: number;
  sabioPoints: number;
  solvedAnswers: number;
  publishedGuides: number;
};

/**
 * Composes every per-source formula. Genres are the distinct game skills
 * (`sabio` is the guides skill, not a genre, so it is excluded).
 */
export function computeAttributes(input: AttributeInput): Record<AttributeId, AttributeResult> {
  const { games } = input;
  const unlocked = games.flatMap((g) => g.unlocked);
  const genres = new Set(games.flatMap((g) => g.skills).filter((s) => s !== "sabio"));

  const points: Record<AttributeId, number> = {
    vigor: vigorPoints(games.map((g) => g.playtimeMin)),
    precisao: precisaoPoints(unlocked),
    gloria: gloriaPoints(unlocked.map((u) => u.tier)),
    colecao: colecaoPoints(games.filter((g) => g.completed).length),
    exploracao: exploracaoPoints(
      games.filter((g) => g.unlocked.length > 0).length,
      genres.size,
    ),
    constancia: constanciaPoints(input.activeDays, input.bestStreak),
    sabedoria: sabedoriaPoints(
      input.sabioPoints,
      input.solvedAnswers,
      input.publishedGuides,
    ),
  };

  const result = {} as Record<AttributeId, AttributeResult>;
  for (const { id } of ATTRIBUTES) {
    result[id] = { points: points[id], level: attributeLevel(points[id]) };
  }
  return result;
}

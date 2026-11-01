import type { SkillId } from "./types";
import { carismaPoints } from "./social";
import { gloryPoints, type TrophyTier } from "./trophies";

export type AttributeId =
  | "vigor"
  | "precisao"
  | "gloria"
  | "colecao"
  | "exploracao"
  | "constancia"
  | "sabedoria"
  | "resistencia"
  | "acervo"
  | "carisma";

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
  {
    id: "resistencia",
    name: "Resistência",
    description:
      "Cresce com o total de horas jogadas em todas as plataformas, com retorno decrescente.",
  },
  {
    id: "acervo",
    name: "Acervo",
    description:
      "Cresce com os jogos que você jogou; jogos que você tem e nunca jogou valem metade.",
  },
  {
    id: "carisma",
    name: "Carisma",
    description:
      "Cresce com as curtidas que seus comentários recebem, as respostas marcadas como úteis e os amigos.",
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

/** round(10 · hours^0.7) over the total playtime of every game and platform. */
export function resistenciaPoints(totalPlaytimeMin: number): number {
  if (!Number.isFinite(totalPlaytimeMin) || totalPlaytimeMin <= 0) return 0;
  return Math.round(10 * (totalPlaytimeMin / 60) ** 0.7);
}

/** 10 per game played (playtime or an unlock) and 5 per game owned but never played. */
export function acervoPoints(playedGames: number, unplayedGames: number): number {
  return playedGames * 10 + unplayedGames * 5;
}

export type AttributeInput = {
  /**
   * Every game of the library, merged across platforms. A game with 0 playtime and no unlock is
   * owned but never played (Steam lists those).
   */
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
  /** Social (F9): paid `comment_liked` and `comment_helpful` entries, accepted friendships. */
  likesReceived?: number;
  helpfulReplies?: number;
  friends?: number;
};

/**
 * Composes every per-source formula. Genres are the distinct game skills
 * (`sabio` is the guides skill, not a genre, so it is excluded).
 */
export function computeAttributes(input: AttributeInput): Record<AttributeId, AttributeResult> {
  const { games } = input;
  const unlocked = games.flatMap((g) => g.unlocked);
  const genres = new Set(games.flatMap((g) => g.skills).filter((s) => s !== "sabio"));
  const played = games.filter((g) => g.playtimeMin > 0 || g.unlocked.length > 0).length;

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
    resistencia: resistenciaPoints(games.reduce((sum, g) => sum + Math.max(0, g.playtimeMin), 0)),
    acervo: acervoPoints(played, games.length - played),
    carisma: carismaPoints(input.likesReceived ?? 0, input.helpfulReplies ?? 0, input.friends ?? 0),
  };

  const result = {} as Record<AttributeId, AttributeResult>;
  for (const { id } of ATTRIBUTES) {
    result[id] = { points: points[id], level: attributeLevel(points[id]) };
  }
  return result;
}

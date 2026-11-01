import { SKILLS, type SkillId } from "@/lib/engine/types";
import { isRankScope, type RankScope } from "./stats";

/**
 * The highscores boards. Pure (no database): shared by the pages, the queries and the daily snapshot.
 * Each board has its own path (prerendered, so the ranks work without JS): see `boardFromPath`.
 */
export const METRICS = ["nivel", "horas", "conquistas", "raras", "platinas", "acervo", "genero"] as const;
export type Metric = (typeof METRICS)[number];

/** Metrics read from UserRankStats, with a platform filter. */
export type StatMetric = Exclude<Metric, "nivel" | "genero">;
export const STAT_METRICS: StatMetric[] = ["horas", "conquistas", "raras", "platinas", "acervo"];

export type Board =
  | { metric: "nivel" }
  | { metric: StatMetric; scope: RankScope }
  | { metric: "genero"; skill: SkillId };

export const METRIC_LABEL: Record<Metric, string> = {
  nivel: "Nível",
  horas: "Horas jogadas",
  conquistas: "Conquistas",
  raras: "Raras e lendárias",
  platinas: "Platinas e 100%",
  acervo: "Acervo",
  genero: "Por gênero",
};

/** One line under the tabs: what the board ranks. */
export const METRIC_HINT: Record<Metric, string> = {
  nivel: "Nível e XP total, somando tudo o que você joga e conquista.",
  horas: "Horas reais informadas pelas plataformas, somadas de todos os jogos.",
  conquistas: "Conquistas e troféus válidos desbloqueados.",
  raras: "Conquistas que até 20% dos jogadores têm; lendárias (até 3%) desempatam.",
  platinas: "Jogos completados em 100%, contando a platina.",
  acervo: "Jogos jogados valem 10 pontos; os que você tem e nunca jogou valem 5.",
  genero: "Nível de cada habilidade, do Soulslike ao Sábio.",
};

export const SCOPE_LABEL: Record<RankScope, string> = {
  all: "Todas",
  steam: "Steam",
  psn: "PlayStation",
  xbox: "Xbox",
  retro: "Retro",
};

const SKILL_IDS = new Set<string>(SKILLS.map((s) => s.id));
const isSkill = (value: string | undefined): value is SkillId => !!value && SKILL_IDS.has(value);

/**
 * The board of a highscores path: `/highscores` (no category) is Nível; `/highscores/horas` is a
 * stat board over every platform and `/highscores/horas/psn` one platform; `/highscores/genero/rpg`
 * a genre (`/highscores/genero` is the first one). Anything else is null (a real 404).
 */
export function boardFromPath(categoria?: string, filtro?: string): Board | null {
  if (categoria === undefined) return { metric: "nivel" };
  if (categoria === "genero") {
    if (filtro === undefined) return { metric: "genero", skill: SKILLS[0].id };
    return isSkill(filtro) ? { metric: "genero", skill: filtro } : null;
  }
  if ((STAT_METRICS as string[]).includes(categoria)) {
    if (filtro === undefined) return { metric: categoria as StatMetric, scope: "all" };
    return isRankScope(filtro) && filtro !== "all" ? { metric: categoria as StatMetric, scope: filtro } : null;
  }
  return null;
}

/** Old `/highscores?skill=<id>` links (Plano 1): the genre board they meant, or null. */
export function legacySkillBoard(skill: string | string[] | undefined): Board | null {
  const value = Array.isArray(skill) ? skill[0] : skill;
  return isSkill(value) ? { metric: "genero", skill: value } : null;
}

/** Stable key of a board (cache tag suffix and RankSnapshot.board). */
export function boardKey(board: Board): string {
  if (board.metric === "nivel") return "nivel";
  if (board.metric === "genero") return `genero:${board.skill}`;
  return `${board.metric}:${board.scope}`;
}

/** Inverse of `boardKey`; null for anything else. */
export function boardFromKey(key: string): Board | null {
  const [metric, arg] = key.split(":");
  if (metric === "nivel" && arg === undefined) return { metric: "nivel" };
  if (metric === "genero") return isSkill(arg) ? { metric: "genero", skill: arg } : null;
  if ((STAT_METRICS as string[]).includes(metric) && arg && isRankScope(arg)) {
    return { metric: metric as StatMetric, scope: arg };
  }
  return null;
}

/** Every board, in display order (the daily snapshot walks them all). */
export function allBoards(): Board[] {
  return [
    { metric: "nivel" },
    ...STAT_METRICS.flatMap((metric) =>
      (["all", "steam", "psn", "xbox", "retro"] as const).map((scope) => ({ metric, scope }) as Board),
    ),
    ...SKILLS.map((s) => ({ metric: "genero", skill: s.id }) as Board),
  ];
}

/** Path of a board (see `boardFromPath`). */
export function boardHref(board: Board): string {
  if (board.metric === "nivel") return "/highscores";
  if (board.metric === "genero") return `/highscores/genero/${board.skill}`;
  return board.scope === "all" ? `/highscores/${board.metric}` : `/highscores/${board.metric}/${board.scope}`;
}

/** Human name of a board, for headings and captions. */
export function boardTitle(board: Board): string {
  if (board.metric === "genero") return SKILLS.find((s) => s.id === board.skill)?.name ?? board.skill;
  if (board.metric === "nivel") return METRIC_LABEL.nivel;
  return board.scope === "all"
    ? METRIC_LABEL[board.metric]
    : `${METRIC_LABEL[board.metric]} (${SCOPE_LABEL[board.scope]})`;
}

import { SKILLS, type SkillId } from "@/lib/engine/types";
import { isRankScope, type RankScope } from "./stats";

/**
 * The highscores boards. Pure (no database): shared by the pages, the queries and the daily snapshot.
 * Each board has its own path (prerendered, so the ranks work without JS): see `boardFromPath`.
 */
export const METRICS = [
  "nivel",
  "semana",
  "novatos",
  "horas",
  "conquistas",
  "raras",
  "platinas",
  "acervo",
  "genero",
] as const;
export type Metric = (typeof METRICS)[number];

/**
 * Boards without a filter: Nível (everyone), Esta semana (XP of the last 7 days, from the ledger)
 * and Novatos (Nível among players up to NOVATO_MAX_LEVEL). The last two are the reachable ones.
 */
export type PlainMetric = "nivel" | "semana" | "novatos";
export const PLAIN_METRICS: PlainMetric[] = ["nivel", "semana", "novatos"];
const isPlain = (value: string): value is PlainMetric => (PLAIN_METRICS as string[]).includes(value);

/** Players a board needs to fill its podium; below it `/highscores` opens on Esta semana. */
export const MIN_PODIUM = 3;

/** Address of the Nível tab (`/highscores` itself may open on another board). */
export const NIVEL_TAB_HREF = "/highscores/nivel";

/** Highest level on the Novatos board. */
export const NOVATO_MAX_LEVEL = 20;
/** Window of the Esta semana board, in days (rolling, not a calendar week). */
export const WEEK_DAYS = 7;

/** Metrics read from UserRankStats, with a platform filter. */
export type StatMetric = Exclude<Metric, PlainMetric | "genero">;
export const STAT_METRICS: StatMetric[] = ["horas", "conquistas", "raras", "platinas", "acervo"];

export type Board =
  | { metric: "nivel" }
  | { metric: "semana" }
  | { metric: "novatos" }
  | { metric: StatMetric; scope: RankScope }
  | { metric: "genero"; skill: SkillId };

export const METRIC_LABEL: Record<Metric, string> = {
  nivel: "Nível",
  semana: "Esta semana",
  novatos: "Novatos",
  horas: "Horas jogadas",
  conquistas: "Conquistas",
  raras: "Raras e lendárias",
  platinas: "Platinas e 100%",
  acervo: "Acervo",
  genero: "Por gênero",
};

/** One line under the tabs: what the board ranks. */
export const METRIC_HINT: Record<Metric, string> = {
  nivel: "Nível do personagem, somando tudo o que você joga e conquista.",
  semana:
    "XP ganho nos últimos 7 dias, de jogos e da comunidade (fotos, curtidas, respostas). O nível não importa: quem mais ganhou nesta semana sobe.",
  novatos: `Só jogadores até o nível ${NOVATO_MAX_LEVEL}. O lugar certo para disputar desde o começo.`,
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
 * `/highscores/nivel` is Nível too: the tab's own address, since `/highscores` opens on Esta
 * semana while Nível has too few players to fill a podium (see `MIN_PODIUM`).
 */
export function boardFromPath(categoria?: string, filtro?: string): Board | null {
  if (categoria === undefined) return { metric: "nivel" };
  if (isPlain(categoria)) return filtro === undefined ? { metric: categoria } : null;
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
  if (isPlainBoard(board)) return board.metric;
  if (board.metric === "genero") return `genero:${board.skill}`;
  return `${board.metric}:${board.scope}`;
}

/** Inverse of `boardKey`; null for anything else. */
export function boardFromKey(key: string): Board | null {
  const [metric, arg] = key.split(":");
  if (isPlain(metric)) return arg === undefined ? { metric } : null;
  if (metric === "genero") return isSkill(arg) ? { metric: "genero", skill: arg } : null;
  if ((STAT_METRICS as string[]).includes(metric) && arg && isRankScope(arg)) {
    return { metric: metric as StatMetric, scope: arg };
  }
  return null;
}

/** Every board, in display order (the daily snapshot walks them all). */
export function allBoards(): Board[] {
  return [
    ...PLAIN_METRICS.map((metric) => ({ metric }) as Board),
    ...STAT_METRICS.flatMap((metric) =>
      (["all", "steam", "psn", "xbox", "retro"] as const).map((scope) => ({ metric, scope }) as Board),
    ),
    ...SKILLS.map((s) => ({ metric: "genero", skill: s.id }) as Board),
  ];
}

/** Path of a board (see `boardFromPath`). */
export function boardHref(board: Board): string {
  if (board.metric === "nivel") return "/highscores";
  if (isPlainBoard(board)) return `/highscores/${board.metric}`;
  if (board.metric === "genero") return `/highscores/genero/${board.skill}`;
  return board.scope === "all" ? `/highscores/${board.metric}` : `/highscores/${board.metric}/${board.scope}`;
}

/** Human name of a board, for headings and captions. */
export function boardTitle(board: Board): string {
  if (board.metric === "genero") return SKILLS.find((s) => s.id === board.skill)?.name ?? board.skill;
  if (isPlainBoard(board)) return METRIC_LABEL[board.metric];
  return board.scope === "all"
    ? METRIC_LABEL[board.metric]
    : `${METRIC_LABEL[board.metric]} (${SCOPE_LABEL[board.scope]})`;
}

/** Nível, Esta semana or Novatos (no platform or genre filter). */
export function isPlainBoard(board: Board): board is { metric: PlainMetric } {
  return isPlain(board.metric);
}

/** Boards ranked by character level (with the XP bar inside the level). */
export const isLevelBoard = (board: Board): board is { metric: "nivel" | "novatos" } =>
  board.metric === "nivel" || board.metric === "novatos";

import { skillNeed } from "@/lib/engine/skills";
import { levelFromXp } from "@/lib/engine/xp";
import type { Board, Metric } from "./boards";
import type { RankedPlayer } from "./queries";

const fmt = (n: number) => n.toLocaleString("pt-BR");
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What a row shows: the big number (counted up), its unit, a detail line and its bar. */
export type RowDisplay = {
  /** Integer shown big (hours for horas, never minutes). */
  value: number;
  unit: string;
  detail: string;
  /** 0..1 */
  bar: number;
  barLabel: string;
};

const hours = (minutes: number) => Math.floor(minutes / 60);

/**
 * Display of a ranked player. Nível and genre boards show the progress inside the current level
 * (the XP bar); the other boards show the value against the leader's.
 */
export function rowDisplay(board: Board, p: RankedPlayer, leaderValue: number): RowDisplay {
  const relative = (label: string) => ({
    bar: leaderValue > 0 ? Math.min(1, p.value / leaderValue) : 0,
    barLabel: `${label} de @${p.handle} em relação ao primeiro colocado`,
  });
  switch (board.metric) {
    case "nivel": {
      const progress = levelFromXp(p.totalXp);
      return {
        value: p.value,
        unit: "nível",
        detail: `${fmt(p.totalXp)} XP`,
        bar: Math.min(1, progress.fraction),
        barLabel: `XP de @${p.handle} para o nível ${p.value + 1}`,
      };
    }
    case "genero": {
      const need = skillNeed(p.value);
      return {
        value: p.value,
        unit: "nível",
        detail: `${fmt(p.secondary)} ${plural(p.secondary, "ponto", "pontos")}`,
        bar: need > 0 ? Math.min(1, p.secondary / need) : 0,
        barLabel: `Pontos de @${p.handle} para o próximo nível`,
      };
    }
    case "horas":
      return {
        value: hours(p.value),
        unit: "h",
        detail: `Nível ${p.level}`,
        ...relative("Horas jogadas"),
      };
    case "conquistas":
      return {
        value: p.value,
        unit: plural(p.value, "conquista", "conquistas"),
        detail: `Nível ${p.level}`,
        ...relative("Conquistas"),
      };
    case "raras":
      return {
        value: p.value,
        unit: plural(p.value, "rara", "raras"),
        detail: `${fmt(p.secondary)} ${plural(p.secondary, "lendária", "lendárias")}`,
        ...relative("Conquistas raras"),
      };
    case "platinas":
      return {
        value: p.value,
        unit: plural(p.value, "jogo em 100%", "jogos em 100%"),
        detail: `${fmt(p.secondary)} ${plural(p.secondary, "conquista", "conquistas")}`,
        ...relative("Jogos completos"),
      };
    case "acervo":
      return {
        value: p.value,
        unit: "pontos",
        detail: `${fmt(p.extra)} ${plural(p.extra, "jogado", "jogados")} de ${fmt(p.secondary)} ${plural(p.secondary, "jogo", "jogos")}`,
        ...relative("Acervo"),
      };
  }
}

const GAP_UNIT: Record<Exclude<Metric, "nivel" | "genero" | "horas" | "conquistas">, [string, string]> = {
  raras: ["conquista rara", "conquistas raras"],
  platinas: ["jogo em 100%", "jogos em 100%"],
  acervo: ["ponto de Acervo", "pontos de Acervo"],
};

/** What breaks a tie on each board after the main value (see STAT_FIELDS in queries.ts). */
const TIE_BREAK_UNIT: Record<Exclude<Metric, "nivel" | "genero" | "horas" | "conquistas">, [string, string]> = {
  raras: ["lendária", "lendárias"],
  platinas: ["conquista", "conquistas"],
  acervo: ["jogo na biblioteca", "jogos na biblioteca"],
};

const TIED = "Empatado com";

/** "Faltam 30 h para alcançar @fulano": the distance to the player right above. */
export function gapText(board: Board, me: RankedPlayer, above: RankedPlayer): string {
  const who = `@${above.handle}`;
  /** "Falta 1 conquista" / "Faltam 3 conquistas" (`n` decides the verb). */
  const amount = (n: number, one: string, many: string) =>
    `${n === 1 ? "Falta" : "Faltam"} ${fmt(n)} ${plural(n, one, many)}`;
  const reach = (text: string) => `${text} para alcançar ${who}`;
  const byName = `${TIED} ${who} (o desempate é pelo nome)`;
  switch (board.metric) {
    case "nivel": {
      const xp = above.totalXp - me.totalXp;
      return xp > 0 ? reach(amount(xp, "XP", "XP")) : byName;
    }
    case "genero": {
      const levels = above.value - me.value;
      if (levels > 0) return reach(amount(levels, "nível", "níveis"));
      const points = above.secondary - me.secondary;
      return points > 0 ? reach(amount(points, "ponto", "pontos")) : byName;
    }
    case "horas": {
      const minutes = above.value - me.value;
      if (minutes <= 0) return `${TIED} ${who} nas horas (o desempate é pelo nome)`;
      return minutes < 60 ? reach("Falta menos de 1 h") : reach(amount(Math.ceil(minutes / 60), "h", "h"));
    }
    case "conquistas": {
      const diff = above.value - me.value;
      return diff > 0 ? reach(amount(diff, "conquista", "conquistas")) : byName;
    }
    default: {
      const diff = above.value - me.value;
      const [one, many] = GAP_UNIT[board.metric];
      if (diff > 0) return reach(amount(diff, one, many));
      // Same value: the board's tie-breaker decides, so that is the gap to show.
      const second = above.secondary - me.secondary;
      const [one2, many2] = TIE_BREAK_UNIT[board.metric];
      return second > 0
        ? `${TIED} ${who} em ${many}; ${amount(second, one2, many2).toLowerCase()} para desempatar`
        : byName;
    }
  }
}

/** "Subiu 3 posições", "Caiu 1 posição", "Manteve a posição", "Entrou no ranking"; null without history. */
export function deltaText(rank: number, previousRank: number | null, isNew: boolean): string | null {
  if (isNew) return "Entrou no ranking";
  if (previousRank === null) return null;
  const delta = previousRank - rank;
  if (delta === 0) return "Manteve a posição";
  const n = Math.abs(delta);
  return `${delta > 0 ? "Subiu" : "Caiu"} ${n} ${plural(n, "posição", "posições")}`;
}

/** "30/10" from "2026-10-30". */
export const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

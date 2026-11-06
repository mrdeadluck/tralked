import { skillNeed } from "@/lib/engine/skills";
import { levelFromXp } from "@/lib/engine/xp";
import { formatCompact, formatExact } from "@/lib/xp-format";
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
  /** Big XP values show abbreviated ("312 mil"); the exact one goes in `valueTitle`. */
  compact?: boolean;
  valueTitle?: string;
  /** Exact numbers behind the detail line (tooltip). */
  detailTitle?: string;
};

/** The big number of a row as shown: "312 mil" on XP boards, "1.234" elsewhere. */
export const shownValue = (display: RowDisplay) =>
  display.compact ? formatCompact(display.value) : display.value.toLocaleString("pt-BR");

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
    case "nivel":
    case "novatos": {
      // The level is the score; the total XP (millions, past the first levels) only in the tooltip.
      const progress = levelFromXp(p.totalXp);
      const pct = Math.floor(Math.min(1, progress.fraction) * 100);
      return {
        value: p.value,
        unit: "nível",
        detail: `${pct}% do nível ${p.value + 1}`,
        detailTitle: `${formatExact(p.totalXp)} XP no total`,
        bar: Math.min(1, progress.fraction),
        barLabel: `XP de @${p.handle} para o nível ${p.value + 1}`,
      };
    }
    case "semana":
      return {
        value: p.value,
        unit: "XP",
        // Community XP (photos, likes, answers) counts here like any other: the row says how much.
        detail: p.secondary > 0 ? `Nível ${p.level} · ${formatCompact(p.secondary)} da comunidade` : `Nível ${p.level}`,
        detailTitle:
          p.secondary > 0
            ? `${formatExact(p.secondary)} XP de fotos, curtidas e respostas nos últimos 7 dias`
            : undefined,
        compact: true,
        valueTitle: `${formatExact(p.value)} XP nos últimos 7 dias`,
        ...relative("XP da semana"),
      };
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
        unit: "Tralked",
        detail: `${fmt(p.secondary)} ${plural(p.secondary, "conquista", "conquistas")}`,
        ...relative("Tralked"),
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

type CountedMetric = Exclude<Metric, "nivel" | "semana" | "novatos" | "genero" | "horas" | "conquistas">;

const GAP_UNIT: Record<CountedMetric, [string, string]> = {
  raras: ["conquista rara", "conquistas raras"],
  platinas: ["Tralked", "Tralked"],
  acervo: ["ponto de Acervo", "pontos de Acervo"],
};

/** What breaks a tie on each board after the main value (see STAT_FIELDS in queries.ts). */
const TIE_BREAK_UNIT: Record<CountedMetric, [string, string]> = {
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
  /** "Faltam 1,2 mi XP": XP gaps run into the millions, so they are abbreviated. */
  const xpGap = (xp: number) => `${xp === 1 ? "Falta" : "Faltam"} ${formatCompact(xp)} XP`;
  switch (board.metric) {
    case "nivel":
    case "novatos": {
      const xp = above.totalXp - me.totalXp;
      return xp > 0 ? reach(xpGap(xp)) : byName;
    }
    case "semana": {
      const xp = above.value - me.value;
      return xp > 0 ? reach(xpGap(xp)) : `${TIED} ${who} na semana`;
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

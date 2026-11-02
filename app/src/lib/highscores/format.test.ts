import { describe, expect, it } from "vitest";
import { deltaText, gapText, rowDisplay, shortDay, shownValue } from "./format";
import type { RankedPlayer } from "./queries";

const player = (over: Partial<RankedPlayer>): RankedPlayer => ({
  userId: "u",
  handle: "eu",
  displayName: "Eu",
  avatarUrl: null,
  vocation: "Recruta",
  level: 10,
  totalXp: 10_000,
  value: 0,
  secondary: 0,
  extra: 0,
  ...over,
});

describe("rowDisplay", () => {
  it("shows hours (not minutes) against the leader", () => {
    const d = rowDisplay({ metric: "horas", scope: "all" }, player({ value: 125 }), 250);
    expect(d).toMatchObject({ value: 2, unit: "h", bar: 0.5 });
  });

  it("shows the XP bar inside the level on Nível", () => {
    const d = rowDisplay({ metric: "nivel" }, player({ value: 10, totalXp: 10_000 }), 99);
    expect(d.unit).toBe("nível");
    expect(d.bar).toBeGreaterThanOrEqual(0);
    expect(d.bar).toBeLessThanOrEqual(1);
    // The level and the progress inside it; the total XP only in the tooltip.
    expect(d.detail).toMatch(/^\d+% do nível 11$/);
    expect(d.detailTitle).toBe("10.000 XP no total");
  });

  it("abbreviates the week's XP and keeps the exact value in the tooltip", () => {
    const d = rowDisplay({ metric: "semana" }, player({ value: 312_400, level: 8 }), 624_800);
    expect(d).toMatchObject({ unit: "XP", detail: "Nível 8", compact: true, bar: 0.5 });
    expect(shownValue(d).replace(/\u00a0/g, " ")).toBe("312,4 mil");
    expect(d.valueTitle).toBe("312.400 XP nos últimos 7 dias");
  });

  it("describes Acervo with played and owned games", () => {
    const d = rowDisplay({ metric: "acervo", scope: "all" }, player({ value: 155, secondary: 17, extra: 14 }), 155);
    expect(d).toMatchObject({ value: 155, detail: "14 jogados de 17 jogos", bar: 1 });
  });
});

describe("gapText", () => {
  it("names the distance to the player above", () => {
    const horas = { metric: "horas", scope: "all" } as const;
    expect(gapText(horas, player({ value: 60 }), player({ handle: "ana", value: 200 }))).toBe("Faltam 3 h para alcançar @ana");
    expect(gapText(horas, player({ value: 60 }), player({ handle: "ana", value: 90 }))).toBe("Falta menos de 1 h para alcançar @ana");
    expect(gapText(horas, player({ value: 60 }), player({ handle: "ana", value: 60 }))).toBe(
      "Empatado com @ana nas horas (o desempate é pelo nome)",
    );
    expect(gapText({ metric: "conquistas", scope: "psn" }, player({ value: 1 }), player({ handle: "ana", value: 2 }))).toBe(
      "Falta 1 conquista para alcançar @ana",
    );
    expect(gapText({ metric: "nivel" }, player({ totalXp: 1000 }), player({ handle: "ana", totalXp: 2500 }))).toBe(
      "Faltam 1.500 XP para alcançar @ana",
    );
    expect(gapText({ metric: "genero", skill: "rpg" }, player({ value: 3 }), player({ handle: "ana", value: 5 }))).toBe(
      "Faltam 2 níveis para alcançar @ana",
    );
  });

  it("abbreviates big XP gaps (Nível, Novatos, Esta semana)", () => {
    const nbsp = (s: string) => s.replace(/ /g, " ");
    expect(
      nbsp(gapText({ metric: "novatos" }, player({ totalXp: 1_000 }), player({ handle: "ana", totalXp: 1_201_000 }))),
    ).toBe("Faltam 1,2 mi XP para alcançar @ana");
    expect(
      nbsp(gapText({ metric: "semana" }, player({ value: 10_000 }), player({ handle: "ana", value: 22_500 }))),
    ).toBe("Faltam 12,5 mil XP para alcançar @ana");
    expect(gapText({ metric: "semana" }, player({ value: 50 }), player({ handle: "ana", value: 50 }))).toBe(
      "Empatado com @ana na semana",
    );
  });
});

describe("gapText on a tie of the main value", () => {
  it("names the tie-breaker gap when there is one", () => {
    const raras = { metric: "raras", scope: "all" } as const;
    expect(gapText(raras, player({ value: 5, secondary: 1 }), player({ handle: "ana", value: 5, secondary: 3 }))).toBe(
      "Empatado com @ana em conquistas raras; faltam 2 lendárias para desempatar",
    );
    expect(
      gapText({ metric: "acervo", scope: "all" }, player({ value: 90, secondary: 9 }), player({ handle: "ana", value: 90, secondary: 10 })),
    ).toBe("Empatado com @ana em pontos de Acervo; falta 1 jogo na biblioteca para desempatar");
    expect(
      gapText({ metric: "platinas", scope: "psn" }, player({ value: 2, secondary: 7 }), player({ handle: "ana", value: 2, secondary: 7 })),
    ).toBe("Empatado com @ana (o desempate é pelo nome)");
    expect(gapText({ metric: "nivel" }, player({ totalXp: 5 }), player({ handle: "ana", totalXp: 5 }))).toBe(
      "Empatado com @ana (o desempate é pelo nome)",
    );
  });
});

describe("deltaText", () => {
  it("reads the change since the snapshot", () => {
    expect(deltaText(2, 5, false)).toBe("Subiu 3 posições");
    expect(deltaText(4, 3, false)).toBe("Caiu 1 posição");
    expect(deltaText(4, 4, false)).toBe("Manteve a posição");
    expect(deltaText(4, null, true)).toBe("Entrou no ranking");
    expect(deltaText(4, null, false)).toBeNull();
    expect(shortDay("2026-10-30")).toBe("30/10");
  });
});

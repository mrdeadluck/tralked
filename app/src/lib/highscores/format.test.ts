import { describe, expect, it } from "vitest";
import { deltaText, gapText, rowDisplay, shortDay } from "./format";
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
    expect(d.detail).toBe("10.000 XP");
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
    expect(gapText(horas, player({ value: 60 }), player({ handle: "ana", value: 90 }))).toBe("Faltam menos de 1 h para alcançar @ana");
    expect(gapText(horas, player({ value: 60 }), player({ handle: "ana", value: 60 }))).toBe("Empatado com @ana");
    expect(gapText({ metric: "conquistas", scope: "psn" }, player({ value: 1 }), player({ handle: "ana", value: 2 }))).toBe(
      "Faltam 1 conquista para alcançar @ana",
    );
    expect(gapText({ metric: "nivel" }, player({ totalXp: 1000 }), player({ handle: "ana", totalXp: 2500 }))).toBe(
      "Faltam 1.500 XP para alcançar @ana",
    );
    expect(gapText({ metric: "genero", skill: "rpg" }, player({ value: 3 }), player({ handle: "ana", value: 5 }))).toBe(
      "Faltam 2 níveis para alcançar @ana",
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

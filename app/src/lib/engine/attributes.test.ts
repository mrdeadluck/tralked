import { describe, expect, it } from "vitest";
import {
  ATTRIBUTES,
  attributeLevel,
  colecaoPoints,
  computeAttributes,
  constanciaPoints,
  exploracaoPoints,
  gloriaPoints,
  precisaoPoints,
  sabedoriaPoints,
  vigorPoints,
  resistenciaPoints,
  acervoPoints,
} from "./attributes";

describe("ATTRIBUTES", () => {
  it("has the 9 attributes in order with pt-BR names and descriptions", () => {
    expect(ATTRIBUTES.map((a) => a.id)).toEqual([
      "vigor",
      "precisao",
      "gloria",
      "colecao",
      "exploracao",
      "constancia",
      "sabedoria",
      "resistencia",
      "acervo",
    ]);
    expect(ATTRIBUTES.map((a) => a.name)).toEqual([
      "Vigor",
      "Precisão",
      "Glória",
      "Coleção",
      "Exploração",
      "Constância",
      "Sabedoria",
      "Resistência",
      "Acervo",
    ]);
    for (const a of ATTRIBUTES) expect(a.description.length).toBeGreaterThan(10);
  });
});

describe("attributeLevel", () => {
  it("is floor(sqrt(points / 25)) + 1", () => {
    expect(attributeLevel(0)).toBe(1);
    expect(attributeLevel(24)).toBe(1);
    expect(attributeLevel(25)).toBe(2);
    expect(attributeLevel(99)).toBe(2);
    expect(attributeLevel(100)).toBe(3);
    expect(attributeLevel(2500)).toBe(11);
  });
});

describe("per-source formulas", () => {
  it("vigor: round(40 * log2(1 + hours)) per game, summed", () => {
    expect(vigorPoints([600])).toBe(138); // 10h
    expect(vigorPoints([60])).toBe(40); // 1h -> 40 * log2(2)
    expect(vigorPoints([0])).toBe(0);
    expect(vigorPoints([600, 120])).toBe(138 + 63);
  });

  it("precisao: 30 per achievement <= 5%, +15 when hardcore", () => {
    expect(
      precisaoPoints([
        { globalPct: 5, hardcore: false },
        { globalPct: 5.1, hardcore: false },
        { globalPct: 1, hardcore: true },
        { globalPct: null, hardcore: true },
      ]),
    ).toBe(30 + 45);
  });

  it("gloria: sum of glory points x10", () => {
    expect(gloriaPoints(["bronze", "silver", "gold", "platinum"])).toBe(230);
  });

  it("colecao: 250 per completed game", () => {
    expect(colecaoPoints(3)).toBe(750);
  });

  it("exploracao: 20 per game with an unlock + 60 per distinct genre", () => {
    expect(exploracaoPoints(3, 5)).toBe(360);
  });

  it("constancia: 15 per active day + 5 x best streak", () => {
    expect(constanciaPoints(42, 9)).toBe(675);
  });

  it("sabedoria: sabio skill points + 40 per solved answer + 100 per guide", () => {
    expect(sabedoriaPoints(310, 3, 2)).toBe(630);
  });

  it("resistencia: round(10 * hours^0.7) of the total playtime", () => {
    expect(resistenciaPoints(0)).toBe(0);
    expect(resistenciaPoints(-10)).toBe(0);
    expect(resistenciaPoints(60)).toBe(10);
    expect(resistenciaPoints(100 * 60)).toBe(251);
    expect(resistenciaPoints(3000 * 60)).toBe(2716);
  });

  it("acervo: 10 per game played + 5 per game owned and never played", () => {
    expect(acervoPoints(12, 7)).toBe(155);
    expect(acervoPoints(0, 0)).toBe(0);
  });
});

describe("computeAttributes", () => {
  it("composes every source for a realistic multi-game profile", () => {
    const result = computeAttributes({
      games: [
        {
          playtimeMin: 600,
          unlocked: [
            { globalPct: 1.5, hardcore: false, tier: "gold" },
            { globalPct: 4, hardcore: true, tier: "gold" },
            { globalPct: 12, hardcore: false, tier: "silver" },
            { globalPct: 60, hardcore: false, tier: "bronze" },
          ],
          completed: false,
          skills: ["soulslike", "rpg"],
        },
        {
          playtimeMin: 120,
          unlocked: [
            { globalPct: null, hardcore: false, tier: "bronze" },
            { globalPct: 5, hardcore: false, tier: "gold" },
          ],
          completed: false,
          skills: ["plataforma"],
        },
        {
          playtimeMin: 3000,
          unlocked: [
            { globalPct: 0.8, hardcore: true, tier: "platinum" },
            { globalPct: 30, hardcore: false, tier: "bronze" },
          ],
          completed: true,
          skills: ["puzzle", "rpg"],
        },
        {
          playtimeMin: 30,
          unlocked: [],
          completed: false,
          skills: ["fps", "sabio"],
        },
      ],
      activeDays: 42,
      bestStreak: 9,
      sabioPoints: 310,
      solvedAnswers: 3,
      publishedGuides: 2,
    });

    expect(result).toEqual({
      vigor: { points: 451, level: 5 }, // 138 + 63 + 227 + 23
      precisao: { points: 150, level: 3 }, // 30+45 | 30 | 45
      gloria: { points: 350, level: 4 }, // (5+5+2+1 + 1+5 + 15+1) * 10
      colecao: { points: 250, level: 4 },
      exploracao: { points: 360, level: 4 }, // 3 games * 20 + 5 genres * 60 (sabio is not a genre)
      constancia: { points: 675, level: 6 },
      sabedoria: { points: 630, level: 6 },
      resistencia: { points: 181, level: 3 }, // 3750 min = 62.5 h
      acervo: { points: 40, level: 2 }, // 4 played games
    });
  });

  it("acervo counts owned-but-never-played games at half; they add nothing elsewhere", () => {
    const base = { activeDays: 0, bestStreak: 0, sabioPoints: 0, solvedAnswers: 0, publishedGuides: 0 };
    const unplayed = { playtimeMin: 0, unlocked: [], completed: false, skills: [] };
    const result = computeAttributes({
      ...base,
      games: [{ playtimeMin: 600, unlocked: [], completed: false, skills: [] }, unplayed, unplayed],
    });
    expect(result.acervo.points).toBe(10 + 5 + 5);
    expect(result.resistencia.points).toBe(resistenciaPoints(600));
    expect(result.vigor.points).toBe(vigorPoints([600]));
    expect(result.exploracao.points).toBe(0);
  });

  it("returns level 1 with 0 points for an empty profile", () => {
    const result = computeAttributes({
      games: [],
      activeDays: 0,
      bestStreak: 0,
      sabioPoints: 0,
      solvedAnswers: 0,
      publishedGuides: 0,
    });
    for (const a of ATTRIBUTES) expect(result[a.id]).toEqual({ points: 0, level: 1 });
  });
});

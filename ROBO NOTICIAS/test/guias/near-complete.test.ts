import { describe, expect, it } from "vitest";
import { statedGameTotals } from "../../src/guias/completeness.js";
import { buildDossier, type SteamAchievement } from "../../src/guias/dossier.js";
import type { ExtractedFacts } from "../../src/guias/facts.js";
import { gate } from "../../src/guias/gate.js";
import { ach, fact, item, steamAch } from "./helpers-dossier.js";

/**
 * R39: a "collect N" still short after the re-reads by less than one whole unit passes the gate when a source states a
 * total of that collectible that reaches N; the guide says honestly how many the sources locate.
 */

const STEAM: SteamAchievement[] = [steamAch("ACH_043", "Complete Mastery", "Collect 10 Sha-Chi Ambers")];
/** PowerPyx's Collectibles page: the game's totals, shards of Sha-Chi Amber among them. */
const SUMMARY =
  "Phantom Blade Zero contains 564 Collectibles Locations (161 Bells, 42 Weapons & Phantom Edges, 80 Accessories & Medicine, " +
  "13 Challenge Locations, 40 Sha-Chi Amber Shards, 40 Blackstone Shards, 129 Memory Flowers, 43 Tempering Materials, 16 Treasures) and 30 Side Tales.";

/** A complete PSN script whose route lists `shards` Sha-Chi Amber shards (4 make one Amber). */
function lead(shards: number): ExtractedFacts {
  return fact("PowerPyx", "roteiro_psn", {
    achievements: [ach("Complete Mastery", { howTo: "Collect 10 Sha-Chi Ambers; 4 shards combine into a whole Amber." })],
    chapters: [
      {
        title: "First Visit",
        region: "Weeping Creek Valley",
        order: 1,
        items: Array.from({ length: shards }, (_, i) => item("Sha-Chi Amber Shard", { collectibleType: "Sha-Chi Amber Shard", location: `Ponto ${i + 1}` })),
      },
    ],
  });
}

type Unread = Parameters<typeof buildDossier>[3];
const build = (shards: number, summary: string | null = SUMMARY, unread: Unread = []) => {
  const f = lead(shards);
  return buildDossier(STEAM, [f], [[f.source.url]], unread, {}, {}, summary ? { [f.source.url]: statedGameTotals(summary) } : {});
};

describe("statedGameTotals", () => {
  it("lê os totais do jogo que a página declara entre parênteses depois de 'N Collectibles Locations'", () => {
    expect(statedGameTotals(SUMMARY)).toEqual([
      { label: "Bells", total: 161 },
      { label: "Weapons & Phantom Edges", total: 42 },
      { label: "Accessories & Medicine", total: 80 },
      { label: "Challenge Locations", total: 13 },
      { label: "Sha-Chi Amber Shards", total: 40 },
      { label: "Blackstone Shards", total: 40 },
      { label: "Memory Flowers", total: 129 },
      { label: "Tempering Materials", total: 43 },
      { label: "Treasures", total: 16 },
    ]);
  });

  it("a página de região (só 'contains 83 Collectible Locations', sem a lista) não declara total do jogo", () => {
    expect(statedGameTotals("Crimson Forest is the 2nd region in Phantom Blade Zero and contains 83 Collectible Locations. This walkthrough...")).toEqual([]);
  });
});

describe("R39: contagem quase completa com o total declarado por uma fonte", () => {
  it.each([
    [38, 9.5, 2],
    [39, 9.75, 1],
  ])("%i fragmentos (%f de 10) com 40 declarados → passa, com os números do dossiê", (shards, counted, missing) => {
    const d = build(shards);
    const c = d.achievements[0]!.collect!;
    expect(c).toMatchObject({ target: 10, counted });
    expect(c.shortfallAccepted).toEqual({ located: shards, stated: 40, missing, label: "Sha-Chi Amber Shards", source: "PowerPyx" });
    expect(gate(d, STEAM)).toEqual({ ok: true, missing: [] });
    expect(d.divergences.some((x) => x.includes('"Complete Mastery" (ACH_043): contagem incompleta aceita (R39)') && x.includes(`${shards} de 40 Sha-Chi Amber Shards`))).toBe(true);
  });

  it("9 de 10 (uma unidade inteira faltando) → continua falhando", () => {
    const d = build(36);
    expect(d.achievements[0]!.collect).toMatchObject({ target: 10, counted: 9 });
    expect(d.achievements[0]!.collect!.shortfallAccepted).toBeUndefined();
    expect(gate(d, STEAM).missing).toContain('A conquista "Complete Mastery" (ACH_043) pede 10, mas os itens encontrados somam 9.');
    expect(d.divergences.some((x) => x.includes("R39"))).toBe(false);
  });

  it("sem total declarado por nenhuma fonte → falha", () => {
    const d = build(38, null);
    expect(d.achievements[0]!.collect!.shortfallAccepted).toBeUndefined();
    expect(gate(d, STEAM).missing).toContain('A conquista "Complete Mastery" (ACH_043) pede 10, mas os itens encontrados somam 9.5.');
  });

  it("total declarado que não chega a N (30 fragmentos = 7,5) → falha", () => {
    const d = build(38, SUMMARY.replace("40 Sha-Chi Amber Shards", "30 Sha-Chi Amber Shards"));
    expect(d.achievements[0]!.collect!.shortfallAccepted).toBeUndefined();
    expect(gate(d, STEAM).ok).toBe(false);
  });

  it("o total de outra coisa (Blackstone Shards) não vale para os Sha-Chi Ambers", () => {
    const d = build(38, SUMMARY.replace("40 Sha-Chi Amber Shards, ", ""));
    expect(d.achievements[0]!.collect!.shortfallAccepted).toBeUndefined();
    expect(gate(d, STEAM).ok).toBe(false);
  });
});

describe("R39, revisão 1: só o que as fontes legíveis não mapeiam", () => {
  const region = { name: "PowerPyx (Crimson Forest)", url: "https://example.com/powerpyx-crimson-forest", reason: "HTTP 500", role: "coletaveis" as const };

  it("38/40 com uma página de região do PowerPyx (mesmo site do roteiro principal) não lida → não aceita, gate reprova", () => {
    for (const reason of ["HTTP 500", "extração falhou: timeout", "página de desafio (proteção contra robôs), não contornada"]) {
      const d = build(38, SUMMARY, [{ ...region, reason }]);
      expect(d.achievements[0]!.collect!.shortfallAccepted).toBeUndefined();
      expect(gate(d, STEAM).ok).toBe(false);
      expect(d.divergences.some((x) => x.includes("contagem incompleta não aceita (R39)") && x.includes("PowerPyx (Crimson Forest)"))).toBe(true);
    }
  });

  it("fonte de roteiro de outro site não lida por falha que pode passar → não aceita", () => {
    const tsa = { name: "TrueSteamAchievements", url: "https://www.truesteamachievements.com/x", reason: "HTTP 503", role: "roteiro_steam" as const };
    const d = build(38, SUMMARY, [tsa]);
    expect(d.achievements[0]!.collect!.shortfallAccepted).toBeUndefined();
    expect(gate(d, STEAM).ok).toBe(false);
  });

  it("fonte de roteiro de outro site que nunca pode ser lida (desafio, robots.txt) e fonte só de coletáveis → aceita", () => {
    const blocked = [
      { name: "PSNProfiles", url: "https://psnprofiles.com/trophies/1", reason: "página de desafio (proteção contra robôs), não contornada", role: "roteiro_psn" as const, blocked: true },
      { name: "TrueSteamAchievements", url: "https://www.truesteamachievements.com/x", reason: "bloqueada pelo robots.txt", role: "roteiro_steam" as const, blocked: true },
      { name: "Mobalytics", url: "https://mobalytics.gg/x", reason: "HTTP 500", role: "coletaveis" as const },
    ];
    const d = build(38, SUMMARY, blocked);
    expect(d.achievements[0]!.collect!.shortfallAccepted).toMatchObject({ located: 38, stated: 40 });
    expect(gate(d, STEAM).ok).toBe(true);
  });

  it("total em unidades inteiras ('10 Sha-Chi Ambers') com contagem fracionária → não aceita (nunca '9,5 de 10')", () => {
    const d = build(38, "The game contains 100 Collectibles Locations (10 Sha-Chi Ambers, 90 Bells).");
    expect(d.achievements[0]!.collect!.shortfallAccepted).toBeUndefined();
    expect(gate(d, STEAM).ok).toBe(false);
  });

  it("o rótulo do total de partes precisa ter todas as palavras da coisa ('Amber Shards' não é 'Sha-Chi Amber')", () => {
    const d = build(38, "The game contains 100 Collectibles Locations (40 Amber Shards, 60 Bells).");
    expect(d.achievements[0]!.collect!.shortfallAccepted).toBeUndefined();
    expect(gate(d, STEAM).ok).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { independentGroups } from "../../src/guias/crossref.js";
import { buildDossier } from "../../src/guias/dossier.js";
import { ach, chapter, fact, item, steamAch } from "./helpers-dossier.js";

const words = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");

describe("independentGroups", () => {
  it("fontes quase idênticas contam como uma", () => {
    const original = words("palavra", 300);
    const copy = `${original} nota extra do copiador`;
    const groups = independentGroups([
      { url: "https://powerpyx.com/pbz", text: original },
      { url: "https://copycat.example/pbz", text: copy },
      { url: "https://grindnstrat.com/pbz", text: words("outro", 300) },
    ]);
    expect(groups).toEqual([["https://powerpyx.com/pbz", "https://copycat.example/pbz"], ["https://grindnstrat.com/pbz"]]);
  });
});

describe("buildDossier: fontes por item", () => {
  const steam = [steamAch("ACH_013", "With Heart and Blood", "Complete the story.")];
  const powerpyx = fact("PowerPyx", "roteiro_psn", {
    chapters: [
      chapter("Weeping Creek", [
        item("Fragmento de Pedra Negra", { collectibleType: "Blackstone Shard", index: 1, total: 4 }),
        item("Long Pillar", { kind: "other" }),
      ]),
    ],
  });
  const grind = fact("Grindnstrat", "coletaveis", {
    chapters: [chapter("Weeping Creek", [item("Fragmento de Pedra Negra", { collectibleType: "Blackstone Shard", index: 1, total: 4 })])],
  });
  const groups = [[powerpyx.source.url], [grind.source.url]];

  it("item em 2 grupos fica agreed", () => {
    const d = buildDossier(steam, [powerpyx, grind], groups);
    const shard = d.chapters[0]!.items.find((i) => i.index === 1)!;
    expect(shard.sources).toEqual(["PowerPyx", "Grindnstrat"]);
    expect(shard.agreed).toBe(true);
  });

  it("item só no PowerPyx fica com uma fonte", () => {
    const d = buildDossier(steam, [powerpyx, grind], groups);
    const pillar = d.chapters[0]!.items.find((i) => i.name === "Long Pillar")!;
    expect(pillar.sources).toEqual(["PowerPyx"]);
    expect(pillar.agreed).toBe(false);
  });

  it("duas páginas do mesmo grupo contam uma fonte só", () => {
    const d = buildDossier(steam, [powerpyx, grind], [[powerpyx.source.url, grind.source.url]]);
    const shard = d.chapters[0]!.items.find((i) => i.index === 1)!;
    expect(shard.sources).toEqual(["PowerPyx"]);
    expect(shard.agreed).toBe(false);
  });

  it("a conquista ganha as fontes de entrada e de item, e o casamento com a Steam", () => {
    const f = fact("PowerPyx", "roteiro_psn", {
      achievements: [ach("With Heart and Blood")],
      chapters: [chapter("Weeping Creek", [item("Final", { kind: "achievement", achievementNameEn: "With Heart & Blood" })])],
    });
    const d = buildDossier(steam, [f], [[f.source.url]]);
    expect(d.achievements[0]!.sources).toEqual(["PowerPyx"]);
    expect(d.chapters[0]!.items[0]!.achievement).toBe("ACH_013");
  });
});

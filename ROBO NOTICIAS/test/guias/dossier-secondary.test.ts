import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { statedSequence } from "../../src/guias/chapter-order.js";
import { independentGroups } from "../../src/guias/crossref.js";
import { buildDossier, type SteamAchievement } from "../../src/guias/dossier.js";
import type { ExtractedFacts } from "../../src/guias/facts.js";
import { gate } from "../../src/guias/gate.js";
import { buildReport } from "../../src/guias/report.js";
import { chapter, fact, item, steamAch } from "./helpers-dossier.js";

type Fixture = { steam: SteamAchievement[]; aliases: Record<string, string[]>; facts: ExtractedFacts[]; intro: Record<string, string> };
const fixture = JSON.parse(readFileSync(new URL("./fixtures/pbz-trimmed-facts.json", import.meta.url), "utf8")) as Fixture;

function build(steam: SteamAchievement[] = fixture.steam, facts: ExtractedFacts[] = fixture.facts) {
  const pages = facts.map((f) => ({ url: f.source.url, text: fixture.intro[f.source.url] ?? "" }));
  const sequence = Object.fromEntries(pages.flatMap((p) => {
    const n = statedSequence(p.text);
    return n === undefined ? [] : [[p.url, n] as const];
  }));
  return buildDossier(steam, facts, independentGroups(pages), [], fixture.aliases, sequence);
}

describe("itens só de fonte secundária (R30)", () => {
  it("guardam o que a fonte diz (perdível, até quando, voltar depois, conta para) e vão para o relatório como não posicionados", () => {
    const d = build();
    const ribbon = d.corroborationOnly.find((c) => c.name === "少主红丝带")!;
    expect(ribbon).toEqual({
      name: "少主红丝带",
      kind: "collectible",
      collectibleType: "少主红丝带",
      chapter: "陆家村",
      source: "Steam: 影之刃零全成就指南 (Lankec)",
      missable: true,
      missableUntil: "乘电梯离开陆家村",
      returnLater: false,
      countsFor: [],
      countsForEn: [],
    });
    const healer = d.corroborationOnly.find((c) => c.name === "Apprentice Healer")!;
    expect(healer).toMatchObject({ countsFor: ["ACH_HEALER"], countsForEn: ["The Healer's Legacy"] });

    const report = buildReport({ sourcesRead: [], dossier: d, steamList: fixture.steam, spendUsd: 0 });
    expect(report.unplaced?.title).toBe("Itens só de fonte secundária, não posicionados");
    expect(report.unplaced?.items).toHaveLength(d.corroborationOnly.length);
    expect(report.unplaced?.items).toContainEqual(expect.objectContaining({ name: "乱莺剑", source: "Steam: 影之刃零全成就指南 (Lankec)", chapter: "陆家村", missable: true }));
  });

  it("perdível só em fonte secundária vira aviso nas divergências; a porta não reprova por isso e a rota não ganha o item", () => {
    const d = build();
    expect(d.divergences).toContainEqual(expect.stringMatching(/^3 itens perdíveis aparecem só em fonte secundária e ficaram fora da rota \(sem posição\): 少主红丝带, 乱莺剑, 杀气琥珀碎片\./));
    expect(d.chapters.flatMap((c) => c.items).some((i) => i.name === "乱莺剑")).toBe(false);
    expect(gate(d, fixture.steam).missing.join("\n")).not.toContain("乱莺剑");
  });

  it("casa de novo pelo nameEn quando o nome da fonte é ambíguo", () => {
    const powerpyx = fact("PowerPyx", "roteiro_psn", {
      chapters: [chapter("Weeping Creek", [item("Memory Flower"), item("Yu'er's Memory Flower"), item("Memory Flower")])],
    });
    // "Memory Flower" alone is three items; its English name is one.
    const zh = fact("Steam: 指南", "roteiro_steam", {
      complete: false,
      chapters: [chapter("Weeping Creek", [item("Memory Flower", { nameEn: "Yu’er’s Memory Flower" })])],
    });
    const d = buildDossier([steamAch("ACH_END", "The End", "Finish.")], [powerpyx, zh], [[powerpyx.source.url], [zh.source.url]]);
    expect(d.chapters[0]!.items.find((i) => i.name === "Yu'er's Memory Flower")).toMatchObject({ agreed: true });
    expect(d.corroborationOnly).toEqual([]);
  });
});

describe("item contado sem número (R28)", () => {
  it("recebe o próximo número do capítulo e do tipo, marcado como assumido; o R23 não reprova", () => {
    const steam = [...fixture.steam, steamAch("ACH_FLOWER", "Listen to Every Flower", "Collect 2 Memory Flowers")];
    // Two Memory Flowers count: one numbered in Weeping Creek's cleanup (#58, renumbered), one without number in Mirage Estate.
    const facts = fixture.facts.map((f) => ({
      ...f,
      chapters: f.chapters.map((c) => ({
        ...c,
        items: c.items.map((i) => (i.collectibleType === "Memory Flower" && f.source.name.startsWith("PowerPyx (") && (i.index !== undefined || c.title === "Mirage Estate") ? { ...i, countsForEn: ["Listen to Every Flower"] } : i)),
      })),
    }));
    const d = build(steam, facts);
    const mirage = d.chapters.find((c) => c.title === "Mirage Estate")!.items.find((i) => i.collectibleType === "Memory Flower")!;
    expect(mirage).toMatchObject({ index: 1, numbering: "chapter", numberAssumed: true });
    const flower = d.achievements.find((a) => a.apiName === "ACH_FLOWER")!;
    expect(flower.collect).toMatchObject({ target: 2, counted: 2, indexProblems: [] });
    expect(gate(d, steam).missing.join("\n")).not.toContain("sem número");
  });
});

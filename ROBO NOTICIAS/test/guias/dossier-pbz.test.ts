import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { statedSequence } from "../../src/guias/chapter-order.js";
import { independentGroups } from "../../src/guias/crossref.js";
import { buildDossier, type SteamAchievement } from "../../src/guias/dossier.js";
import type { ExtractedFacts } from "../../src/guias/facts.js";
import { buildSkeleton } from "../../src/guias/skeleton.js";

/**
 * C1 on the structure of the real Phantom Blade Zero cache (trimmed): the PowerPyx roadmap's "Step N" chapters,
 * three region pages that arrive out of order (Mirage Estate, the 8th region, before Crimson Forest, the 2nd), each
 * with its "Clean Up Visits", a cross-page "Crimson Forest Cleanup #3" on the Mirage Estate page, a Chinese Steam
 * guide and an allthings.how page.
 */
type Fixture = {
  steam: SteamAchievement[];
  aliases: Record<string, string[]>;
  facts: ExtractedFacts[];
  intro: Record<string, string>;
};
const fixture = JSON.parse(readFileSync(new URL("./fixtures/pbz-trimmed-facts.json", import.meta.url), "utf8")) as Fixture;

function build() {
  const pages = fixture.facts.map((f) => ({ url: f.source.url, text: fixture.intro[f.source.url] ?? "" }));
  const sequence = Object.fromEntries(pages.flatMap((p) => {
    const n = statedSequence(p.text);
    return n === undefined ? [] : [[p.url, n] as const];
  }));
  return buildDossier(fixture.steam, fixture.facts, independentGroups(pages), [], fixture.aliases, sequence);
}

describe("buildDossier no cache real do Phantom Blade Zero (C1)", () => {
  it("a página diz a própria posição: 'is the 8th region'", () => {
    expect(statedSequence(fixture.intro["https://www.powerpyx.com/phantom-blade-zero-mirage-estate-pangzhen-collectible-locations/"]!)).toBe(8);
    expect(statedSequence("Mount Soulrend is the 9th and final region in Phantom Blade Zero")).toBe(9);
    expect(statedSequence("Estimated trophy difficulty: 4/10")).toBeUndefined();
  });

  it("capítulos em ordem cronológica: regiões pela ordem que o PowerPyx declara, revisitas sem posição declarada no fim", () => {
    const d = build();
    expect(d.chapters.map((c) => c.title)).toEqual([
      "First Visit — Weeping Creek Valley",
      "First Visit — Crimson Forest",
      "Mirage Estate",
      // On the Mirage Estate page: the source itself puts it right after Mirage Estate.
      "Crimson Forest Cleanup #3",
      // Each region page's own revisit: no stated position, after the last first visit, for review.
      "Clean Up Visits — Weeping Creek Valley",
      "Clean Up Visits — Crimson Forest",
    ]);
    expect(d.chapters.map((c) => c.order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(d.chapters.map((c) => Boolean(c.orderAssumed))).toEqual([false, false, false, false, true, true]);
    for (const c of d.chapters.slice(4)) expect(c.items.every((i) => i.orderAssumed)).toBe(true);
    expect(d.primaryScript).toEqual({ name: "PowerPyx", chapters: d.chapters.map((c) => c.title) });
  });

  it("os 'Step N' do roadmap são etapas, não capítulos", () => {
    const d = build();
    expect(d.chapters.some((c) => /^Step \d/.test(c.title))).toBe(false);
    expect(d.facts.roadmap.map((r) => r.title)).toEqual([
      "Step 1: Complete the Game up to the Mirage Estate",
      "Step 2: Complete True Ending Requirements",
      "Step 3: Obtain the True Ending",
      "Step 4: Trophy Clean Up",
    ]);
    expect(buildSkeleton(d).phases.map((p) => p.title)).toEqual(d.facts.roadmap.map((r) => r.title));
  });

  it("fontes secundárias nunca criam capítulos: o que casa vira fonte do item do PowerPyx, o resto só corrobora", () => {
    const d = build();
    const titles = d.chapters.map((c) => c.title);
    for (const secondary of ["必读注意事项", "陆家村", "Quest objectives for story and side quest achievements"]) {
      expect(titles.some((t) => t.includes(secondary))).toBe(false);
    }
    const flesh = d.chapters[0]!.items.find((i) => i.name === "Flesh Lily")!;
    expect(flesh).toMatchObject({ agreed: true, sources: ["PowerPyx", "allthings.how"] });
    expect(flesh.sourceLinks.map((l) => l.name)).toEqual(["PowerPyx (Weeping Creek Valley)", "allthings.how"]);
    expect(d.corroborationOnly.map((c) => c.name).sort()).toEqual(["Apprentice Healer", "乱莺剑", "少主红丝带", "杀气琥珀碎片", "见习医师", "隔绝楔子"].sort());
    // A corroboration-only item still covers its achievement in the gate.
    const healer = d.achievements.find((a) => a.apiName === "ACH_HEALER")!;
    expect(healer.sources).toContain("allthings.how");
    // The roadmap and the three region pages are one site: one independent group.
    expect(d.chapters.flatMap((c) => c.items).filter((i) => i.sources.includes("PowerPyx")).length).toBe(
      d.chapters.flatMap((c) => c.items).length,
    );
  });

  it("número corrido do PowerPyx (#1…#55 entre tipos) vira numeração por tipo dentro do capítulo", () => {
    const d = build();
    const first = d.chapters[0]!.items;
    const byName = (name: string) => first.find((i) => i.name === name)!;
    expect(byName("Bell (The Beginning)").index).toBe(1);
    expect(byName("Bell (First Meeting with Yu'er)").index).toBe(3);
    expect(byName("Hunter's Insight").index).toBe(1);
    expect(byName("Ancient Armor Fragment").index).toBe(2);
    expect(first.every((i) => i.total === undefined)).toBe(true);
  });
});

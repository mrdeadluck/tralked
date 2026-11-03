import { describe, expect, it } from "vitest";
import { buildDossier, type SteamAchievement } from "../../src/guias/dossier.js";
import type { ExtractedFacts } from "../../src/guias/facts.js";
import { ach, chapter, fact, item, steamAch } from "./helpers-dossier.js";

const steam = (): SteamAchievement[] => [
  steamAch("ACH_HEART", "With Heart and Blood", "All Comes to Light"),
  steamAch("ACH_LOST", "Lost and Found", "Complete [Quick Hand's Request]"),
];

const build = (facts: ExtractedFacts[], aliases?: Record<string, string[]>) =>
  buildDossier(steam(), facts, facts.map((f) => [f.source.url]), [], aliases);

describe("buildDossier: nomes localizados da Steam", () => {
  const ruGuide = () =>
    fact("Steam: гайд на 100%", "roteiro_steam", {
      achievements: [ach("Сердцем и кровью", { missable: true, missableUntil: "финал игры" })],
      chapters: [chapter("Сказания", [item("Быстрая Рука Чжан", { kind: "other", achievementNameEn: "Потерянное и найденное" })])],
    });

  it("sem os nomes localizados, o guia russo não casa com nada", () => {
    const d = build([ruGuide()]);
    expect(d.achievements.every((a) => a.sources.length === 0)).toBe(true);
    expect(d.divergences.some((x) => x.includes("Сердцем и кровью"))).toBe(true);
  });

  it("com os nomes da Steam em russo e chinês, o guia cobre as conquistas (por entrada e por item)", () => {
    const zhGuide = fact("Steam: 全成就", "roteiro_steam", { achievements: [ach("「逆天改命」")] }, "https://example.com/zh");
    const d = build([ruGuide(), zhGuide], {
      ACH_HEART: ["Сердцем и кровью", "逆天改命"],
      ACH_LOST: ["Потерянное и найденное", "失物招领"],
    });
    const heart = d.achievements.find((a) => a.apiName === "ACH_HEART")!;
    expect(heart.sources).toEqual(["Steam: гайд на 100%", "Steam: 全成就"]);
    expect(heart.steamSourced).toBe(true);
    expect(heart.missable).toBe(true);
    expect(d.achievements.find((a) => a.apiName === "ACH_LOST")!.sources).toEqual(["Steam: гайд на 100%"]);
    expect(d.chapters[0]!.items[0]!.achievement).toBe("ACH_LOST");
    expect(d.divergences.filter((x) => x.includes("não casa"))).toEqual([]);
  });
});

describe("buildDossier: capítulos", () => {
  const region = (title: string, regionName: string, items: ReturnType<typeof item>[]) => ({ title, region: regionName, order: 1, items });

  it('"First Visit" de regiões diferentes não vira um capítulo só; a mesma região de duas fontes se junta', () => {
    const crimson = fact("PowerPyx (Crimson Forest)", "coletaveis", { chapters: [region("First Visit", "Crimson Forest", [item("Bell (Gate)")])] });
    const meigu = fact("PowerPyx (Meigu Lake)", "coletaveis", { chapters: [region("First Visit", "Meigu Lake", [item("Bell (Shore)")])] });
    const other = fact("Grindnstrat", "coletaveis", { chapters: [region("First Visit", "Crimson Forest", [item("Bell (Gate)")])] });
    const d = build([crimson, meigu, other]);
    expect(d.chapters.map((c) => c.title)).toEqual(["First Visit — Crimson Forest", "First Visit — Meigu Lake"]);
    expect(d.chapters[0]!.items).toHaveLength(1);
    expect(d.chapters[0]!.items[0]!.sources).toEqual(["PowerPyx (Crimson Forest)", "Grindnstrat"]);
  });

  it("uma fonte sem região (ou com a região escrita de outro jeito) junta-se ao capítulo de mesmo título", () => {
    const withRegion = fact("PowerPyx (Crimson Forest)", "coletaveis", {
      chapters: [region("First Visit", "Crimson Forest", [item("Bell (Gate)", { countsForEn: ["Lost and Found"] })])],
    });
    const noRegion = fact("Grindnstrat", "coletaveis", { chapters: [{ title: "First Visit", order: 1, items: [item("Bell (Gate)", { countsForEn: ["Lost and Found"] })] }] });
    const longer = fact("Game8", "coletaveis", { chapters: [region("First visit", "The Crimson Forest", [item("Bell (Gate)", { countsForEn: ["Lost and Found"] })])] });
    const d = build([withRegion, noRegion, longer]);
    expect(d.chapters.map((c) => c.title)).toEqual(["First Visit"]);
    expect(d.chapters[0]!.region).toBe("Crimson Forest");
    expect(d.chapters[0]!.items).toHaveLength(1);
    expect(d.chapters[0]!.items[0]!).toMatchObject({ agreed: true, sources: ["PowerPyx (Crimson Forest)", "Grindnstrat", "Game8"] });
  });

  it("sem região, com dois capítulos de regiões diferentes de mesmo título: não adivinha e fica à parte", () => {
    const crimson = fact("PowerPyx (Crimson Forest)", "coletaveis", { chapters: [region("First Visit", "Crimson Forest", [item("Bell (Gate)")])] });
    const meigu = fact("PowerPyx (Meigu Lake)", "coletaveis", { chapters: [region("First Visit", "Meigu Lake", [item("Bell (Shore)")])] });
    const pangzhen = fact("PowerPyx (Pangzhen)", "coletaveis", { chapters: [{ title: "First Visit", order: 1, items: [item("Bell (Square)")] }] });
    const d = build([crimson, meigu, pangzhen]);
    expect(d.chapters.map((c) => c.title)).toEqual(["First Visit — Crimson Forest", "First Visit — Meigu Lake", "First Visit"]);
  });

  it("um título único fica como está", () => {
    const d = build([fact("PowerPyx", "roteiro_psn", { chapters: [region("Mount Soulrend", "Mount Soulrend", [item("Bell")])] })]);
    expect(d.chapters.map((c) => c.title)).toEqual(["Mount Soulrend"]);
  });
});

describe("buildDossier: prazo de perdível (R20)", () => {
  it("item perdível sem prazo nas fontes: o prazo é o próprio capítulo, marcado como assumido", () => {
    const d = build([
      fact("PowerPyx", "roteiro_psn", {
        chapters: [chapter("Weeping Creek", [item("Selo", { missable: true })]), chapter("Village of Lu", [], 2)],
      }),
    ]);
    expect(d.chapters[0]!.items[0]).toMatchObject({ deadlineChapter: "Weeping Creek", deadlineAssumed: true });
  });

  it("marco que não aponta para capítulo nenhum: também o próprio capítulo", () => {
    const d = build([
      fact("PowerPyx", "roteiro_psn", {
        chapters: [chapter("Weeping Creek", [item("Feather Bow", { missable: true, missableUntil: "defeating the main boss at the end of this region" })])],
      }),
    ]);
    expect(d.chapters[0]!.items[0]).toMatchObject({ deadlineChapter: "Weeping Creek", deadlineAssumed: true });
  });

  it("marco que cita uma região liga ao primeiro capítulo dela a partir do capítulo do item, e vai para revisão", () => {
    const region = (title: string, regionName: string, items: ReturnType<typeof item>[], order: number) => ({ title, region: regionName, order, items });
    const d = build([
      fact("PowerPyx", "roteiro_psn", {
        chapters: [
          region("First Visit", "Weeping Creek Valley", [item("Boulderguard", { missable: true, missableUntil: "Crimson Forest region main boss" })], 1),
          region("First Visit", "Crimson Forest", [item("Bell")], 2),
        ],
      }),
    ]);
    const boulder = d.chapters[0]!.items[0]!;
    expect(boulder.deadlineChapter).toBe("First Visit — Crimson Forest");
    // The region is the code's reading of the milestone, not a chapter the source named.
    expect(boulder.deadlineAssumed).toBe(true);
  });

  it("revisita: o marco que cita a região não aponta para um capítulo anterior ao do item", () => {
    const region = (title: string, regionName: string, items: ReturnType<typeof item>[], order: number) => ({ title, region: regionName, order, items });
    const d = build([
      fact("PowerPyx", "roteiro_psn", {
        chapters: [
          region("First Visit", "Meigu Lake", [item("Bell (Shore)")], 1),
          region("Crimson Forest", "Crimson Forest", [item("Bell (Gate)")], 2),
          region("Second Visit", "Meigu Lake", [item("Ice Lotus", { missable: true, missableUntil: "Meigu Lake main boss" }), item("Bell (Ice)")], 3),
        ],
      }),
    ]);
    const lotus = d.chapters.find((c) => c.title === "Second Visit")!.items[0]!;
    expect(lotus).toMatchObject({ deadlineChapter: "Second Visit", deadlineAssumed: true });
  });

  it("marco explícito que casa com um capítulo continua valendo", () => {
    const d = build([
      fact("PowerPyx", "roteiro_psn", {
        chapters: [chapter("Weeping Creek", [item("Selo", { missable: true, missableUntil: "Village of Lu" })]), chapter("Village of Lu", [], 2)],
      }),
    ]);
    expect(d.chapters[0]!.items[0]!.deadlineChapter).toBe("Village of Lu");
    expect(d.chapters[0]!.items[0]!.deadlineAssumed).toBeUndefined();
  });

  it("conquista perdível sem prazo: o capítulo do item que é ela; sem item, fica sem prazo", () => {
    const withItem = build([
      fact("PowerPyx", "roteiro_psn", {
        achievements: [ach("Lost and Found", { missable: true })],
        chapters: [chapter("Crimson Forest", [item("Quick Hand Zhang", { kind: "other", achievementNameEn: "Lost and Found" })])],
      }),
    ]);
    expect(withItem.achievements.find((a) => a.apiName === "ACH_LOST")).toMatchObject({ deadlineChapter: "Crimson Forest", deadlineAssumed: true });

    const loose = build([fact("PowerPyx", "roteiro_psn", { achievements: [ach("Lost and Found", { missable: true })] })]);
    expect(loose.achievements.find((a) => a.apiName === "ACH_LOST")!.deadlineChapter).toBeUndefined();
  });
});

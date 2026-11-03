import { describe, expect, it } from "vitest";
import { buildDossier, type SteamAchievement } from "../../src/guias/dossier.js";
import type { ExtractedFacts } from "../../src/guias/facts.js";
import { gate } from "../../src/guias/gate.js";
import { ach, chapter, fact, item, steamAch } from "./helpers-dossier.js";

const baseSteam = (): SteamAchievement[] => [
  steamAch("ACH_013", "With Heart and Blood", "Finish the story."),
  steamAch("ACH_HID", "Shadow Blade", "", true),
  steamAch("ACH_STONE", "Leave No Stone Unturned", "Collect 10 Blackstones"),
];

const blackstones = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    item(`Pedra Negra ${i + 1}`, { collectibleType: "Blackstone", index: i + 1, countsForEn: ["Leave No Stone Unturned"] }),
  );

/** A PSN script that covers the whole base list and passes the gate. */
function powerpyx(over: Partial<Omit<ExtractedFacts, "source">> = {}) {
  return fact("PowerPyx", "roteiro_psn", {
    trophyListSize: 3,
    achievements: [
      ach("With Heart and Blood"),
      ach("Shadow Blade", { missable: true, missableUntil: "Weeping Creek" }),
      ach("Leave No Stone Unturned"),
    ],
    chapters: [chapter("Weeping Creek", blackstones(10)), chapter("Village of Lu", [], 2)],
    ...over,
  });
}

function run(steam: SteamAchievement[], facts: ExtractedFacts[]) {
  const d = buildDossier(steam, facts, facts.map((f) => [f.source.url]));
  return { d, result: gate(d, steam) };
}

describe("gate", () => {
  it("aprova um dossiê completo", () => {
    const { d, result } = run(baseSteam(), [powerpyx()]);
    expect(result).toEqual({ ok: true, missing: [] });
    expect(d.facts.compat).toBe("psn");
  });

  it("30 conquistas de arma sem fonte steam → gate falha com 30 linhas", () => {
    const weapons = Array.from({ length: 30 }, (_, i) =>
      steamAch(`ACH_W${String(i + 1).padStart(2, "0")}`, `Master of Weapon ${i + 1}`, `Upgrade weapon ${i + 1} fully.`),
    );
    const collectibles = fact("Grindnstrat", "coletaveis", { achievements: weapons.map((w) => ach(w.name)) });
    const { result } = run([...baseSteam(), ...weapons], [powerpyx(), collectibles]);
    expect(result.ok).toBe(false);
    expect(result.missing).toHaveLength(30);
    expect(result.missing[0]).toContain("existe só na Steam");
  });

  it("uma fonte steam cobre as exclusivas da Steam", () => {
    const weapon = steamAch("ACH_W01", "Master of Weapon 1", "Upgrade weapon 1 fully.");
    const steamGuide = fact("Steam Guide", "roteiro_steam", { achievements: [ach(weapon.name)] });
    const { result } = run([...baseSteam(), weapon], [powerpyx(), steamGuide]);
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it("gate falha quando falta conquista oculta", () => {
    const f = powerpyx({ achievements: [ach("With Heart and Blood"), ach("Leave No Stone Unturned")] });
    const { result } = run(baseSteam(), [f]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['A conquista oculta "Shadow Blade" (ACH_HID) da Steam não aparece em nenhuma fonte.']);
  });

  it("contagem Blackstone 9 de 10 → gate falha", () => {
    const f = powerpyx({ chapters: [chapter("Weeping Creek", blackstones(9)), chapter("Village of Lu", [], 2)] });
    const { result } = run(baseSteam(), [f]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['A conquista "Leave No Stone Unturned" (ACH_STONE) pede 10, mas os itens encontrados somam 9.']);
  });

  it("fragmentos convertidos pela regra das fontes fecham a contagem", () => {
    const steam = [steamAch("ACH_AMBER", "Total Domination", "Collect 2 Amber of Sha-Chi")];
    const shards = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        item(`Fragmento de Âmbar ${i + 1}`, {
          collectibleType: "Amber Shard",
          index: i + 1,
          location: i === 0 ? "4 fragmentos = 1 âmbar" : "no baú",
          countsForEn: ["Total Domination"],
        }),
      );
    const make = (n: number) =>
      fact("PowerPyx", "roteiro_psn", { achievements: [ach("Total Domination")], chapters: [chapter("Weeping Creek", shards(n))] });
    expect(run(steam, [make(8)]).result.ok).toBe(true);
    expect(run(steam, [make(7)]).result.missing[0]).toContain("somam 1.75");
  });

  it("conquista perdível sem marco que case e sem item no roteiro → gate falha (não dá para ligar a capítulo nenhum)", () => {
    const f = powerpyx({
      achievements: [
        ach("With Heart and Blood"),
        ach("Shadow Blade", { missable: true, missableUntil: "depois de algum tempo" }),
        ach("Leave No Stone Unturned"),
      ],
    });
    const { result } = run(baseSteam(), [f]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      'O perdível "Shadow Blade" (ACH_HID) não está ligado a nenhum capítulo: o "até quando" das fontes não aponta para um capítulo e nenhum item do roteiro é ele.',
    ]);
  });

  it("R20: item ou conquista perdível sem prazo nas fontes usa o próprio capítulo e passa", () => {
    const f = powerpyx({
      achievements: [
        ach("With Heart and Blood"),
        ach("Shadow Blade", { missable: true }),
        ach("Leave No Stone Unturned"),
      ],
      chapters: [
        chapter("Weeping Creek", [
          ...blackstones(10),
          item("Selo", { missable: true }),
          item("Feather Bow", { missable: true, missableUntil: "defeating the main boss at the end of this region" }),
          item("Shadow Shrine", { kind: "other", achievementNameEn: "Shadow Blade" }),
        ]),
      ],
    });
    const { d, result } = run(baseSteam(), [f]);
    expect(result).toEqual({ ok: true, missing: [] });
    expect(d.achievements.find((a) => a.apiName === "ACH_HID")).toMatchObject({ deadlineChapter: "Weeping Creek", deadlineAssumed: true });
  });

  it("perdível cujo marco é um item de um capítulo passa", () => {
    const f = powerpyx({
      achievements: [
        ach("With Heart and Blood"),
        ach("Shadow Blade", { missable: true, missableUntil: "antes do Long Pillar" }),
        ach("Leave No Stone Unturned"),
      ],
      chapters: [chapter("Weeping Creek", [...blackstones(10), item("Long Pillar", { kind: "other" })])],
    });
    const { d, result } = run(baseSteam(), [f]);
    expect(result.ok).toBe(true);
    expect(d.achievements.find((a) => a.apiName === "ACH_HID")!.deadlineChapter).toBe("Weeping Creek");
  });

  it("a única fonte de roteiro incompleta reprova", () => {
    const { result } = run(baseSteam(), [powerpyx({ complete: false })]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["A única fonte de roteiro (PowerPyx) não está completa."]);
  });

  it("PowerPyx diz 23 sinos e lista 22 → divergência registrada, sem reprovar", () => {
    const bells = Array.from({ length: 22 }, (_, i) => item(`Sino ${i + 1}`, { collectibleType: "sino", index: i + 1, total: 23 }));
    const f = powerpyx({ chapters: [chapter("Weeping Creek", [...blackstones(10), ...bells])] });
    const { d, result } = run(baseSteam(), [f]);
    expect(d.divergences).toContain("PowerPyx diz 23 sino e lista 22.");
    expect(result.ok).toBe(true);
  });

  it("duas fontes de roteiro incompletas reprovam: WIP nunca é a única fonte", () => {
    const other = fact("Outro Guia", "roteiro_steam", { complete: false, achievements: [ach("With Heart and Blood")] });
    const { result } = run(baseSteam(), [powerpyx({ complete: false }), other]);
    expect(result.missing).toEqual(["Nenhuma fonte de roteiro está completa (PowerPyx, Outro Guia)."]);
  });

  describe("contagem sem número no texto da Steam", () => {
    const steam = (): SteamAchievement[] => [
      steamAch("ACH_013", "With Heart and Blood", "Finish the story."),
      steamAch("ACH_HID", "Shadow Blade", "", true),
      steamAch("ACH_STONE", "Leave No Stone Unturned", "Collect all Blackstones"),
    ];
    const stones = (count: number, total: number | ((i: number) => number), extra: (i: number) => object = () => ({})) =>
      Array.from({ length: count }, (_, i) =>
        item(`Pedra Negra ${i + 1}`, {
          collectibleType: "Blackstone",
          index: i + 1,
          total: typeof total === "number" ? total : total(i),
          countsForEn: ["Leave No Stone Unturned"],
          ...extra(i),
        }),
      );
    const withStones = (items: ReturnType<typeof stones>) => powerpyx({ chapters: [chapter("Weeping Creek", items)] });

    it("9 itens com total 10 → gate falha", () => {
      const { result } = run(steam(), [withStones(stones(9, 10))]);
      expect(result.missing).toEqual(['A conquista "Leave No Stone Unturned" (ACH_STONE) pede 10, mas os itens encontrados somam 9.']);
    });

    it("10 itens com total 10 passa", () => {
      expect(run(steam(), [withStones(stones(10, 10))]).result.ok).toBe(true);
    });

    it("fontes que discordam do total reprovam e o item vai para revisão", () => {
      const a = withStones(stones(10, 10));
      const b = fact("Grindnstrat", "coletaveis", { chapters: [chapter("Weeping Creek", stones(10, 9))] });
      const { d, result } = run(steam(), [a, b]);
      expect(d.chapters[0]!.items[0]!.conflict).toContain("total 10 numa fonte e 9 em Grindnstrat");
      expect(d.divergences.some((x) => x.includes("total 10"))).toBe(true);
      expect(result.ok).toBe(true);
      const mixed = run(steam(), [withStones(stones(10, (i) => (i === 0 ? 9 : 10)))]);
      expect(mixed.result.missing).toEqual(['As fontes discordam do total da conquista "Leave No Stone Unturned" (ACH_STONE): 9 e 10.']);
    });

    it("item contado sem localização reprova", () => {
      const { result } = run(steam(), [withStones(stones(10, 10, (i) => (i === 3 ? { location: " " } : {})))]);
      expect(result.missing).toEqual(['O item "Pedra Negra 4" da conquista "Leave No Stone Unturned" (ACH_STONE) está sem localização.']);
    });

    it("numeração duplicada ou ausente reprova", () => {
      const first = stones(9, 10);
      const again = stones(1, 10, () => ({ index: 3, name: "Pedra Negra 3 de novo" }));
      const f = powerpyx({ chapters: [chapter("Weeping Creek", first), chapter("Village of Lu", again, 2)] });
      const { result } = run(steam(), [f]);
      expect(result.missing).toEqual([
        'A contagem da conquista "Leave No Stone Unturned" (ACH_STONE) está errada: o número 3 aparece mais de uma vez.',
        'A contagem da conquista "Leave No Stone Unturned" (ACH_STONE) está errada: falta o número 10.',
      ]);
    });
  });

  it("linhas de PSN/Xbox da lista ?all=1 não viram conquistas da Steam", () => {
    const psnRow = { ...steamAch("PSN_PLAT", "Platinum", "Get all trophies"), platform: "psn" };
    const mixed = [...baseSteam(), psnRow];
    const { d, result } = run(mixed, [powerpyx()]);
    expect(result).toEqual({ ok: true, missing: [] });
    expect(d.achievements.map((a) => a.apiName)).not.toContain("PSN_PLAT");
    expect(d.facts.compat).toBe("psn");
  });

  it("a platina da PSN não impede o selo psn", () => {
    const f = powerpyx({
      trophyListSize: 4,
      achievements: [...powerpyx().achievements, ach("Platinum Trophy")],
    });
    expect(run(baseSteam(), [f]).d.facts.compat).toBe("psn");
  });

  it("fontes que concordam no número concordam, mesmo com notas diferentes", () => {
    const a = powerpyx({ playthroughs: { min: 1, note: "uma jogada basta" }, hours: { min: 20, max: 25 } });
    const b = fact("Grindnstrat", "coletaveis", { playthroughs: { min: 1, note: "1 playthrough" }, hours: { min: 20, max: 30 } });
    const { d } = run(baseSteam(), [a, b]);
    expect(d.facts.playthroughs).toMatchObject({ agreed: true, sources: ["PowerPyx", "Grindnstrat"] });
    expect(d.divergences).toEqual(["Horas: PowerPyx diz 20 a 25 horas, mas Grindnstrat diz 20 a 30 horas."]);
  });

  it("fontes que se contradizem em perdível ou prazo marcam revisão", () => {
    const a = powerpyx({
      chapters: [chapter("Weeping Creek", [...blackstones(10), item("Selo", { missable: true, missableUntil: "Weeping Creek" })])],
    });
    const b = fact("Grindnstrat", "coletaveis", {
      achievements: [ach("Shadow Blade", { missable: true, missableUntil: "Village of Lu" })],
      chapters: [chapter("Weeping Creek", [item("Selo", { missable: true, missableUntil: "Village of Lu" })])],
    });
    const { d } = run(baseSteam(), [a, b]);
    const selo = d.chapters[0]!.items.find((i) => i.name === "Selo")!;
    expect(selo.conflict).toContain('prazo "Weeping Creek" numa fonte e "Village of Lu" em Grindnstrat');
    expect(d.achievements.find((x) => x.apiName === "ACH_HID")!.conflict).toContain("prazo");
  });
});

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

  it("perdível sem marco → gate falha", () => {
    const f = powerpyx({
      achievements: [
        ach("With Heart and Blood"),
        ach("Shadow Blade", { missable: true, missableUntil: "depois de algum tempo" }),
        ach("Leave No Stone Unturned"),
      ],
    });
    const { result } = run(baseSteam(), [f]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['O perdível "Shadow Blade" (ACH_HID) não tem um marco "até quando" ligado a um capítulo.']);
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
});

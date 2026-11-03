import { describe, expect, it } from "vitest";
import { buildDossier, psnListSize, steamOnlyApiNames, type GuideDossierSource, type SteamAchievement } from "../../src/guias/dossier.js";
import { gate } from "../../src/guias/gate.js";
import { buildReport } from "../../src/guias/report.js";
import { writeGuide } from "../../src/guias/writer.js";
import { ach, chapter, fact, item, steamAch } from "./helpers-dossier.js";
import { fakeAi } from "./helpers-writer.js";

/**
 * PBZ, 2026-11-03: the PSN list has 36 trophies, Steam 66 achievements, yet the page said "a lista do PlayStation tem
 * 63". The per-achievement flag only says that no PSN source named the achievement, and the PowerPyx walkthrough
 * names Steam-only achievements in passing. With the whole PSN list in hand, the list decides.
 */

const STEAM: SteamAchievement[] = [
  steamAch("ACH_BELLS", "Bell Ringer", "Ring 2 bells."),
  steamAch("ACH_END", "The End", "Finish the story."),
  steamAch("ACH_ARENA", "Arena Master", "Win every arena fight."),
  steamAch("ACH_HARD", "Iron Will", "Finish on the hardest difficulty."),
];

const bells = () => [
  item("Bell", { collectibleType: "Bell", index: 1, total: 2, countsForEn: ["Bell Ringer"] }),
  item("Bell", { collectibleType: "Bell", index: 2, total: 2, countsForEn: ["Bell Ringer"] }),
];

/**
 * PowerPyx's trophy guide lists 2 trophies + platinum; its collectible page (another PSN source) names the
 * Steam-only arena achievement in passing. The Steam guide covers the two Steam-only ones.
 */
function dossier(opts: { psnTotal?: number; steamCoversArena?: boolean } = {}) {
  const powerpyx = fact("PowerPyx", "roteiro_psn", {
    trophyListSize: opts.psnTotal ?? 3,
    chapters: [chapter("Weeping Creek", bells(), 1)],
    achievements: [ach("Bell Ringer"), ach("The End"), ach("Lord of the Phantoms", { grade: "platinum" })],
    roadmap: [{ title: "Story playthrough", summary: "Play the story." }],
  });
  const collectibles = fact("PowerPyx (Weeping Creek)", "coletaveis", {
    platform: "psn",
    chapters: [chapter("Weeping Creek", [item("Arena", { kind: "boss", location: "Colosseum", achievementNameEn: "Arena Master" })], 1)],
  });
  const steamGuide = fact("SteamGuide", "roteiro_steam", {
    chapters: [chapter("Weeping Creek", bells(), 1)],
    achievements: [ach("Bell Ringer"), ach("The End"), ach("Iron Will"), ...(opts.steamCoversArena === false ? [] : [ach("Arena Master")])],
  });
  const facts = [powerpyx, collectibles, steamGuide];
  return buildDossier(STEAM, facts, facts.map((f) => [f.source.url]));
}

describe("conquistas fora da lista da PSN", () => {
  it("com a lista inteira da PSN, ela decide; a menção de passagem não põe a conquista na lista", () => {
    const d = dossier();
    expect(d.facts.psnList).toMatchObject({ total: 3 });
    // The flag as the dossier keeps it (the writing cache hashes it): PowerPyx named the arena achievement.
    expect(d.achievements.find((a) => a.apiName === "ACH_ARENA")!.steamOnly).toBe(false);
    expect([...steamOnlyApiNames(d)]).toEqual(["ACH_ARENA", "ACH_HARD"]);
    expect(psnListSize(d)).toBe(3);
  });

  it("sem a lista inteira, vale a marcação de cada conquista", () => {
    const d = dossier({ psnTotal: 36 });
    expect(d.facts.psnList).toBeUndefined();
    expect(steamOnlyApiNames(d).size).toBe(d.achievements.filter((a) => a.steamOnly).length);
    expect(psnListSize(d)).toBe(36);
  });

  it("gate da Steam: a exclusiva da Steam precisa de uma fonte da Steam, mesmo que a PSN a cite de passagem", () => {
    expect(gate(dossier(), STEAM).missing).not.toContainEqual(expect.stringContaining("ACH_ARENA"));
    expect(gate(dossier({ steamCoversArena: false }), STEAM).missing).toContain(
      'A conquista "Arena Master" (ACH_ARENA) existe só na Steam e nenhuma fonte da Steam a cobre.',
    );
  });

  it("relatório: o selo lê o tamanho da lista da PSN e quantas ficam só na Steam", () => {
    const report = buildReport({ sourcesRead: [], dossier: dossier(), steamList: STEAM, spendUsd: 0 });
    expect(report.coverage).toEqual({ steam: 4, covered: 4, steamOnly: 2, psn: 3 });
  });

  it("escritor: só o que está na lista da PSN sai marcado como valendo também no PlayStation", async () => {
    const d = dossier();
    expect(d.facts.compat).toBe("steam_only");
    const game: GuideDossierSource = {
      game: {
        slug: "phantom-test",
        name: "Phantom Test",
        steamAppId: 4115450,
        summary: null,
        developer: "S-Game",
        publisher: "S-Game",
        releaseDate: "2026-10-28",
        platforms: ["PC"],
        criticScore: null,
        timeToBeatCompleteMin: null,
        achievementCount: STEAM.length,
      },
      tralked: { players: 0, avgPlaytimeMin: null, completedPlayers: 0 },
      achievements: STEAM,
    };
    const payload = await writeGuide(fakeAi().ai, d, game, "live");
    const items = payload.walkthrough.chapters.flatMap((c) => c.steps.flatMap((s) => s.items));
    const alsoOn = (apiName: string) => items.find((i) => i.achievement === apiName)?.alsoOn;
    expect(alsoOn("ACH_BELLS")).toEqual(["psn"]);
    expect(alsoOn("ACH_ARENA")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { buildDossier, type SteamAchievement } from "../../src/guias/dossier.js";
import { psnScope } from "../../src/guias/scope.js";
import { ach, chapter, fact, item, steamAch } from "./helpers-dossier.js";

const steam = (): SteamAchievement[] => [
  steamAch("ACH_END", "With Heart and Blood", "Finish the story."),
  steamAch("ACH_HID", "Shadow Blade", "", true),
  steamAch("ACH_W1", "Master of Weapon 1", "Upgrade weapon 1 fully."),
  steamAch("ACH_W2", "Collect 3 Relics", "Collect 3 relics."),
];

/**
 * PowerPyx carries the whole PSN list (2 trophies + a themed platinum, "all trophies") and the route, where a forge
 * and a relic also serve Steam-only achievements; a Steam guide covers a Steam-only one too.
 */
function dossier() {
  const powerpyx = fact("PowerPyx", "roteiro_psn", {
    trophyListSize: 3,
    achievements: [ach("With Heart and Blood"), ach("Shadow Blade"), ach("Lord of the Phantoms", { howTo: "Unlock all other trophies." })],
    chapters: [
      chapter("Weeping Creek", [
        item("Shrine", { kind: "other", achievementNameEn: "Shadow Blade" }),
        item("Forge", { kind: "other" }),
        item("Relic", { collectibleType: "Relic", index: 1 }),
      ]),
    ],
  });
  // The Steam guide names what PowerPyx's forge and relic are for: it only adds that to the same items.
  const steamGuide = fact("Steam Guide", "roteiro_steam", {
    complete: false,
    achievements: [ach("Master of Weapon 1")],
    chapters: [
      chapter("Weeping Creek", [
        item("Forge", { kind: "other", achievementNameEn: "Master of Weapon 1" }),
        item("Relic", { collectibleType: "Relic", index: 1, countsForEn: ["Collect 3 Relics"] }),
      ]),
    ],
  });
  return buildDossier(steam(), [powerpyx, steamGuide], [["https://example.com/powerpyx"], ["https://example.com/steam guide"]]);
}

describe("psnScope", () => {
  it("as conquistas fora da lista da PSN viram steamOnly, sem roteiro", () => {
    const { dossier: d, scope } = psnScope(dossier(), steam());
    expect(scope).toEqual({
      psnList: { total: 3, names: ["With Heart and Blood", "Shadow Blade", "Lord of the Phantoms"] },
      steamOnly: ["ACH_W1", "ACH_W2"],
      steamTotal: 4,
    });
    expect(d.achievements.map((a) => a.apiName)).toEqual(["ACH_END", "ACH_HID"]);
  });

  it("item que é uma conquista só da Steam sai; o que só conta para ela perde a referência", () => {
    const { dossier: d } = psnScope(dossier(), steam());
    const items = d.chapters.flatMap((c) => c.items);
    expect(items.map((i) => i.name)).toEqual(["Shrine", "Relic"]);
    expect(items.find((i) => i.name === "Relic")!.countsFor).toEqual([]);
  });

  it("sem lista da PSN não há scope psn", () => {
    const d = dossier();
    d.facts.psnList = undefined;
    expect(() => psnScope(d, steam())).toThrow("o dossiê não tem a lista inteira da PSN");
  });
});

import { describe, expect, it } from "vitest";
import { readLibrary } from "./platform-library";

// Offline fixtures only (no keys in tests): no database needed.
describe("readLibrary", () => {
  it("PSN titles carry their console code and trophy service", async () => {
    const library = await readLibrary("psn", { externalId: "9000000000000000005", handle: "Tres-Consoles" });
    if (library === "private") throw new Error("public fixture");
    const lists = library.titles.map((t) => ({
      externalId: t.externalId,
      name: t.name,
      console: t.console,
      serviceName: t.serviceName,
      trophies: t.achievements.length,
      unlocked: t.achievements.filter((a) => a.unlocked).length,
    }));
    expect(lists.sort((a, b) => a.externalId.localeCompare(b.externalId))).toEqual([
      { externalId: "NPWR90011_00", name: "Grand Theft Auto V", console: "PS3", serviceName: "trophy", trophies: 59, unlocked: 20 },
      { externalId: "NPWR90012_00", name: "Grand Theft Auto V", console: "PS4", serviceName: "trophy", trophies: 77, unlocked: 46 },
      { externalId: "NPWR90013_00", name: "Grand Theft Auto V", console: "PS5", serviceName: "trophy2", trophies: 77, unlocked: 26 },
    ]);
  });

  it("Xbox titles carry the console of their devices", async () => {
    const library = await readLibrary("xbox", { externalId: "2535400000000002", handle: "Tralked Teste" });
    if (library === "private") throw new Error("public fixture");
    expect(library.titles.map((t) => [t.externalId, t.console])).toEqual(
      expect.arrayContaining([
        ["90000001", "ONE"],
        ["90000003", "ONE"],
      ]),
    );
  });

  it("RetroAchievements titles carry their console name", async () => {
    const library = await readLibrary("retro", { externalId: "01JTRALKED00000000000TESTE", handle: "TralkedTeste" });
    if (library === "private") throw new Error("public fixture");
    expect(library.titles.map((t) => [t.externalId, t.console])).toEqual([["990001", "Mega Drive"]]);
  });
});

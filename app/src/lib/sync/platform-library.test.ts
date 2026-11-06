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

describe("readLibrary: Xbox 360 titles fail closed", () => {
  const x360 = (titleId: string, earned: number, total: number) => ({
    titleId,
    name: `T${titleId}`,
    currentAchievements: earned,
    totalAchievements: total,
    currentGamerscore: 0,
    totalGamerscore: 0,
    progress: 0,
    lastPlayed: null,
    devices: ["Xbox360", "XboxOne"],
  });
  const achievements = (n: number, earned: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: String(i + 1),
      name: `A${i + 1}`,
      description: null,
      iconUrl: null,
      hidden: false,
      gamerscore: 10,
      unlocked: i < earned,
      unlockedAt: i < earned ? new Date(Date.UTC(2010, 0, 1 + i)) : null,
      rarityPct: null,
    }));

  it("a 360 list shorter than the history's total, or empty with unlocks, is a failed read (retried once a day)", async () => {
    const { vi } = await import("vitest");
    const { getXbox } = await import("@/lib/integrations");
    const xbox = getXbox();
    const one = { ...x360("4", 1, 0), devices: ["XboxOne"] };
    const titles = vi.spyOn(xbox, "getTitles").mockResolvedValue([x360("1", 2, 5), x360("2", 2, 3), x360("3", 1, 4), one]);
    const lists: Record<string, ReturnType<typeof achievements>> = {
      "1": achievements(3, 2),
      "2": [],
      "3": achievements(4, 1),
      "4": achievements(2, 1),
    };
    const read = vi.spyOn(xbox, "getAchievements").mockImplementation(async (_xuid, titleId) => lists[titleId]);
    const minutes = vi.spyOn(xbox, "getMinutesPlayed").mockResolvedValue(new Map());
    try {
      const library = await readLibrary("xbox", { externalId: "2535400000000002", handle: "Tralked Teste" });
      if (library === "private") throw new Error("public fixture");
      // A One title's history total is 0 (Xbox does not fill it): only 360 titles are checked.
      expect(library.titles.map((t) => t.externalId).sort()).toEqual(["3", "4"]);
      expect(library.empty).toEqual([]);
      expect(library.failures.map((f) => [f.externalId, f.backoff, String(f.error)]).sort()).toEqual([
        ["1", true, expect.stringMatching(/3 of the 5/)],
        ["2", true, expect.stringMatching(/no achievements/)],
      ]);
    } finally {
      titles.mockRestore();
      read.mockRestore();
      minutes.mockRestore();
    }
  });

  it("a 360 route refused with 403 is that title's failure (retried once a day), not a private account", async () => {
    const { vi } = await import("vitest");
    const { getXbox } = await import("@/lib/integrations");
    const xbox = getXbox();
    const titles = vi.spyOn(xbox, "getTitles").mockResolvedValue([x360("1", 1, 2), x360("2", 1, 2)]);
    const read = vi.spyOn(xbox, "getAchievements").mockImplementation(async (_xuid, titleId) => {
      if (titleId === "1") throw new Error("Xbox 360 earned achievements: refused (HTTP 403)");
      return achievements(2, 1);
    });
    const minutes = vi.spyOn(xbox, "getMinutesPlayed").mockResolvedValue(new Map());
    try {
      const library = await readLibrary("xbox", { externalId: "2535400000000002", handle: "Tralked Teste" });
      expect(library).not.toBe("private");
      if (library === "private") return;
      expect(library.titles.map((t) => t.externalId)).toEqual(["2"]);
      expect(library.failures.map((f) => [f.externalId, f.backoff, String(f.error)])).toEqual([
        ["1", true, expect.stringMatching(/HTTP 403/)],
      ]);
    } finally {
      titles.mockRestore();
      read.mockRestore();
      minutes.mockRestore();
    }
  });
});

import { describe, expect, it } from "vitest";
import type { LibraryGame } from "@/lib/library/queries";
import { filterLibrary, formatPlaytime, libraryPlatforms, sortLibrary, splitSections } from "./library-view";

function game(name: string, over: Partial<LibraryGame> = {}): LibraryGame {
  return {
    gameId: name,
    slug: name.toLowerCase().replace(/\W+/g, "-"),
    name,
    coverUrl: null,
    steamAppId: null,
    stub: false,
    platforms: [
      { platform: "steam", playtimeMin: 0, playtime2WeeksMin: null, lastPlayedAt: null, unlockedCount: 0, achievementTotal: 0, completedAt: null },
    ],
    playtimeMin: 0,
    lastPlayedAt: null,
    unlockedCount: 0,
    achievementTotal: 0,
    completionPct: null,
    played: false,
    completed: false,
    ...over,
  };
}

const psn = { platform: "psn" as const, playtimeMin: 0, playtime2WeeksMin: null, lastPlayedAt: null, unlockedCount: 0, achievementTotal: 0, completedAt: null };

const LIB = [
  game("Pokémon Ação", { playtimeMin: 600, played: true, lastPlayedAt: new Date("2026-01-01"), completionPct: 50, unlockedCount: 5 }),
  game("Celeste", { playtimeMin: 1200, played: true, lastPlayedAt: new Date("2026-10-01"), completionPct: 100, unlockedCount: 32 }),
  game("Ábaco", { played: false }),
  game("Doom", { playtimeMin: 60, played: true, platforms: [psn], completionPct: null }),
];

describe("profile library view", () => {
  it("splits played and never-played games", () => {
    const { jogados, nunca } = splitSections(LIB);
    expect(jogados.map((g) => g.name)).toEqual(["Pokémon Ação", "Celeste", "Doom"]);
    expect(nunca.map((g) => g.name)).toEqual(["Ábaco"]);
  });

  it("filters by platform and by name ignoring accents and case", () => {
    expect(filterLibrary(LIB, { platform: "psn" }).map((g) => g.name)).toEqual(["Doom"]);
    expect(filterLibrary(LIB, { q: "POKEMON acao" }).map((g) => g.name)).toEqual(["Pokémon Ação"]);
    expect(filterLibrary(LIB, { q: "abaco" }).map((g) => g.name)).toEqual(["Ábaco"]);
  });

  it("sorts by hours, recent, completion and name", () => {
    expect(sortLibrary(LIB, "horas").map((g) => g.name)).toEqual(["Celeste", "Pokémon Ação", "Doom", "Ábaco"]);
    expect(sortLibrary(LIB, "recentes").map((g) => g.name)).toEqual(["Celeste", "Pokémon Ação", "Doom", "Ábaco"]);
    expect(sortLibrary(LIB, "conclusao").map((g) => g.name).slice(0, 2)).toEqual(["Celeste", "Pokémon Ação"]);
    expect(sortLibrary(LIB, "nome").map((g) => g.name)).toEqual(["Ábaco", "Celeste", "Doom", "Pokémon Ação"]);
  });

  it("lists the platforms present, in the usual order", () => {
    expect(libraryPlatforms(LIB)).toEqual(["steam", "psn"]);
  });

  it("formats playtime", () => {
    expect(formatPlaytime(0)).toBe("—");
    expect(formatPlaytime(45)).toBe("45 min");
    expect(formatPlaytime(90)).toBe("1,5 h");
    expect(formatPlaytime(60 * 1234)).toBe("1.234 h");
  });
});

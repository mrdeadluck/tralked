import { describe, expect, it } from "vitest";
import { filterFamilyLibrary, sortFamilyLibrary } from "./library-view";
import type { FamilyLibraryEntry } from "./service";

function entry(name: string, owners: [string, number][], unlocked = 0): FamilyLibraryEntry {
  return {
    game: { id: name, slug: name, name, coverUrl: null, stub: false },
    owners: owners.map(([handle, playtimeMin]) => ({ handle, playtimeMin })),
    bestProgress: { handle: owners[0][0], pct: unlocked * 10, unlocked, total: 10 },
    playtimeMin: owners.reduce((s, [, m]) => s + m, 0),
  };
}

const LIB = [
  entry("Hades", [["ana", 100], ["bia", 50], ["caio", 0]], 7),
  entry("Celeste", [["ana", 30], ["bia", 0]], 2),
  entry("Pokémon", [["caio", 0]]),
  entry("Doom", [["bia", 500]], 1),
];
const names = (list: FamilyLibraryEntry[]) => list.map((e) => e.game.name);

describe("family library view", () => {
  it("filters by ownership", () => {
    const base = { sharingMembers: 3 };
    expect(names(filterFamilyLibrary(LIB, { ...base, ownership: "todos" }))).toHaveLength(4);
    expect(names(filterFamilyLibrary(LIB, { ...base, ownership: "todos-tem" }))).toEqual(["Hades"]);
    expect(names(filterFamilyLibrary(LIB, { ...base, ownership: "varios" }))).toEqual(["Hades", "Celeste"]);
    expect(names(filterFamilyLibrary(LIB, { ...base, ownership: "so-um" }))).toEqual(["Pokémon", "Doom"]);
    expect(names(filterFamilyLibrary(LIB, { ...base, ownership: "ninguem" }))).toEqual(["Pokémon"]);
  });

  it("'todos têm' needs at least two members sharing", () => {
    expect(filterFamilyLibrary(LIB, { sharingMembers: 1, ownership: "todos-tem" })).toEqual([]);
  });

  it("filters by member and name (accents ignored)", () => {
    expect(names(filterFamilyLibrary(LIB, { sharingMembers: 3, member: "caio" }))).toEqual(["Hades", "Pokémon"]);
    expect(names(filterFamilyLibrary(LIB, { sharingMembers: 3, q: "POKEMON" }))).toEqual(["Pokémon"]);
  });

  it("sorts by name, hours, owners and progress", () => {
    expect(names(sortFamilyLibrary(LIB, "nome"))).toEqual(["Celeste", "Doom", "Hades", "Pokémon"]);
    expect(names(sortFamilyLibrary(LIB, "horas"))).toEqual(["Doom", "Hades", "Celeste", "Pokémon"]);
    expect(names(sortFamilyLibrary(LIB, "donos"))).toEqual(["Hades", "Celeste", "Doom", "Pokémon"]);
    expect(names(sortFamilyLibrary(LIB, "progresso"))).toEqual(["Hades", "Celeste", "Doom", "Pokémon"]);
  });
});

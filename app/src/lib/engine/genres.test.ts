import { describe, expect, it } from "vitest";
import { genreName, orderedGenres, primaryGenre } from "./genres";

describe("genres", () => {
  it("names the most specific genre, never a game mode", () => {
    // Baldur's Gate 3 (IGDB: RPG, Strategy, Tactical) is an RPG, not "Estratégia".
    expect(primaryGenre(["estrategia", "rpg", "coop"])).toBe("rpg");
    // GTA VI only carries the co-op mode: no genre is shown rather than "Co-op".
    expect(primaryGenre(["coop"])).toBeNull();
    // Hollow Knight: Soulslike before Plataforma.
    expect(primaryGenre(["plataforma", "soulslike"])).toBe("soulslike");
    expect(primaryGenre(["sabio"])).toBeNull();
    expect(primaryGenre([])).toBeNull();
  });

  it("orders every genre the same way, Co-op last, Sábio left out", () => {
    expect(orderedGenres(["coop", "puzzle", "sabio", "fps", "puzzle"])).toEqual(["fps", "puzzle", "coop"]);
    expect(genreName("horror")).toBe("Survival Horror");
  });
});

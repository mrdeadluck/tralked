import { describe, expect, it } from "vitest";
import { normalizePlatformTitle, normalizeTitle } from "./title-match";

describe("normalizeTitle", () => {
  it("drops accents, trademark signs and punctuation", () => {
    expect(normalizeTitle("Hollow Knight™: Voidheart Edition")).toBe("hollow knight voidheart edition");
    expect(normalizeTitle("Pokémon® Red & Blue")).toBe("pokemon red and blue");
    expect(normalizeTitle("  DOOM  (2016) ")).toBe("doom 2016");
  });
});

describe("normalizePlatformTitle", () => {
  it("drops trailing platform tags", () => {
    expect(normalizePlatformTitle("Hades (PS5)")).toBe("hades");
    expect(normalizePlatformTitle("Resident Evil 4 PS4 & PS5")).toBe("resident evil 4");
    expect(normalizePlatformTitle("Hollow Knight Trophies")).toBe("hollow knight");
    expect(normalizePlatformTitle("Forza Horizon 5 Xbox Series X|S")).toBe("forza horizon 5");
  });
});

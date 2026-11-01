import { describe, expect, it } from "vitest";
import { normalizePlatformTitle, normalizeTitle, withoutEdition } from "./title-match";

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

describe("withoutEdition", () => {
  it("drops the usual store editions", () => {
    expect(withoutEdition("Marvel’s Spider-Man 2 Digital Deluxe Edition (PS5)")).toBe("Marvel’s Spider-Man 2");
    expect(withoutEdition("The Witcher 3: Wild Hunt - Game of the Year Edition")).toBe("The Witcher 3: Wild Hunt");
    expect(withoutEdition("Ghost of Yōtei™ Standard Edition")).toBe("Ghost of Yōtei");
    expect(withoutEdition("Borderlands 2 GOTY")).toBe("Borderlands 2");
    expect(withoutEdition("Elden Ring Collector's Edition")).toBe("Elden Ring");
    expect(withoutEdition("Cyberpunk 2077 Digital Deluxe")).toBe("Cyberpunk 2077");
  });

  it("keeps named editions and names without an edition", () => {
    expect(withoutEdition("Hollow Knight: Voidheart Edition")).toBeNull();
    expect(withoutEdition("Ghost of Tsushima Director's Cut")).toBeNull();
    expect(withoutEdition("Marvel's Wolverine")).toBeNull();
    expect(withoutEdition("Gold")).toBeNull();
    expect(withoutEdition("Pokémon Gold")).toBeNull();
    expect(withoutEdition("Street Fighter Alpha 3 Complete")).toBeNull();
  });
});

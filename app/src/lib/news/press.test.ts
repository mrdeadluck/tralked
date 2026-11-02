import { describe, expect, it } from "vitest";
import { namesGame, pressSourceName } from "./press";

describe("pressSourceName", () => {
  it("names known feeds by the publication", () => {
    expect(pressSourceName("IGN Movies")).toBe("IGN");
    expect(pressSourceName("IGN TV")).toBe("IGN");
    expect(pressSourceName("The Verge (IA)")).toBe("The Verge");
    expect(pressSourceName("Anime News Network")).toBe("Anime News Network");
  });

  it("drops section suffixes and shouting capitals", () => {
    expect(pressSourceName("Portal Exemplo - Últimas notícias")).toBe("Portal Exemplo");
    expect(pressSourceName("Revista Fictícia | Games")).toBe("Revista Fictícia");
    expect(pressSourceName("PORTAL EXEMPLO")).toBe("Portal Exemplo");
    expect(pressSourceName("UOL")).toBe("UOL");
  });
});

describe("namesGame", () => {
  it("matches names of several words as whole words, any case", () => {
    expect(namesGame("Hollow Knight: Silksong ganha data", "Hollow Knight Silksong")).toBe(true);
    expect(namesGame("hollow knight speedrun record", "Hollow Knight")).toBe(true);
    expect(namesGame("Hollow Knightmare", "Hollow Knight")).toBe(false);
  });

  it("matches a one-word name only as written (or capitalized)", () => {
    expect(namesGame("Attack on Titan 3 Game's New Trailer Introduces Gameplay", "Attack!")).toBe(false);
    expect(namesGame("Sony takes control of the studio", "Control")).toBe(false);
    expect(namesGame("Control 2 ganha trailer", "Control")).toBe(true);
    expect(namesGame("Hades II chega ao Switch", "Hades")).toBe(true);
    expect(namesGame("Doom: The Dark Ages recebe DLC", "DOOM")).toBe(true);
    expect(namesGame("Celeste ganha capítulo novo", "Celeste")).toBe(true);
  });
});

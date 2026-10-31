import { describe, expect, it } from "vitest";
import { longestWordEm, titleFitStyle } from "./title-fit";

describe("longestWordEm", () => {
  it("measures the widest word, not the longest string", () => {
    // RESIDENT (8 letters) is the widest word of "Resident Evil 4".
    const resident = longestWordEm("Resident Evil 4");
    expect(resident).toBeCloseTo(longestWordEm("RESIDENT"), 5);
    expect(resident).toBeGreaterThan(7);
    expect(resident).toBeLessThan(8);
    // Narrow letters weigh less: IIII is much narrower than WWWW.
    expect(longestWordEm("IIII")).toBeLessThan(longestWordEm("WWWW") / 2);
  });

  it("treats accents, apostrophes and hyphenated words as one word", () => {
    expect(longestWordEm("Ghost of Tsushima VERSÃO DO DIRETOR")).toBe(longestWordEm("TSUSHIMA"));
    expect(longestWordEm("versão")).toBe(longestWordEm("VERSAO"));
    // Breaking at the hyphen is allowed, but the size never relies on it.
    expect(longestWordEm("Counter-Strike 2")).toBe(longestWordEm("COUNTER-STRIKE"));
    expect(longestWordEm("Assassin's Creed IV Black Flag")).toBe(longestWordEm("ASSASSIN'S"));
  });

  it("counts unknown characters as the widest glyph (too small, never overflowing)", () => {
    expect(longestWordEm("ゼルダ")).toBeGreaterThanOrEqual(3 * 1.25);
  });

  it("passes the value to CSS as --longest (at least 1)", () => {
    expect(titleFitStyle("Supercalifragilisticexpialidocious")).toEqual({ "--longest": longestWordEm("Supercalifragilisticexpialidocious") });
    expect(titleFitStyle("")).toEqual({ "--longest": 1 });
  });
});

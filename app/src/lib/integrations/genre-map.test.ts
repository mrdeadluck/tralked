import { describe, expect, it } from "vitest";
import { mapToSkills, type GenreMapInput } from "./genre-map";

const empty: GenreMapInput = { genres: [], themes: [], gameModes: [], perspectives: [], keywords: [] };
const map = (partial: Partial<GenreMapInput>) => mapToSkills({ ...empty, ...partial });

describe("mapToSkills", () => {
  it("returns nothing for empty input", () => {
    expect(map({})).toEqual([]);
  });

  it("Shooter + First person -> fps", () => {
    expect(map({ genres: ["Shooter"], perspectives: ["First person"] })).toEqual(["fps"]);
  });

  it("Shooter without first person -> no fps", () => {
    expect(map({ genres: ["Shooter"], perspectives: ["Third person"] })).toEqual([]);
  });

  it("First person without Shooter -> no fps", () => {
    expect(map({ genres: ["Adventure"], perspectives: ["First person"] })).toEqual([]);
  });

  it("Horror + Survival themes -> horror", () => {
    expect(map({ themes: ["Horror", "Survival"] })).toEqual(["horror"]);
  });

  it("Horror alone -> no horror skill", () => {
    expect(map({ themes: ["Horror"] })).toEqual([]);
  });

  it("Role-playing (RPG) -> rpg", () => {
    expect(map({ genres: ["Role-playing (RPG)"] })).toEqual(["rpg"]);
  });

  it("Platform -> plataforma", () => {
    expect(map({ genres: ["Platform"] })).toEqual(["plataforma"]);
  });

  it.each(["Strategy", "Real Time Strategy (RTS)", "Turn-based strategy (TBS)", "Tactical"])(
    "%s -> estrategia",
    (genre) => {
      expect(map({ genres: [genre] })).toEqual(["estrategia"]);
    },
  );

  it("Simulator -> simulacao", () => {
    expect(map({ genres: ["Simulator"] })).toEqual(["simulacao"]);
  });

  it("Puzzle -> puzzle", () => {
    expect(map({ genres: ["Puzzle"] })).toEqual(["puzzle"]);
  });

  it("Co-operative mode -> coop", () => {
    expect(map({ gameModes: ["Co-operative"] })).toEqual(["coop"]);
  });

  it.each(["soulslike", "souls-like", "Soulslike"])("keyword %s -> soulslike", (kw) => {
    expect(map({ keywords: [kw] })).toEqual(["soulslike"]);
  });

  it.each(["roguelike", "roguelite", "Roguelike"])("keyword %s -> roguelike", (kw) => {
    expect(map({ keywords: [kw] })).toEqual(["roguelike"]);
  });

  it("is case-insensitive for names", () => {
    expect(map({ genres: ["platform"], gameModes: ["co-operative"] }).sort()).toEqual([
      "coop",
      "plataforma",
    ]);
  });

  it("combines several skills without duplicates", () => {
    const result = map({
      genres: ["Strategy", "Tactical", "Role-playing (RPG)"],
      gameModes: ["Co-operative", "Co-operative"],
      keywords: ["roguelike", "roguelite"],
    });
    expect(result).toHaveLength(new Set(result).size);
    expect([...result].sort()).toEqual(["coop", "estrategia", "roguelike", "rpg"]);
  });

  it("maps Hollow Knight-like data", () => {
    expect(
      [
        ...map({
          genres: ["Platform", "Adventure"],
          themes: ["Action"],
          keywords: ["metroidvania", "soulslike"],
        }),
      ].sort(),
    ).toEqual(["plataforma", "soulslike"]);
  });

  it("never returns sabio", () => {
    const all = map({
      genres: ["Shooter", "Platform", "Puzzle", "Simulator", "Strategy", "Role-playing (RPG)"],
      themes: ["Horror", "Survival"],
      gameModes: ["Co-operative"],
      perspectives: ["First person"],
      keywords: ["soulslike", "roguelike", "sabio"],
    });
    expect(all).not.toContain("sabio");
    expect(all).toHaveLength(10);
  });
});

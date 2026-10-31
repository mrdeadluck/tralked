import { describe, expect, it } from "vitest";
import { mapTagsToSkills, TOP_TAGS } from "./tags-map";

describe("mapTagsToSkills", () => {
  it("maps Hollow Knight's real SteamSpy tags", () => {
    const hollowKnight = {
      Metroidvania: 5623, "Souls-like": 4307, Platformer: 4242, "Great Soundtrack": 4144, "2D": 4053,
      Difficult: 4051, Indie: 3863, Singleplayer: 3240, Atmospheric: 3162, Exploration: 3143,
      Adventure: 2884, "Story Rich": 2799, "Hand-drawn": 2140, "Multiple Endings": 2083, Action: 2054,
    };
    expect(mapTagsToSkills(hollowKnight)).toEqual(["soulslike", "plataforma"]);
  });

  it("orders tags by votes and ignores the long tail", () => {
    const tail = Object.fromEntries(Array.from({ length: TOP_TAGS }, (_, i) => [`Filler ${i}`, 1000 - i]));
    expect(mapTagsToSkills({ ...tail, Puzzle: 1 })).toEqual([]);
    expect(mapTagsToSkills({ ...tail, Puzzle: 5000 })).toEqual(["puzzle"]);
  });

  it("covers the skill families, case-insensitively, never sabio", () => {
    expect(mapTagsToSkills(["FPS", "Online Co-Op", "Action RPG", "Roguelite", "Turn-Based Strategy", "Farming Sim"])).toEqual([
      "fps", "rpg", "roguelike", "estrategia", "simulacao", "coop",
    ]);
    expect(mapTagsToSkills(["Open World", "Shooter", "First-Person", "Tactical"])).toEqual([]);
    expect(mapTagsToSkills(["Horror", "Survival"])).toEqual(["horror"]);
    expect(mapTagsToSkills(["Horror"])).toEqual([]);
    expect(mapTagsToSkills({})).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { applySkillPoints, skillNeed, skillPointsFor } from "./skills";

describe("skillNeed", () => {
  it("grows 8.5% per level", () => {
    expect(skillNeed(30)).toBe(Math.round(120 * 1.085 ** 30));
  });
});

describe("skillPointsFor", () => {
  it("splits xp/12 equally across the game's skills", () => {
    expect(skillPointsFor(18643, 2)).toBe(777);
  });
});

describe("applySkillPoints", () => {
  it("levels up and carries over the remainder", () => {
    const res = applySkillPoints(
      { level: 30, points: skillNeed(30) - 10 },
      25,
    );
    expect(res).toEqual({ state: { level: 31, points: 15 }, levelsGained: 1 });
  });

  it("can cross several levels at once", () => {
    const res = applySkillPoints(
      { level: 1, points: 0 },
      skillNeed(1) + skillNeed(2) + 5,
    );
    expect(res).toEqual({ state: { level: 3, points: 5 }, levelsGained: 2 });
  });

  it("does not level up when below the threshold", () => {
    const res = applySkillPoints({ level: 5, points: 0 }, 10);
    expect(res).toEqual({ state: { level: 5, points: 10 }, levelsGained: 0 });
  });
});

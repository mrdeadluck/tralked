import { describe, expect, it } from "vitest";
import { skillNeed } from "@/lib/engine/skills";
import { skillsFromLedger } from "./skills-from-ledger";

describe("skillsFromLedger", () => {
  it("starts every skill at level 1 with no points", () => {
    const result = skillsFromLedger([]);
    expect(Object.keys(result)).toHaveLength(11);
    expect(result.soulslike).toEqual({ level: 1, points: 0 });
    expect(result.sabio).toEqual({ level: 1, points: 0 });
  });

  it("derives points with skillPointsFor for each listed skill when skillPoints is null", () => {
    // xp 1200 over 2 skills -> round(1200 / 12 / 2) = 50 points each
    const result = skillsFromLedger([
      { xp: 1200, skills: ["soulslike", "plataforma"], skillPoints: null },
    ]);
    expect(result.soulslike).toEqual({ level: 1, points: 50 });
    expect(result.plataforma).toEqual({ level: 1, points: 50 });
    expect(result.rpg).toEqual({ level: 1, points: 0 });
  });

  it("uses explicit skillPoints instead of deriving", () => {
    const result = skillsFromLedger([
      { xp: 999999, skills: ["fps"], skillPoints: { horror: 10 } },
    ]);
    expect(result.horror).toEqual({ level: 1, points: 10 });
    expect(result.fps).toEqual({ level: 1, points: 0 });
  });

  it("levels up across the skillNeed boundaries and keeps the remainder", () => {
    const need1 = skillNeed(1);
    const need2 = skillNeed(2);
    const result = skillsFromLedger([
      { xp: 0, skills: [], skillPoints: { puzzle: need1 + need2 + 7 } },
    ]);
    expect(result.puzzle).toEqual({ level: 3, points: 7 });
  });

  it("is independent of entry order and sums mixed entries", () => {
    const a = { xp: 60000, skills: ["rpg"], skillPoints: null }; // 5000 points
    const b = { xp: 0, skills: [], skillPoints: { rpg: 123 } };
    expect(skillsFromLedger([a, b])).toEqual(skillsFromLedger([b, a]));
    const total = 5000 + 123;
    const expected = skillsFromLedger([
      { xp: 0, skills: [], skillPoints: { rpg: total } },
    ]);
    expect(skillsFromLedger([a, b]).rpg).toEqual(expected.rpg);
  });

  it("ignores unknown skill ids", () => {
    const result = skillsFromLedger([
      { xp: 12000, skills: ["nonexistent"], skillPoints: null },
      { xp: 0, skills: [], skillPoints: { nonexistent: 50 } },
    ]);
    expect(result).not.toHaveProperty("nonexistent");
  });
});

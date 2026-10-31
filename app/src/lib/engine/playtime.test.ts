import { describe, expect, it } from "vitest";
import {
  PLAYTIME_MILESTONES_H,
  milestoneXp,
  playtimeGameId,
  playtimeSourceKey,
  playtimeXp,
  reachedMilestones,
} from "./playtime";

describe("playtime XP", () => {
  it("uses the milestone list of the spec", () => {
    expect([...PLAYTIME_MILESTONES_H]).toEqual([1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]);
  });

  it("values each milestone as round(2000 · (m^0.7 − previous^0.7))", () => {
    expect(milestoneXp(1)).toBe(2000);
    expect(milestoneXp(2)).toBe(Math.round(2000 * (2 ** 0.7 - 1)));
    expect(milestoneXp(10)).toBe(Math.round(2000 * (10 ** 0.7 - 5 ** 0.7)));
    expect(milestoneXp(10000)).toBe(Math.round(2000 * (10000 ** 0.7 - 5000 ** 0.7)));
    expect(() => milestoneXp(3)).toThrow();
  });

  it("accumulates to about 2000 · h^0.7 at each milestone", () => {
    for (const h of PLAYTIME_MILESTONES_H) {
      expect(Math.abs(playtimeXp(h * 60) - 2000 * h ** 0.7)).toBeLessThanOrEqual(PLAYTIME_MILESTONES_H.length);
    }
    expect(playtimeXp(10 * 60)).toBeGreaterThan(9_900);
    expect(playtimeXp(100 * 60)).toBeGreaterThan(50_000);
  });

  it("pays nothing for 0 h, invalid values or less than an hour", () => {
    expect(reachedMilestones(0)).toEqual([]);
    expect(reachedMilestones(-5)).toEqual([]);
    expect(reachedMilestones(Number.NaN)).toEqual([]);
    expect(reachedMilestones(59)).toEqual([]);
    expect(reachedMilestones(60)).toEqual([{ hours: 1, xp: 2000 }]);
  });

  it("reaches milestones by whole minutes (3000 h pays up to 2500 h)", () => {
    expect(reachedMilestones(3000 * 60).map((m) => m.hours)).toEqual([1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500]);
    expect(reachedMilestones(10_000 * 60 + 1).at(-1)?.hours).toBe(10000);
  });

  it("is concave: the second 250 h are worth less than the first", () => {
    expect(playtimeXp(500 * 60) - playtimeXp(250 * 60)).toBeLessThan(playtimeXp(250 * 60));
  });

  it("builds and parses the ledger sourceKey", () => {
    const key = playtimeSourceKey("psn", "cgame123", 25);
    expect(key).toBe("psn:cgame123:25");
    expect(playtimeGameId(key)).toBe("cgame123");
    expect(playtimeGameId("broken")).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import {
  PAID_MILESTONES_H,
  PLAYTIME_MAX_GAMES,
  PLAYTIME_MILESTONES_H,
  PLAYTIME_NEW_GAMES_PER_DAY,
  milestoneXp,
  playtimeGameId,
  playtimeSourceKey,
  playtimeXp,
  reachedMilestones,
} from "./playtime";

describe("playtime XP", () => {
  it("uses the milestone list of the spec; only 5 h and up pay", () => {
    expect([...PLAYTIME_MILESTONES_H]).toEqual([1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]);
    expect([...PAID_MILESTONES_H]).toEqual([5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]);
    expect(PLAYTIME_NEW_GAMES_PER_DAY).toBe(10);
    expect(PLAYTIME_MAX_GAMES).toBe(150);
  });

  it("pays nothing for 1 h and 2 h; 5 h pays the full value up to it; later ones the difference", () => {
    expect(milestoneXp(1)).toBe(0);
    expect(milestoneXp(2)).toBe(0);
    expect(milestoneXp(5)).toBe(Math.round(2000 * 5 ** 0.7));
    expect(milestoneXp(10)).toBe(Math.round(2000 * (10 ** 0.7 - 5 ** 0.7)));
    expect(milestoneXp(10000)).toBe(Math.round(2000 * (10000 ** 0.7 - 5000 ** 0.7)));
    expect(() => milestoneXp(3)).toThrow();
  });

  it("from 5 h on, accumulates to about 2000 · h^0.7 at each milestone", () => {
    for (const h of PAID_MILESTONES_H) {
      expect(Math.abs(playtimeXp(h * 60) - 2000 * h ** 0.7)).toBeLessThanOrEqual(PAID_MILESTONES_H.length);
    }
    expect(playtimeXp(10 * 60)).toBeGreaterThan(9_900);
    expect(playtimeXp(100 * 60)).toBeGreaterThan(50_000);
  });

  it("pays nothing below 5 h, for 0 h or for invalid values", () => {
    expect(reachedMilestones(0)).toEqual([]);
    expect(reachedMilestones(-5)).toEqual([]);
    expect(reachedMilestones(Number.NaN)).toEqual([]);
    expect(reachedMilestones(60)).toEqual([]);
    expect(reachedMilestones(5 * 60 - 1)).toEqual([]);
    expect(reachedMilestones(5 * 60)).toEqual([{ hours: 5, xp: Math.round(2000 * 5 ** 0.7) }]);
  });

  it("reaches milestones by whole minutes (3000 h pays up to 2500 h)", () => {
    expect(reachedMilestones(3000 * 60).map((m) => m.hours)).toEqual([5, 10, 25, 50, 100, 250, 500, 1000, 2500]);
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

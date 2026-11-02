import { describe, expect, it } from "vitest";
import { BIG_RELEASE_HEAT, releaseHeat } from "./heat";

describe("releaseHeat", () => {
  it("is 0 without any signal", () => {
    expect(releaseHeat({})).toBe(0);
  });

  it("a Steam list position alone stays below a hyped or reviewed game", () => {
    const listOnly = releaseHeat({ steamList: [1000] });
    expect(listOnly).toBeLessThanOrEqual(400);
    expect(releaseHeat({ igdb: [300] })).toBeGreaterThan(listOnly);
    expect(releaseHeat({ steamList: [990], reviews: 1_000 })).toBeGreaterThan(listOnly);
  });

  it("a huge launch is big; a quiet one is not", () => {
    expect(releaseHeat({ igdb: [4_000] })).toBeGreaterThanOrEqual(BIG_RELEASE_HEAT);
    expect(releaseHeat({ steamList: [995], reviews: 40 })).toBeLessThan(BIG_RELEASE_HEAT);
  });

  it("more signals add a little on top of the strongest", () => {
    expect(releaseHeat({ reviews: 10_000, players: 5_000 })).toBeGreaterThan(releaseHeat({ reviews: 10_000 }));
  });
});

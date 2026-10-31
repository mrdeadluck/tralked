import { describe, expect, it } from "vitest";
import { despertarSteps } from "./despertar";

describe("despertarSteps", () => {
  it("lists every intermediate level up to the final one", () => {
    expect(despertarSteps(1, 4)).toEqual([2, 3, 4]);
    expect(despertarSteps(5, 6)).toEqual([6]);
  });

  it("returns all 12 steps when there are exactly 12 levels to show", () => {
    expect(despertarSteps(1, 13)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("samples evenly down to 12 steps and always ends on the final level", () => {
    expect(despertarSteps(1, 25)).toEqual([3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25]);
    const steps = despertarSteps(0, 47);
    expect(steps).toHaveLength(12);
    expect(steps[11]).toBe(47);
    expect(new Set(steps).size).toBe(12);
    expect(steps).toEqual([4, 8, 12, 16, 20, 24, 27, 31, 35, 39, 43, 47]);
  });

  it("is empty when nothing was gained", () => {
    expect(despertarSteps(5, 5)).toEqual([]);
    expect(despertarSteps(8, 3)).toEqual([]);
  });
});

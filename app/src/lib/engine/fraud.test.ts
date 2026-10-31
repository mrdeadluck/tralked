import { describe, expect, it } from "vitest";
import { findBursts, isSpeedPlatinum } from "./fraud";

const T0 = new Date("2026-10-31T12:00:00Z").getTime();

function unlocks(count: number, spreadSec: number, prefix = "a") {
  return Array.from({ length: count }, (_, i) => ({
    achievementId: `${prefix}${i}`,
    unlockedAt: new Date(T0 + ((i * spreadSec) / (count - 1)) * 1000),
  }));
}

describe("findBursts", () => {
  it("flags 10 unlocks within 59s", () => {
    const set = findBursts(unlocks(10, 59));
    expect(set.size).toBe(10);
    for (let i = 0; i < 10; i++) expect(set.has(`a${i}`)).toBe(true);
  });

  it("does not flag 9 unlocks within 59s", () => {
    expect(findBursts(unlocks(9, 59)).size).toBe(0);
  });

  it("does not flag 10 unlocks spread over 10 minutes", () => {
    expect(findBursts(unlocks(10, 600)).size).toBe(0);
  });

  it("accepts unsorted input and flags only the burst", () => {
    const burst = unlocks(10, 30);
    const slow = unlocks(3, 3600, "slow").map((u) => ({
      ...u,
      unlockedAt: new Date(u.unlockedAt.getTime() + 7_200_000),
    }));
    const set = findBursts([...slow, ...burst].reverse());
    expect(set.size).toBe(10);
    expect(set.has("slow0")).toBe(false);
  });

  it("honours custom window and minCount", () => {
    expect(findBursts(unlocks(3, 5), 10, 3).size).toBe(3);
    expect(findBursts(unlocks(3, 5), 4, 3).size).toBe(0);
  });
});

describe("isSpeedPlatinum", () => {
  it("flags playtime under 5% of the average", () => {
    expect(isSpeedPlatinum(10, 600)).toBe(true);
  });

  it("does not flag normal playtime", () => {
    expect(isSpeedPlatinum(100, 600)).toBe(false);
  });

  it("does not flag when the average is unknown", () => {
    expect(isSpeedPlatinum(10, null)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  expFor,
  levelFromXp,
  platinumBonus,
  rarityTier,
  xpForAchievement,
} from "./xp";

describe("expFor", () => {
  it("follows the Tibia curve", () => {
    expect(expFor(1)).toBe(0);
    expect(expFor(2)).toBe(100);
    expect(expFor(47)).toBe(1522600);
    expect(expFor(48)).toBe(1626200);
  });
});

describe("levelFromXp", () => {
  it("has a minimum level of 1", () => {
    expect(levelFromXp(0).level).toBe(1);
  });

  it("resolves level boundaries exactly", () => {
    expect(levelFromXp(1522600).level).toBe(47);
    expect(levelFromXp(1626199).level).toBe(47);
    expect(levelFromXp(1626200).level).toBe(48);
  });

  it("reports progress inside the level", () => {
    const r = levelFromXp(150);
    expect(r.level).toBe(2);
    expect(r.current).toBe(50);
    expect(r.next).toBe(100);
    expect(r.fraction).toBeCloseTo(0.5);
  });
});

describe("xpForAchievement", () => {
  it("rewards rarer achievements more", () => {
    expect(xpForAchievement(2)).toBe(18643);
    expect(xpForAchievement(50)).toBe(2665);
  });

  it("treats unknown rarity as 50%", () => {
    expect(xpForAchievement(null)).toBe(2665);
  });
});

describe("rarityTier", () => {
  it("classifies by global percentage", () => {
    expect(rarityTier(3)).toBe("lendaria");
    expect(rarityTier(3.1)).toBe("epica");
    expect(rarityTier(8)).toBe("epica");
    expect(rarityTier(20)).toBe("rara");
    expect(rarityTier(50)).toBe("incomum");
    expect(rarityTier(50.1)).toBe("comum");
  });
});

describe("platinumBonus", () => {
  it("is 10% of the achievement XP sum, rounded", () => {
    expect(platinumBonus([1000, 2000])).toBe(300);
    expect(platinumBonus([])).toBe(0);
  });
});

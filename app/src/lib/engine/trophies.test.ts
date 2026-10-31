import { describe, expect, it } from "vitest";
import {
  gloryPoints,
  trophyTierFromRarity,
  xpForPlatformAchievement,
} from "./trophies";
import { xpForAchievement } from "./xp";

describe("trophyTierFromRarity", () => {
  it("maps rarity thresholds to tiers", () => {
    expect(trophyTierFromRarity(0.4)).toBe("gold");
    expect(trophyTierFromRarity(5)).toBe("gold");
    expect(trophyTierFromRarity(5.01)).toBe("silver");
    expect(trophyTierFromRarity(20)).toBe("silver");
    expect(trophyTierFromRarity(20.01)).toBe("bronze");
    expect(trophyTierFromRarity(80)).toBe("bronze");
  });

  it("treats unknown rarity as bronze and never yields platinum", () => {
    expect(trophyTierFromRarity(null)).toBe("bronze");
    expect(trophyTierFromRarity(0)).toBe("gold");
  });
});

describe("gloryPoints", () => {
  it("is 1/2/5/15 for bronze/silver/gold/platinum", () => {
    expect(gloryPoints("bronze")).toBe(1);
    expect(gloryPoints("silver")).toBe(2);
    expect(gloryPoints("gold")).toBe(5);
    expect(gloryPoints("platinum")).toBe(15);
  });
});

describe("xpForPlatformAchievement", () => {
  const none = { points: null, trophyTier: null, hardcore: false };

  it("uses the base rarity formula for Steam", () => {
    expect(
      xpForPlatformAchievement({ platform: "steam", globalPct: 2, ...none }),
    ).toBe(xpForAchievement(2));
    expect(xpForAchievement(2)).toBe(18643);
  });

  it("Xbox: gamerscore x120 wins when higher than the base", () => {
    // base(50%) = 2665; 100G * 120 = 12000
    expect(
      xpForPlatformAchievement({
        platform: "xbox",
        globalPct: 50,
        points: 100,
        trophyTier: null,
        hardcore: false,
      }),
    ).toBe(12000);
  });

  it("Xbox: keeps the base when it is higher than gamerscore x120", () => {
    // base(2%) = 18643; 5G * 120 = 600
    expect(
      xpForPlatformAchievement({
        platform: "xbox",
        globalPct: 2,
        points: 5,
        trophyTier: null,
        hardcore: false,
      }),
    ).toBe(18643);
  });

  it("Xbox without points falls back to the base", () => {
    expect(
      xpForPlatformAchievement({ platform: "xbox", globalPct: 2, ...none }),
    ).toBe(18643);
  });

  it("PSN without rarity is paid by tier", () => {
    const base = {
      platform: "psn" as const,
      globalPct: null,
      points: null,
      hardcore: false,
    };
    expect(xpForPlatformAchievement({ ...base, trophyTier: "bronze" })).toBe(2000);
    expect(xpForPlatformAchievement({ ...base, trophyTier: "silver" })).toBe(4000);
    expect(xpForPlatformAchievement({ ...base, trophyTier: "gold" })).toBe(9000);
    expect(xpForPlatformAchievement({ ...base, trophyTier: "platinum" })).toBe(25000);
  });

  it("PSN with rarity uses the base formula", () => {
    expect(
      xpForPlatformAchievement({
        platform: "psn",
        globalPct: 2,
        points: null,
        trophyTier: "gold",
        hardcore: false,
      }),
    ).toBe(18643);
  });

  it("RetroAchievements hardcore gets x1.25", () => {
    // base(2%) = 18643 -> 23303.75 -> 23304
    expect(
      xpForPlatformAchievement({
        platform: "retro",
        globalPct: 2,
        points: 10,
        trophyTier: null,
        hardcore: true,
      }),
    ).toBe(23304);
    expect(
      xpForPlatformAchievement({
        platform: "retro",
        globalPct: 2,
        points: 10,
        trophyTier: null,
        hardcore: false,
      }),
    ).toBe(18643);
  });

  it("hardcore flag is ignored outside RetroAchievements", () => {
    expect(
      xpForPlatformAchievement({
        platform: "steam",
        globalPct: 2,
        points: null,
        trophyTier: null,
        hardcore: true,
      }),
    ).toBe(18643);
  });
});

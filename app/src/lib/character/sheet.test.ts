import { describe, expect, it } from "vitest";
import { attributeLevel } from "@/lib/engine/attributes";
import { attributeBand, attributeLevelStart, summarizeTrophies } from "./sheet";

describe("attributeBand", () => {
  it("starts every level where attributeLevel says it starts", () => {
    for (let level = 1; level <= 30; level++) {
      const start = attributeLevelStart(level);
      expect(attributeLevel(start)).toBe(level);
      if (start > 0) expect(attributeLevel(start - 1)).toBe(level - 1);
    }
  });

  it("gives the progress inside the current level", () => {
    expect(attributeBand(0)).toEqual({ level: 1, current: 0, span: 25 });
    // Level 3 spans 100..224.
    expect(attributeBand(138)).toEqual({ level: 3, current: 38, span: 125 });
    expect(attributeBand(225)).toEqual({ level: 4, current: 0, span: 175 });
    expect(attributeBand(-5)).toEqual({ level: 1, current: 0, span: 25 });
  });
});

describe("summarizeTrophies", () => {
  it("uses the native tier, otherwise the rarity tier, and counts unlocks per platform", () => {
    const summary = summarizeTrophies(
      [
        { gameId: "hk", platform: "psn", trophyTier: "platinum", globalPct: null },
        { gameId: "hk", platform: "psn", trophyTier: "gold", globalPct: 40 },
        { gameId: "hk", platform: "steam", trophyTier: null, globalPct: 3 }, // gold by rarity
        { gameId: "hk", platform: "steam", trophyTier: null, globalPct: 12 }, // silver
        { gameId: "hk", platform: "xbox", trophyTier: null, globalPct: 60 }, // bronze
        { gameId: "hk", platform: "retro", trophyTier: null, globalPct: null }, // bronze (unknown rarity)
      ],
      1,
    );
    expect(summary.tiers).toEqual({ platinum: 1, gold: 2, silver: 1, bronze: 2 });
    expect(summary.byPlatform).toEqual([
      { platform: "steam", unlocks: 2 },
      { platform: "psn", unlocks: 2 },
      { platform: "xbox", unlocks: 1 },
      { platform: "retro", unlocks: 1 },
    ]);
  });

  it("takes its platinum tier from the header's count (platinumCount), never from the unlocks", () => {
    const summary = summarizeTrophies([{ gameId: "hk", platform: "psn", trophyTier: "platinum", globalPct: null }], 3);
    expect(summary.tiers).toEqual({ platinum: 3, gold: 0, silver: 0, bronze: 0 });
  });
});

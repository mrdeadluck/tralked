import { describe, expect, it } from "vitest";
import { summarizeTrophies } from "./sheet";
import { platinumCount } from "./counts";

describe("platinum count (sheet and Troféus card)", () => {
  const completions = [
    { gameId: "hk", platform: "steam" },
    { gameId: "hk", platform: "psn" },
    { gameId: "celeste", platform: "xbox" },
  ];
  const native = [{ gameId: "hk", platform: "psn" }, { gameId: "gow", platform: "psn" }];

  it("counts native platinum trophies plus 100% where there is none, once per game and platform", () => {
    // hk:psn is both a native platinum and a completion: one platinum, not two.
    expect(platinumCount(native, completions)).toBe(4);
    expect(platinumCount([...native, ...native], completions)).toBe(4);
    expect(platinumCount([], [])).toBe(0);
  });

  it("the Troféus card's platinum tier is the same number as the sheet's Platinas", () => {
    const unlocks = [
      { gameId: "hk", platform: "psn", trophyTier: "platinum", globalPct: null },
      { gameId: "gow", platform: "psn", trophyTier: "platinum", globalPct: null },
      { gameId: "hk", platform: "steam", trophyTier: null, globalPct: 2 },
    ];
    const card = summarizeTrophies(unlocks, completions);
    expect(card.tiers.platinum).toBe(platinumCount(native, completions));
    expect(card.tiers.gold).toBe(1);
  });
});

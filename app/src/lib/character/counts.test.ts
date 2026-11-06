import { describe, expect, it } from "vitest";
import { platinumCount, type PlatinumList } from "./counts";

const list = (gameId: string, platform: string, versionKey: string, over: Partial<PlatinumList> = {}): PlatinumList => ({
  gameId,
  platform,
  versionKey,
  completed: true,
  tainted: false,
  ...over,
});

describe("platinumCount (the ledger's platinum entries, one per version)", () => {
  it("PS4 and PS5 are two, two regions of one console are one, two Xbox titleIds are two", () => {
    expect(platinumCount([list("gta", "psn", "psn:PS4"), list("gta", "psn", "psn:PS5"), list("gta", "psn", "psn:PS5")], [])).toBe(2);
    expect(platinumCount([list("halo", "xbox", "xbox:1"), list("halo", "xbox", "xbox:2")], [])).toBe(2);
    expect(platinumCount([], [])).toBe(0);
  });

  it("a list short of 100% or with a suspicious unlock pays none; another console never covers a version", () => {
    expect(
      platinumCount(
        [
          list("gta", "psn", "psn:PS5", { completed: false }),
          list("gta", "psn", "psn:PS4"),
          list("hk", "psn", "psn:PS5", { tainted: true }),
        ],
        [],
      ),
    ).toBe(1);
  });

  it("a 100% counts under the legacy key only where the player has no list; Steam always", () => {
    const completions = [
      { gameId: "gta", platform: "psn" }, // has lists: their completions count instead
      { gameId: "old", platform: "psn" }, // no list yet: legacy platinum
      { gameId: "gta", platform: "steam" },
    ];
    expect(platinumCount([list("gta", "psn", "psn:PS4", { completed: false })], completions)).toBe(2);
  });
});

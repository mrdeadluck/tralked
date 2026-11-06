import { describe, expect, it } from "vitest";
import { platinumCount, type NativePlatinum, type PlatinumList } from "./counts";

const list = (gameId: string, platform: string, versionKey: string, over: Partial<PlatinumList> = {}): PlatinumList => ({
  gameId,
  platform,
  versionKey,
  completed: true,
  tainted: false,
  ...over,
});
const native = (gameId: string, versionKey: string, platform = "psn"): NativePlatinum => ({ gameId, platform, versionKey });

describe("platinumCount (at most one per version)", () => {
  it("PS4 and PS5 are two, two regions of one console are one, two Xbox titleIds are two", () => {
    expect(platinumCount([], [list("gta", "psn", "psn:PS4"), list("gta", "psn", "psn:PS5"), list("gta", "psn", "psn:PS5")], [])).toBe(2);
    expect(platinumCount([], [list("halo", "xbox", "xbox:1"), list("halo", "xbox", "xbox:2")], [])).toBe(2);
    expect(platinumCount([], [], [])).toBe(0);
  });

  it("a native platinum trophy counts its version whatever the list's %, once with its 100%", () => {
    const lists = [list("gta", "psn", "psn:PS5", { completed: false }), list("gta", "psn", "psn:PS4")];
    expect(platinumCount([native("gta", "psn:PS5")], lists, [])).toBe(2);
    expect(platinumCount([native("gta", "psn:PS4"), native("gta", "psn:PS4")], [list("gta", "psn", "psn:PS4")], [])).toBe(1);
  });

  it("a list short of 100% or with a suspicious unlock pays no bonus; another console never covers a version", () => {
    expect(
      platinumCount(
        [native("gta", "psn:PS5")],
        [list("gta", "psn", "psn:PS5"), list("gta", "psn", "psn:PS4"), list("hk", "psn", "psn:PS5", { tainted: true }), list("hk", "psn", "psn:PS4", { completed: false })],
        [],
      ),
    ).toBe(2);
  });

  it("a 100% counts under the legacy key only where the player has no list; Steam always", () => {
    const completions = [
      { gameId: "gta", platform: "psn" }, // has lists: their completions count instead
      { gameId: "old", platform: "psn" }, // no list yet: legacy platinum, the same as its list-less trophy
      { gameId: "gta", platform: "steam" },
    ];
    expect(platinumCount([native("old", "psn")], [list("gta", "psn", "psn:PS4", { completed: false })], completions)).toBe(2);
    // A list-less platinum row of a game that has lists now: its lists speak for it.
    expect(platinumCount([native("gta", "psn")], [list("gta", "psn", "psn:PS4", { completed: false })], [])).toBe(0);
  });
});

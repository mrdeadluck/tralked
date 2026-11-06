import { describe, expect, it } from "vitest";
import { platinumCount, type NativePlatinum, type PlatinumList } from "./counts";

const list = (listId: string, gameId: string, platform: string, versionKey: string, over: Partial<PlatinumList> = {}): PlatinumList => ({
  listId,
  gameId,
  platform,
  versionKey,
  completed: true,
  tainted: false,
  ...over,
});
/** A valid platinum trophy on a list (`listId`), or list-less (null: versionKey = platform). */
const native = (gameId: string, listId: string | null, versionKey: string, platform = "psn", apiName?: string): NativePlatinum => ({
  gameId,
  platform,
  listId,
  versionKey,
  apiName,
});
const total = (...args: Parameters<typeof platinumCount>) => platinumCount(...args).platinums;

describe("platinumCount (one per list)", () => {
  it("every PSN platinum trophy counts, two regions of one console are two", () => {
    const natives = [native("gta", "eu5", "psn:PS5"), native("gta", "jp5", "psn:PS5"), native("gta", "eu4", "psn:PS4")];
    const lists = [list("eu5", "gta", "psn", "psn:PS5"), list("jp5", "gta", "psn", "psn:PS5"), list("eu4", "gta", "psn", "psn:PS4")];
    expect(platinumCount(natives, lists, [])).toEqual({ platinums: 3, psnPlatinums: 3, perVersion: 2 });
    expect(platinumCount([], [], [])).toEqual({ platinums: 0, psnPlatinums: 0, perVersion: 0 });
  });

  it("a platinum trophy counts whatever the list's %, once with its own 100%", () => {
    const lists = [list("a", "gta", "psn", "psn:PS5", { completed: false }), list("b", "gta", "psn", "psn:PS4")];
    expect(total([native("gta", "a", "psn:PS5"), native("gta", "b", "psn:PS4")], lists, [])).toBe(2);
  });

  it("a 100% without a platinum trophy counts one per list (PSN without platinum, Xbox titleIds, RA)", () => {
    const lists = [
      list("p4", "indie", "psn", "psn:PS4"),
      list("p5a", "indie", "psn", "psn:PS5"),
      list("p5b", "indie", "psn", "psn:PS5"),
      list("x1", "halo", "xbox", "xbox:1"),
      list("x2", "halo", "xbox", "xbox:2"),
      list("r1", "snes", "retro", "retro:77"),
    ];
    // The PSN 100%s without a platinum trophy are platinums, but not "na PSN" (Sony counts trophies).
    expect(platinumCount([], lists, [])).toEqual({ platinums: 6, psnPlatinums: 0, perVersion: 5 });
  });

  it("a list short of 100% or with a suspicious unlock pays no bonus", () => {
    const lists = [list("a", "hk", "psn", "psn:PS5", { tainted: true }), list("b", "hk", "psn", "psn:PS4", { completed: false })];
    expect(total([], lists, [])).toBe(0);
  });

  it("a 100% counts under the legacy key only where the player has no list; Steam always", () => {
    const completions = [
      { gameId: "gta", platform: "psn" }, // has lists: their completions count instead
      { gameId: "old", platform: "psn" }, // no list yet: legacy platinum, the same as its list-less trophy
      { gameId: "gta", platform: "steam" },
    ];
    expect(
      platinumCount([native("old", null, "psn")], [list("a", "gta", "psn", "psn:PS4", { completed: false })], completions),
    ).toEqual({ platinums: 2, psnPlatinums: 1, perVersion: 2 });
  });

  it("a list-less platinum keeps counting until a list row holds the same trophy", () => {
    const incomplete = [list("a", "gta", "psn", "psn:PS4", { completed: false })];
    // No list row holds the platinum yet: the list-less one counts.
    expect(total([native("gta", null, "psn", "psn", "0")], incomplete, [])).toBe(1);
    // A list row holds the same trophy (valid unlock): that list speaks for it, once.
    expect(total([native("gta", null, "psn", "psn", "0"), native("gta", "a", "psn:PS4", "psn", "0")], incomplete, [])).toBe(1);
    // A list row holds another trophy: it does not cover this one.
    expect(total([native("gta", null, "psn", "psn", "0"), native("gta", "a", "psn:PS4", "psn", "7")], incomplete, [])).toBe(2);
    // Another game is never covered.
    expect(total([native("gta", null, "psn", "psn", "0"), native("old", "b", "psn:PS4", "psn", "0")], incomplete, [])).toBe(2);
  });
});

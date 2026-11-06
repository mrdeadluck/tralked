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
/** A valid platinum trophy on a list (`listId`). */
const native = (gameId: string, listId: string, versionKey: string, platform = "psn"): NativePlatinum => ({
  gameId,
  platform,
  listId,
  versionKey,
});
const total = (...args: Parameters<typeof platinumCount>) => platinumCount(...args).platinums;
const tralked = (...args: Parameters<typeof platinumCount>) => platinumCount(...args).tralked;

describe("Platinas (PSN platinum trophies only)", () => {
  it("every PSN platinum trophy counts, two regions of one console are two", () => {
    const natives = [native("gta", "eu5", "psn:PS5"), native("gta", "jp5", "psn:PS5"), native("gta", "eu4", "psn:PS4")];
    const lists = [list("eu5", "gta", "psn", "psn:PS5"), list("jp5", "gta", "psn", "psn:PS5"), list("eu4", "gta", "psn", "psn:PS4")];
    expect(platinumCount(natives, lists, [])).toMatchObject({ platinums: 3, psnPlatinums: 3, perVersion: 2, byPlatform: { psn: 3 } });
    expect(platinumCount([], [], [])).toMatchObject({ platinums: 0, psnPlatinums: 0, perVersion: 0 });
  });

  it("a platinum trophy counts whatever the list's %", () => {
    const lists = [list("a", "gta", "psn", "psn:PS5", { completed: false }), list("b", "gta", "psn", "psn:PS4")];
    expect(total([native("gta", "a", "psn:PS5"), native("gta", "b", "psn:PS4")], lists, [])).toBe(2);
  });

  it("never counts Steam, Xbox, RA or PSN-without-platinum completions", () => {
    const lists = [
      list("p4", "indie", "psn", "psn:PS4"),
      list("x1", "halo", "xbox", "xbox:1"),
      list("r1", "snes", "retro", "retro:77"),
    ];
    expect(platinumCount([], lists, [{ gameId: "g", platform: "steam" }, { gameId: "old", platform: "psn" }]).platinums).toBe(0);
  });
});

describe("Tralked (lists completed at 100% on any platform)", () => {
  it("counts a PSN list at 100% (with or without a platinum trophy), one per list", () => {
    const lists = [
      list("p4", "indie", "psn", "psn:PS4"),
      list("p5a", "indie", "psn", "psn:PS5"),
      list("p5b", "indie", "psn", "psn:PS5"),
    ];
    expect(platinumCount([], lists, [])).toMatchObject({ tralked: 3, tralkedByPlatform: { psn: 3 }, platinums: 0 });
  });

  it("does not count a platinated list short of 100% (DLC missing)", () => {
    const lists = [list("a", "gta", "psn", "psn:PS4", { completed: false })];
    const r = platinumCount([native("gta", "a", "psn:PS4")], lists, []);
    expect(r.platinums).toBe(1);
    expect(r.tralked).toBe(0);
  });

  it("counts Steam 100% (UserGame.completedAt) and Xbox/RA lists at 100%", () => {
    const lists = [
      list("x1", "halo", "xbox", "xbox:1"),
      list("x2", "halo", "xbox", "xbox:2"),
      list("r1", "snes", "retro", "retro:77"),
    ];
    expect(platinumCount([], lists, [{ gameId: "hk", platform: "steam" }])).toMatchObject({
      tralked: 4,
      tralkedByPlatform: { steam: 1, xbox: 2, retro: 1 },
    });
  });

  it("counts an Xbox list that earned 1000G even with DLC missing, but not 999G", () => {
    const lists = [
      list("x1", "halo", "xbox", "xbox:1", { completed: false, gamerscore: 1000 }),
      list("x2", "fh", "xbox", "xbox:2", { completed: false, gamerscore: 999 }),
      list("x3", "fh2", "xbox", "xbox:3", { completed: false, gamerscore: 1250, tainted: true }),
    ];
    expect(tralked([], lists, [])).toBe(1);
  });

  it("the 1000G rule is Xbox only", () => {
    expect(tralked([], [list("p", "g", "psn", "psn:PS4", { completed: false, gamerscore: 5000 })], [])).toBe(0);
  });

  it("excludes lists with a suspicious unlock", () => {
    const lists = [list("a", "hk", "psn", "psn:PS5", { tainted: true }), list("b", "hk", "psn", "psn:PS4", { completed: false })];
    expect(tralked([], lists, [])).toBe(0);
  });

  it("a legacy 100% counts only where the player has no list; Steam always", () => {
    const completions = [
      { gameId: "gta", platform: "psn" }, // has lists: their completions count instead
      { gameId: "old", platform: "psn" }, // no list yet
      { gameId: "gta", platform: "steam" },
    ];
    expect(platinumCount([], [list("a", "gta", "psn", "psn:PS4", { completed: false })], completions)).toMatchObject({
      tralked: 2,
      tralkedByPlatform: { psn: 1, steam: 1 },
    });
  });
});

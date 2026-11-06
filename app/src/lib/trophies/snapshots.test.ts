import { describe, expect, it } from "vitest";
import type { UserNumbers } from "./numbers";
import { compareSnapshots, type Snapshot } from "./snapshots";

const user = (over: Partial<UserNumbers> = {}): UserNumbers => ({
  userId: "u1",
  handle: "lucas",
  steamUnlocks: 100,
  steamXp: 5000,
  psnUnlocks: 10,
  xboxUnlocks: 0,
  retroUnlocks: 0,
  platinums: 1,
  psnPlatinums: 1,
  totalXp: 6000,
  level: 10,
  ...over,
});
const snap = (label: string, users: UserNumbers[]): Snapshot => ({ label, takenAt: "2026-11-05T00:00:00Z", database: "x", users });

describe("compareSnapshots", () => {
  it("lists what changed; PSN growth alone is not a Steam change", () => {
    const r = compareSnapshots(snap("a", [user()]), snap("b", [user({ psnUnlocks: 30, totalXp: 6400 })]));
    expect(r).toEqual({
      lines: ["lucas: psnUnlocks 10 -> 30 (+20)", "lucas: totalXp 6000 -> 6400 (+400)"],
      steamChanged: false,
    });
  });

  it("flags any Steam difference and a user missing on one side", () => {
    expect(compareSnapshots(snap("a", [user()]), snap("b", [user({ steamXp: 4990 })]))).toEqual({
      lines: ["lucas: steamXp 5000 -> 4990 (-10)  <- STEAM"],
      steamChanged: true,
    });
    expect(compareSnapshots(snap("a", [user()]), snap("b", [])).steamChanged).toBe(true);
    expect(compareSnapshots(snap("a", []), snap("b", [user({ steamUnlocks: 0, steamXp: 0 })])).steamChanged).toBe(false);
  });

  it("a number an older snapshot does not have shows without a delta", () => {
    // A snapshot taken before every regional list counted has no psnPlatinums.
    const old: Partial<UserNumbers> = user();
    delete old.psnPlatinums;
    const r = compareSnapshots(snap("a", [old as UserNumbers]), snap("b", [user({ platinums: 2, psnPlatinums: 2 })]));
    expect(r).toEqual({ lines: ["lucas: platinums 1 -> 2 (+1)", "lucas: psnPlatinums — -> 2"], steamChanged: false });
  });
});

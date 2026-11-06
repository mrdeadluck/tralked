import { describe, expect, it } from "vitest";
import type { UserNumbers } from "./numbers";
import { compareSnapshots, type Snapshot } from "./snapshots";

const user = (over: Partial<UserNumbers> = {}): UserNumbers => ({
  userId: "u1",
  handle: "lucas",
  steamUnlocks: 100,
  steamXp: 5000,
  steamUndatedUnlocks: 0,
  steamUndatedXp: 0,
  psnUnlocks: 10,
  xboxUnlocks: 0,
  retroUnlocks: 0,
  platinums: 1,
  regionalExtras: 0,
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
      steamUndatedChanged: false,
    });
  });

  it("flags any Steam difference and a user missing on one side", () => {
    expect(compareSnapshots(snap("a", [user()]), snap("b", [user({ steamXp: 4990 })]))).toEqual({
      lines: ["lucas: steamXp 5000 -> 4990 (-10)  <- STEAM"],
      steamChanged: true,
      steamUndatedChanged: false,
    });
    expect(compareSnapshots(snap("a", [user()]), snap("b", [])).steamChanged).toBe(true);
    expect(compareSnapshots(snap("a", []), snap("b", [user({ steamUnlocks: 0, steamXp: 0 })])).steamChanged).toBe(false);
  });

  it("Steam growth that is exactly the undated unlocks (steam:dateless) is its own line, not a Steam change", () => {
    const after = user({ steamUnlocks: 199, steamXp: 9000, steamUndatedUnlocks: 99, steamUndatedXp: 4000, totalXp: 10000 });
    expect(compareSnapshots(snap("a", [user()]), snap("b", [after]))).toEqual({
      lines: [
        "lucas: totalXp 6000 -> 10000 (+4000)",
        "lucas: Steam sem data: unlocks 0 -> 99 (+99), XP 0 -> 4000 (+4000)",
      ],
      steamChanged: false,
      steamUndatedChanged: true,
    });
    // Snapshots taken before the undated numbers existed read them as 0.
    const old = { ...user() } as Partial<UserNumbers>;
    delete old.steamUndatedUnlocks;
    delete old.steamUndatedXp;
    expect(compareSnapshots(snap("a", [old as UserNumbers]), snap("b", [after])).steamChanged).toBe(false);
  });

  it("a dated Steam change next to the undated growth is still flagged", () => {
    const after = user({ steamUnlocks: 198, steamXp: 9000, steamUndatedUnlocks: 99, steamUndatedXp: 4000 });
    const r = compareSnapshots(snap("a", [user()]), snap("b", [after]));
    expect(r.steamChanged).toBe(true);
    expect(r.lines).toContain("lucas: steamUnlocks 100 -> 198 (+98)  <- STEAM");
    expect(r.lines).not.toContain("lucas: steamXp 5000 -> 9000 (+4000)  <- STEAM");
  });
});

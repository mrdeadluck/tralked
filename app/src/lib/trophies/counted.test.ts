import { describe, expect, it } from "vitest";
import { countedUnlocks } from "./counted";

type L = { platform: string; console: string | null; externalId: string } | null;
const row = (id: string, platform: string, list: L, apiName: string, day: number, gameId = "g1") => ({
  id,
  unlockedAt: new Date(Date.UTC(2026, 0, day)),
  achievement: { gameId, platform, apiName, list },
});
const ps5 = (externalId: string): L => ({ platform: "psn", console: "PS5", externalId });
const ps4: L = { platform: "psn", console: "PS4", externalId: "NPWR3_00" };

describe("countedUnlocks", () => {
  it("keeps the earliest of the same PSN trophy in two lists of one console", () => {
    const rows = [row("late", "psn", ps5("NPWR1_00"), "1", 9), row("early", "psn", ps5("NPWR2_00"), "1", 2)];
    expect(countedUnlocks(rows).map((r) => r.id)).toEqual(["early"]);
  });

  it("PS4 and PS5 are different versions: both count", () => {
    const rows = [row("a", "psn", ps4, "1", 1), row("b", "psn", ps5("NPWR1_00"), "1", 2)];
    expect(countedUnlocks(rows)).toHaveLength(2);
  });

  it("different trophies and different games are never merged", () => {
    const rows = [
      row("a", "psn", ps5("NPWR1_00"), "1", 1),
      row("b", "psn", ps5("NPWR1_00"), "2", 1),
      row("c", "psn", ps5("NPWR1_00"), "1", 1, "g2"),
    ];
    expect(countedUnlocks(rows)).toHaveLength(3);
  });

  it("Steam, Xbox, RA and list-less rows pass through, in order", () => {
    const xbox: L = { platform: "xbox", console: "ONE", externalId: "t1" };
    const rows = [
      row("s1", "steam", null, "1", 1),
      row("s2", "steam", { platform: "steam", console: "PC", externalId: "10" }, "1", 2),
      row("x1", "xbox", xbox, "1", 3),
      row("x2", "xbox", xbox, "1", 4),
      row("p1", "psn", null, "1", 5),
      row("p2", "psn", null, "1", 6),
    ];
    expect(countedUnlocks(rows).map((r) => r.id)).toEqual(["s1", "s2", "x1", "x2", "p1", "p2"]);
  });
});

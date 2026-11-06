import { describe, expect, it } from "vitest";
import type { GameVersion } from "@/lib/queries/game-versions";
import { achievementsFact, familyTotals } from "./version-views";

const version = (key: string, platform: GameVersion["platform"], total: number): GameVersion => ({
  key,
  platform,
  label: key,
  total,
  tiers: { platinum: 0, gold: 0, silver: 0, bronze: total },
  nativePlatinum: false,
  lists: [],
  trophies: [],
});

describe("the ficha's Conquistas", () => {
  // GTA V: PS5 has two regional lists of 78 (one version), PS4 77, PS3 59, Xbox 360 49, Steam 77.
  const GTA = [
    version("psn:PS5", "psn", 78),
    version("psn:PS4", "psn", 77),
    version("psn:PS3", "psn", 59),
    version("xbox:1", "xbox", 49),
    version("steam", "steam", 77),
  ];

  it("shows each family's largest version, never the lists added up", () => {
    expect(familyTotals(GTA)).toEqual([
      { family: "PlayStation", total: 78 },
      { family: "Steam", total: 77 },
      { family: "Xbox", total: 49 },
    ]);
    // As the approved mockup: no "lendária" suffix (it counted regional copies).
    const steamMain = { platform: "steam" as const, total: 77 };
    expect(achievementsFact(GTA, steamMain, [])).toEqual({ value: 78, note: "na PlayStation · 77 na Steam · 49 no Xbox" });
  });

  it("without versions, the catalog's per-platform numbers as before", () => {
    const main = { platform: "steam" as const, total: 40 };
    expect(achievementsFact([], main, [main, { platform: "xbox", total: 12 }])).toEqual({ value: 40, note: "na Steam · 12 no Xbox" });
  });
});

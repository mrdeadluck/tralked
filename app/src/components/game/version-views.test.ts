import { describe, expect, it } from "vitest";
import type { GameVersion } from "@/lib/queries/game-versions";
import type { PlayerVersion } from "@/lib/queries/game-versions";
import { achievementsFact, familyTotals, introDisc, shortLabel, versionsSummary, versionTabs } from "./version-views";

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

const trophy = (apiName: string) => ({
  apiName,
  name: apiName,
  description: null,
  iconUrl: null,
  tier: "bronze" as const,
  globalPct: 50,
  hidden: false,
});

describe("versionTabs", () => {
  it("builds no tab for a version without rows (a Steam count with nothing imported)", () => {
    const empty = version("steam", "steam", 77);
    const psn = { ...version("psn:PS5", "psn", 2), trophies: [trophy("0"), trophy("1")] };
    expect(versionTabs([empty]).length).toBe(0);
    expect(versionTabs([psn, empty]).map((t) => t.key)).toEqual(["psn:PS5"]);
  });

  it("badge, meta and count agree with the rows it lists when Steam is partial", () => {
    const partial = { ...version("steam", "steam", 77), trophies: [trophy("a"), trophy("b"), trophy("c")] };
    const [tab] = versionTabs([partial]);
    expect(tab.badge).toBe("3");
    expect(tab.meta.strong).toBe("3 conquistas");
    expect(tab.count).toBe(3);
  });
});

describe("shortLabel", () => {
  it("an Xbox PC title reads Xbox PC, One/Series Xbox and the 360 stays 360", () => {
    expect(shortLabel({ platform: "xbox", label: "Xbox PC" })).toBe("Xbox PC");
    expect(shortLabel({ platform: "xbox", label: "Xbox One/Series" })).toBe("Xbox");
    expect(shortLabel({ platform: "xbox", label: "Xbox 360" })).toBe("360");
    expect(versionTabs([{ ...version("xbox:PC", "xbox", 1), label: "Xbox PC", trophies: [trophy("0")] }])[0].label).toBe("Xbox PC");
  });
});

describe("introDisc", () => {
  const mine = (key: string, platform: PlayerVersion["platform"], unlocked: number, total: number, platinum = false): PlayerVersion =>
    ({ key, label: key, platform, unlocked, total, pct: Math.round((unlocked / total) * 100), platinum }) as PlayerVersion;

  it("uses the best version, never the platform's sum (PSN lists are not added up)", () => {
    // PS5 22/78 and PS4 30/77 sum to 52 on PlayStation; the disc shows one version.
    expect(introDisc([mine("psn:PS5", "psn", 22, 78), mine("psn:PS4", "psn", 30, 77)])).toEqual({ plat: false, discLabel: "TRALKED · DISCO 1" });
    expect(introDisc([mine("psn:PS5", "psn", 22, 78), mine("psn:PS4", "psn", 77, 77, true)])).toEqual({
      plat: true,
      discLabel: "TRALKED! · 77/77",
    });
  });

  it("is the plain disc for a visitor or a player without versions", () => {
    expect(introDisc(null)).toEqual({ plat: false, discLabel: "TRALKED · DISCO 1" });
    expect(introDisc([])).toEqual({ plat: false, discLabel: "TRALKED · DISCO 1" });
  });
});

describe("versionsSummary (the booklet's Suas versões)", () => {
  const mine = (over: Partial<PlayerVersion>) => ({ platinums: 0, tralked: 0, ...over }) as PlayerVersion;
  it("says platinas (PSN platinum trophies) and Tralked (100% anywhere), as the profile", () => {
    // PS5 platinated in two regions, one of them at 100%; Steam at 100%.
    expect(versionsSummary([mine({ platinums: 2, tralked: 1 }), mine({ tralked: 1 })])).toBe("2 versões · 2 platinas · 2 Tralked");
    // A Steam 100% alone is never a "platina".
    expect(versionsSummary([mine({ tralked: 1 })])).toBe("1 versão · 1 Tralked");
    expect(versionsSummary([mine({ platinums: 1 }), mine({})])).toBe("2 versões · 1 platina");
  });
});

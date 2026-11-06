import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameVersion } from "@/lib/queries/game-versions";

const getGameVersionCached = vi.fn();
vi.mock("@/lib/queries/game-profile", async (original) => ({
  ...(await original<typeof import("@/lib/queries/game-profile")>()),
  getGameVersionCached,
}));

const trophies = Array.from({ length: 15 }, (_, i) => ({
  apiName: String(i),
  name: `T${i}`,
  description: null,
  iconUrl: null,
  tier: "bronze" as const,
  globalPct: 50,
  hidden: i === 14,
}));
const PS4: GameVersion = {
  key: "psn:PS4",
  platform: "psn",
  label: "PS4",
  total: 15,
  tiers: { platinum: 0, gold: 0, silver: 0, bronze: 15 },
  nativePlatinum: false,
  lists: [],
  trophies,
};

beforeEach(() => getGameVersionCached.mockReset());

describe("moreVersionTrophies", () => {
  it("returns the version's whole public list from its own cached read, hidden ones masked", async () => {
    getGameVersionCached.mockResolvedValue(PS4);
    const { moreVersionTrophies } = await import("./trophy-actions");
    const rows = await moreVersionTrophies("gta", "psn:PS4");
    expect(getGameVersionCached).toHaveBeenCalledWith("gta", "psn:PS4");
    expect(rows!.map((r) => r.apiName)).toEqual(trophies.map((t) => t.apiName));
    expect(rows![14].name).toBeNull();
  });

  it("refuses bad input and answers null for an unknown game or version", async () => {
    const { moreVersionTrophies } = await import("./trophy-actions");
    expect(await moreVersionTrophies(42, "psn:PS4")).toBeNull();
    expect(await moreVersionTrophies("gta", "x".repeat(500))).toBeNull();
    expect(getGameVersionCached).not.toHaveBeenCalled();
    getGameVersionCached.mockResolvedValue(null);
    expect(await moreVersionTrophies("nope", "psn:PS4")).toBeNull();
  });
});

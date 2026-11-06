import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameVersion } from "@/lib/queries/game-versions";

const getGameVersionCached = vi.fn();
const getGameVersionKeysCached = vi.fn();
vi.mock("@/lib/queries/game-profile", async (original) => ({
  ...(await original<typeof import("@/lib/queries/game-profile")>()),
  getGameVersionCached,
  getGameVersionKeysCached,
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

beforeEach(() => {
  getGameVersionCached.mockReset();
  getGameVersionKeysCached.mockReset().mockResolvedValue(["psn:PS4"]);
});

describe("moreVersionTrophies", () => {
  it("returns the version's whole public list from its own cached read, hidden ones masked", async () => {
    getGameVersionCached.mockResolvedValue(PS4);
    const { moreVersionTrophies } = await import("./trophy-actions");
    const rows = await moreVersionTrophies("gta", "psn:PS4");
    expect(getGameVersionCached).toHaveBeenCalledWith("gta", "psn:PS4");
    expect(rows!.map((r) => r.apiName)).toEqual(trophies.map((t) => t.apiName));
    expect(rows![14].name).toBeNull();
  });

  it("reads only real version keys of the game: a made-up key never reaches the narrow read", async () => {
    getGameVersionKeysCached.mockResolvedValue(["steam", "psn:PS4", "psn:PS3+PSVITA", "psn:NPWR01234_00", "xbox:1717113201", "retro:1"]);
    getGameVersionCached.mockResolvedValue(PS4);
    const { moreVersionTrophies } = await import("./trophy-actions");
    // Not a version key's shape: refused before any read.
    for (const bad of ["random", "psn:", "psn:ps4", "xbox:1 2", "steam:1", "retro:../x", "psn:PS4\n"]) {
      expect(await moreVersionTrophies("gta", bad)).toBeNull();
    }
    expect(getGameVersionKeysCached).not.toHaveBeenCalled();
    // Well-formed but not one of the game's versions.
    expect(await moreVersionTrophies("gta", "psn:PS5")).toBeNull();
    expect(await moreVersionTrophies("gta", "xbox:999")).toBeNull();
    expect(getGameVersionCached).not.toHaveBeenCalled();
    for (const key of ["steam", "psn:PS3+PSVITA", "psn:NPWR01234_00", "xbox:1717113201", "retro:1"]) {
      expect(await moreVersionTrophies("gta", key)).not.toBeNull();
    }
    expect(getGameVersionCached).toHaveBeenCalledTimes(5);
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

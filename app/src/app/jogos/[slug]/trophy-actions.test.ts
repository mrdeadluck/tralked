import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameVersion } from "@/lib/queries/game-versions";

const getGameProfile = vi.fn();
vi.mock("@/lib/queries/game-profile", async (original) => ({
  ...(await original<typeof import("@/lib/queries/game-profile")>()),
  getGameProfile,
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

beforeEach(() => getGameProfile.mockReset());

describe("moreVersionTrophies", () => {
  it("returns the rows after the first ones, from the cached profile, hidden ones masked", async () => {
    getGameProfile.mockResolvedValue({ versions: [PS4] });
    const { moreVersionTrophies } = await import("./trophy-actions");
    const rows = await moreVersionTrophies("gta", "psn:PS4");
    expect(getGameProfile).toHaveBeenCalledWith("gta");
    expect(rows!.map((r) => r.apiName)).toEqual(["12", "13", "14"]);
    expect(rows![2].name).toBeNull();
  });

  it("refuses bad input and answers null for an unknown game or version", async () => {
    const { moreVersionTrophies } = await import("./trophy-actions");
    expect(await moreVersionTrophies(42, "psn:PS4")).toBeNull();
    expect(await moreVersionTrophies("gta", "x".repeat(500))).toBeNull();
    expect(getGameProfile).not.toHaveBeenCalled();
    getGameProfile.mockResolvedValue(null);
    expect(await moreVersionTrophies("nope", "psn:PS4")).toBeNull();
    getGameProfile.mockResolvedValue({ versions: [PS4] });
    expect(await moreVersionTrophies("gta", "psn:PS9")).toBeNull();
  });
});

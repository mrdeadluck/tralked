import { describe, expect, it } from "vitest";
import { buildGameVersions, buildPlayerVersions, versionRank, type AchRow, type ListRow } from "./game-versions";

const at = (m: number) => new Date(Date.UTC(2026, 10, 5, 0, m));
const list = (id: string, platform: string, console: string | null, m: number, over: Partial<ListRow> = {}): ListRow => ({
  id,
  platform,
  console,
  externalId: id,
  region: null,
  createdAt: at(m),
  trophyCount: 2,
  ...over,
});
const ach = (id: string, listId: string | null, platform: string, apiName: string, trophyTier: string | null = "bronze"): AchRow => ({
  id,
  listId,
  platform,
  apiName,
  name: `T${apiName}`,
  description: null,
  iconUrl: null,
  globalPct: 50,
  hidden: false,
  trophyTier,
});

describe("versionRank", () => {
  it("orders Steam, PS5, PS4, PS3, Vita, then Xbox and RA", () => {
    const keys = ["retro:1", "xbox:1", "psn:PS3+PSVITA", "psn:PSVITA", "psn:PS3", "psn:PS4", "psn:PS5", "steam"];
    const platforms: Record<string, string> = { "retro:1": "retro", "xbox:1": "xbox", steam: "steam" };
    const rank = (key: string) => versionRank({ key, platform: platforms[key] ?? "psn" });
    expect([...keys].sort((a, b) => rank(a) - rank(b))).toEqual([
      "steam",
      "psn:PS5",
      "psn:PS4",
      "psn:PS3",
      "psn:PS3+PSVITA",
      "psn:PSVITA",
      "xbox:1",
      "retro:1",
    ]);
  });
});

describe("buildGameVersions", () => {
  it("skips a version with no trophies and uses the oldest list's trophies", () => {
    const lists = [list("a", "psn", "PS4", 1), list("b", "psn", "PS4", 2), list("empty", "psn", "PS3", 3)];
    const rows = [ach("a1", "a", "psn", "0", "platinum"), ach("a2", "a", "psn", "1"), ach("b1", "b", "psn", "0", "platinum")];
    const v = buildGameVersions(lists, rows, 0);
    expect(v.map((x) => x.key)).toEqual(["psn:PS4"]);
    expect(v[0].trophies.map((t) => t.apiName)).toEqual(["0", "1"]);
    expect(v[0].nativePlatinum).toBe(true);
    expect(v[0].tiers.platinum).toBe(1);
  });
});

describe("buildPlayerVersions", () => {
  it("picks the best list and labels where each trophy was earned", () => {
    const lists = [list("a", "psn", "PS4", 1), list("b", "psn", "PS4", 2, { region: "jp" })];
    const rows = [ach("a1", "a", "psn", "0"), ach("a2", "a", "psn", "1"), ach("b1", "b", "psn", "0"), ach("b2", "b", "psn", "1")];
    const [v] = buildPlayerVersions({
      lists,
      achievements: rows,
      steamCount: 0,
      unlocks: [
        { achievementId: "a1", unlockedAt: at(10) },
        { achievementId: "b1", unlockedAt: at(5) },
        { achievementId: "b2", unlockedAt: at(6) },
      ],
      userLists: [
        { listId: "a", unlockedCount: 1, completedAt: null },
        { listId: "b", unlockedCount: 2, completedAt: at(6) },
      ],
      steamGame: null,
    });
    expect(v.unlocked).toBe(2);
    expect(v.pct).toBe(100);
    expect(v.bestListId).toBe("b");
    expect(v.earnedIn["0"]).toEqual(["Lista 1", "🇯🇵 Ásia"]);
    expect(v.earnedIn["1"]).toEqual(["🇯🇵 Ásia"]);
    expect(v.unlockedAt["0"]).toEqual(at(5));
    expect(v.lists.map((l) => [l.label, l.complete])).toEqual([
      ["Lista 1", false],
      ["🇯🇵 Ásia", true],
    ]);
  });
});

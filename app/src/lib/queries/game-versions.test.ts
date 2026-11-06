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
const ach = (id: string, listId: string, platform: string, apiName: string, trophyTier: string | null = "bronze"): AchRow => ({
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
  it("orders PS5, PS4, PS3, Vita, then Xbox, Steam and RA", () => {
    const keys = ["retro:1", "xbox:1", "psn:PS3+PSVITA", "psn:PSVITA", "psn:PS3", "psn:PS4", "psn:PS5", "steam"];
    const platforms: Record<string, string> = { "retro:1": "retro", "xbox:1": "xbox", steam: "steam" };
    const rank = (key: string) => versionRank({ key, platform: platforms[key] ?? "psn" });
    expect([...keys].sort((a, b) => rank(a) - rank(b))).toEqual([
      "psn:PS5",
      "psn:PS4",
      "psn:PS3",
      "psn:PS3+PSVITA",
      "psn:PSVITA",
      "xbox:1",
      "steam",
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

  it("lists Steam achievements commonest first", () => {
    const rows = [
      { ...ach("r", "st", "steam", "RARE", null), globalPct: 2 },
      { ...ach("u", "st", "steam", "UNKNOWN", null), globalPct: null },
      { ...ach("c", "st", "steam", "COMMON", null), globalPct: 80 },
    ];
    expect(buildGameVersions([], rows, 3)[0].trophies.map((t) => t.apiName)).toEqual(["COMMON", "RARE", "UNKNOWN"]);
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
    expect(v.label).toBe("PS4");
    expect(v.earnedAt["0"]).toEqual([
      { label: "🇯🇵 Ásia", at: at(5) },
      { label: "Lista 1", at: at(10) },
    ]);
  });

  it("Steam: UserGame progress over achievementCount; no progress -> omitted", () => {
    const rows = [ach("s1", "st", "steam", "A", null), ach("s2", "st", "steam", "B", null)];
    const base = { lists: [], achievements: rows, steamCount: 4, userLists: [] };
    expect(buildPlayerVersions({ ...base, unlocks: [], steamGame: null })).toEqual([]);

    const [v] = buildPlayerVersions({
      ...base,
      unlocks: [{ achievementId: "s1", unlockedAt: at(1) }],
      steamGame: { unlockedCount: 3, completedAt: null },
    });
    expect([v.key, v.label, v.platform]).toEqual(["steam", "PC · Steam", "steam"]);
    expect([v.unlocked, v.total, v.pct, v.platinum]).toEqual([3, 4, 75, false]);
    expect(v.lists).toEqual([]);
    expect(v.unlockedAt).toEqual({ A: at(1) });

    const [done] = buildPlayerVersions({ ...base, unlocks: [], steamGame: { unlockedCount: 4, completedAt: at(2) } });
    expect([done.pct, done.platinum, done.tiersEarned.platinum]).toEqual([100, true, 1]);
  });

  it("without a native platinum, any complete list is the platinum", () => {
    const lists = [list("x1", "xbox", "ONE", 1), list("x2", "retro", "SNES", 2)];
    const rows = [ach("a", "x1", "xbox", "1", null), ach("b", "x2", "retro", "1", null)];
    const [xbox, retro] = buildPlayerVersions({
      lists,
      achievements: rows,
      steamCount: 0,
      unlocks: [{ achievementId: "a", unlockedAt: at(1) }],
      userLists: [
        { listId: "x1", unlockedCount: 1, completedAt: at(1) },
        { listId: "x2", unlockedCount: 0, completedAt: null },
      ],
      steamGame: null,
    });
    expect([xbox.key, xbox.platinum, xbox.nativePlatinum, xbox.tiersEarned.platinum]).toEqual(["xbox:x1", true, false, 1]);
    expect([retro.key, retro.platinum]).toEqual(["retro:x2", false]);
  });

  it("platinum when any list has the platinum trophy, though the best list is another", () => {
    const lists = [list("a", "psn", "PS5", 1), list("b", "psn", "PS5", 2, { region: "jp", trophyCount: 3 })];
    const rows = [
      ach("a0", "a", "psn", "0", "platinum"),
      ach("a1", "a", "psn", "1"),
      ach("b0", "b", "psn", "0", "platinum"),
      ach("b1", "b", "psn", "1"),
      ach("b2", "b", "psn", "2"),
    ];
    const [v] = buildPlayerVersions({
      lists,
      achievements: rows,
      steamCount: 0,
      unlocks: [
        { achievementId: "b0", unlockedAt: at(1) },
        { achievementId: "a1", unlockedAt: at(2) },
      ],
      // "a" (1/2, 50%) beats "b" (1/3), but only "b" has the platinum.
      userLists: [
        { listId: "a", unlockedCount: 1, completedAt: null },
        { listId: "b", unlockedCount: 1, completedAt: null },
      ],
      steamGame: null,
    });
    expect(v.bestListId).toBe("a");
    expect(v.platinum).toBe(true);
    // The grid agrees with the disc: the best list lacks it, the version has it.
    expect(v.tiersEarned.platinum).toBe(1);
  });

  it("xp maps the paid ledger entries to the trophy's apiName", () => {
    const lists = [list("a", "psn", "PS4", 1), list("b", "psn", "PS4", 2, { region: "jp" })];
    const rows = [ach("a1", "a", "psn", "0"), ach("b1", "b", "psn", "0"), ach("a2", "a", "psn", "1")];
    const [v] = buildPlayerVersions({
      lists,
      achievements: rows,
      steamCount: 0,
      unlocks: [{ achievementId: "b1", unlockedAt: at(1) }],
      userLists: [{ listId: "b", unlockedCount: 1, completedAt: null }],
      steamGame: null,
      ledger: [{ sourceKey: "a1", xp: 2500 }],
    });
    expect(v.xp).toEqual({ "0": 2500 });
  });
  it("leaves out the catalog lists the player does not hold: no empty chip, the note counts held lists", () => {
    const lists = [
      list("a", "psn", "PS4", 1),
      list("b", "psn", "PS4", 2, { region: "jp" }),
      list("c", "psn", "PS4", 3, { region: "eu" }),
    ];
    const rows = ["a", "b", "c"].flatMap((l) => [ach(`${l}0`, l, "psn", "0"), ach(`${l}1`, l, "psn", "1")]);
    const base = { lists, achievements: rows, steamCount: 0, steamGame: null };
    // Holds only "a": one list, no note.
    const [one] = buildPlayerVersions({
      ...base,
      unlocks: [{ achievementId: "a0", unlockedAt: at(1) }],
      userLists: [{ listId: "a", unlockedCount: 1, completedAt: null }],
    });
    expect(one.lists.map((l) => l.id)).toEqual(["a"]);
    expect(one.countedNote).toBeNull();
    // Holds "a" and "c" ("c" by an unlock only): two lists counted, "b" left out.
    const [two] = buildPlayerVersions({
      ...base,
      unlocks: [
        { achievementId: "a0", unlockedAt: at(1) },
        { achievementId: "c1", unlockedAt: at(2) },
      ],
      userLists: [{ listId: "a", unlockedCount: 1, completedAt: null }],
    });
    expect(two.lists.map((l) => l.id)).toEqual(["a", "c"]);
    expect(two.countedNote).toBe("2 listas · cada uma conta");
  });

  it("suspicious unlocks count for nothing, as in the counters", () => {
    const lists = [list("a", "psn", "PS5", 1), list("b", "psn", "PS5", 2, { region: "jp" })];
    const rows = [ach("a0", "a", "psn", "0", "platinum"), ach("a1", "a", "psn", "1"), ach("b0", "b", "psn", "0", "platinum"), ach("b1", "b", "psn", "1")];
    const [v] = buildPlayerVersions({
      lists,
      achievements: rows,
      steamCount: 0,
      unlocks: [
        { achievementId: "a0", unlockedAt: at(1), suspicious: true },
        { achievementId: "a1", unlockedAt: at(2) },
        { achievementId: "b0", unlockedAt: at(3), suspicious: true },
        { achievementId: "b1", unlockedAt: at(4) },
      ],
      // "a" was stored complete before its platinum was flagged.
      userLists: [
        { listId: "a", unlockedCount: 2, completedAt: at(2) },
        { listId: "b", unlockedCount: 2, completedAt: null },
      ],
      steamGame: null,
    });
    expect(v.platinum).toBe(false);
    expect(v.platinums).toBe(0);
    expect(v.tralked).toBe(0);
    expect(v.unlocked).toBe(1);
    expect(v.lists.map((l) => [l.id, l.complete, l.unlocked])).toEqual([
      ["a", false, 1],
      ["b", false, 1],
    ]);
    expect(Object.keys(v.unlockedAt)).toEqual(["1"]);
    expect(v.tiersEarned.platinum).toBe(0);

    // Steam: a suspicious unlock taints the 100%.
    const steamRows = [ach("s1", "st", "steam", "A", null), ach("s2", "st", "steam", "B", null)];
    const [steam] = buildPlayerVersions({
      lists: [],
      achievements: steamRows,
      steamCount: 2,
      unlocks: [
        { achievementId: "s1", unlockedAt: at(1) },
        { achievementId: "s2", unlockedAt: at(2), suspicious: true },
      ],
      userLists: [],
      steamGame: { unlockedCount: 2, completedAt: at(2) },
    });
    expect([steam.unlocked, steam.platinum, steam.tralked]).toEqual([1, false, 0]);
  });

  it("an Xbox list at the base game's 1000G is complete, DLC missing", () => {
    const lists = [list("x", "xbox", "ONE", 1, { trophyCount: 3 })];
    const rows = [
      { ...ach("x1", "x", "xbox", "1", null), points: 600 },
      { ...ach("x2", "x", "xbox", "2", null), points: 400 },
      { ...ach("x3", "x", "xbox", "3", null), points: 50 },
    ];
    const [v] = buildPlayerVersions({
      lists,
      achievements: rows,
      steamCount: 0,
      unlocks: [
        { achievementId: "x1", unlockedAt: at(1) },
        { achievementId: "x2", unlockedAt: at(2) },
      ],
      userLists: [{ listId: "x", unlockedCount: 2, completedAt: null }],
      steamGame: null,
    });
    expect(v.pct).toBe(67);
    expect(v.lists).toEqual([{ id: "x", label: null, complete: true, unlocked: 2 }]);
    expect([v.platinum, v.tralked, v.platinums]).toEqual([true, 1, 0]);
  });

  it("platinums count the PSN platinum trophies per list; tralked the lists at 100% on any platform", () => {
    const lists = [list("a", "psn", "PS5", 1), list("b", "psn", "PS5", 2, { region: "jp" })];
    const rows = [ach("a0", "a", "psn", "0", "platinum"), ach("a1", "a", "psn", "1"), ach("b0", "b", "psn", "0", "platinum"), ach("b1", "b", "psn", "1")];
    const [psn] = buildPlayerVersions({
      lists,
      achievements: rows,
      steamCount: 0,
      unlocks: ["a0", "a1", "b0"].map((id, i) => ({ achievementId: id, unlockedAt: at(i) })),
      userLists: [
        { listId: "a", unlockedCount: 2, completedAt: at(1) },
        { listId: "b", unlockedCount: 1, completedAt: null },
      ],
      steamGame: null,
    });
    expect([psn.platinums, psn.tralked]).toEqual([2, 1]);
    const [steam] = buildPlayerVersions({
      lists: [],
      achievements: [ach("s1", "st", "steam", "A", null)],
      steamCount: 1,
      unlocks: [{ achievementId: "s1", unlockedAt: at(1) }],
      userLists: [],
      steamGame: { unlockedCount: 1, completedAt: at(1) },
    });
    expect([steam.platinums, steam.tralked]).toEqual([0, 1]);
  });
});

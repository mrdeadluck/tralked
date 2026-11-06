import { describe, expect, it } from "vitest";
import { xpForPlatformAchievement } from "@/lib/engine/trophies";
import { platinumBonus } from "@/lib/engine/xp";
import {
  desiredListEntries,
  platinumGameId,
  platinumSourceKey,
  type AchievementRow,
  type ListRow,
  type ProgressRow,
  type UnlockRow,
} from "./list-xp";

const G = "game1";
const at = (day: number, hour = 0) => new Date(Date.UTC(2026, 0, day, hour));

const list = (id: string, console: string | null, created: number, externalId = id): ListRow => ({
  id,
  externalId,
  console,
  createdAt: at(created),
});

/** Achievements `${listId}-${apiName}` with tier-only XP (PSN) or gamerscore (Xbox). */
function achievementsOf(listId: string, apiNames: string[], over: Partial<AchievementRow> = {}): AchievementRow[] {
  return apiNames.map((apiName) => ({
    id: `${listId}-${apiName}`,
    listId,
    apiName,
    globalPct: null,
    points: null,
    trophyTier: apiName === "0" ? "platinum" : "bronze",
    ...over,
  }));
}

const unlock = (achievementId: string, unlockedAt: Date, over: Partial<UnlockRow> = {}): UnlockRow => ({
  achievementId,
  unlockedAt,
  suspicious: false,
  hardcore: false,
  ...over,
});

const psnXp = (a: AchievementRow) =>
  xpForPlatformAchievement({
    platform: "psn",
    globalPct: a.globalPct,
    points: a.points,
    trophyTier: a.trophyTier as "bronze",
    hardcore: false,
  });

function desired(input: {
  platform?: "psn" | "xbox" | "retro";
  lists: ListRow[];
  achievements: AchievementRow[];
  unlocks: UnlockRow[];
  progress?: ProgressRow[];
}) {
  return desiredListEntries({
    platform: input.platform ?? "psn",
    gameId: G,
    skills: ["rpg"],
    progress: [],
    ...input,
  });
}

const keys = (drafts: { source: string; sourceKey: string }[]) => drafts.map((d) => `${d.source}:${d.sourceKey}`).sort();

describe("platinumSourceKey / platinumGameId", () => {
  it("builds the keys of the version rule", () => {
    expect(platinumSourceKey("steam", G)).toBe(G);
    expect(platinumSourceKey("psn", G, { console: "PS5", externalId: "NPWR1_00" })).toBe(`psn:PS5:${G}`);
    expect(platinumSourceKey("psn", G, { console: null, externalId: "NPWR1_00" })).toBe(`psn:NPWR1_00:${G}`);
    expect(platinumSourceKey("xbox", G, { console: "ONE", externalId: "1234" })).toBe(`xbox:1234:${G}`);
    expect(platinumSourceKey("retro", G, { console: "SNES", externalId: "77" })).toBe(`retro:77:${G}`);
  });

  it("reads the game after the last colon", () => {
    expect(platinumGameId(G)).toBe(G);
    expect(platinumGameId(`psn:${G}`)).toBe(G);
    expect(platinumGameId(`psn:PS3+PSVITA:${G}`)).toBe(G);
    expect(platinumGameId(`xbox:1234:${G}`)).toBe(G);
  });
});

describe("desiredListEntries", () => {
  it("PS4 and PS5 platinums are two entries", () => {
    const lists = [list("ps4", "PS4", 1), list("ps5", "PS5", 2)];
    const achievements = [...achievementsOf("ps4", ["0", "1"]), ...achievementsOf("ps5", ["0", "1"])];
    const unlocks = achievements.map((a, i) => unlock(a.id, at(10, i)));
    const out = desired({
      lists,
      achievements,
      unlocks,
      progress: [
        { listId: "ps4", completedAt: at(10, 1) },
        { listId: "ps5", completedAt: at(10, 3) },
      ],
    });
    const platinums = out.filter((d) => d.source === "platinum");
    expect(platinums.map((p) => p.sourceKey).sort()).toEqual([`psn:PS4:${G}`, `psn:PS5:${G}`]);
    expect(platinums.find((p) => p.sourceKey === `psn:PS4:${G}`)).toMatchObject({
      xp: platinumBonus(achievementsOf("ps4", ["0", "1"]).map(psnXp)),
      createdAt: at(10, 1),
      platform: "psn",
      skills: ["rpg"],
    });
    // Different versions: every trophy is paid on each console.
    expect(out.filter((d) => d.source === "achievement")).toHaveLength(4);
  });

  it("two regional PS5 lists, both complete, pay two platinums: the version key covers the canonical list", () => {
    const lists = [list("eu", "PS5", 1, "NPWR2_00"), list("jp", "PS5", 2, "NPWR1_00")];
    const achievements = [...achievementsOf("eu", ["0", "1"]), ...achievementsOf("jp", ["0", "1"], { trophyTier: "silver" })];
    const unlocks = achievements.map((a, i) => unlock(a.id, at(10, i)));
    const out = desired({
      lists,
      achievements,
      unlocks,
      progress: [
        { listId: "jp", completedAt: at(10, 3) },
        { listId: "eu", completedAt: at(10, 1) },
      ],
    });
    const platinums = out.filter((d) => d.source === "platinum");
    expect(platinums.map((p) => p.sourceKey).sort()).toEqual([`psn:NPWR1_00:${G}`, `psn:PS5:${G}`]);
    // `eu` is the canonical (oldest) list: the key paid before every list counted stays its own.
    expect(platinums.find((p) => p.sourceKey === `psn:PS5:${G}`)).toMatchObject({
      createdAt: at(10, 1),
      xp: platinumBonus(achievementsOf("eu", ["0", "1"]).map(psnXp)),
    });
    // The other list's platinum: its own completion, valued over its own trophies.
    expect(platinums.find((p) => p.sourceKey === `psn:NPWR1_00:${G}`)).toMatchObject({
      createdAt: at(10, 3),
      xp: platinumBonus(achievementsOf("jp", ["0", "1"], { trophyTier: "silver" }).map(psnXp)),
    });
    // Every trophy of each list pays.
    expect(keys(out.filter((d) => d.source === "achievement"))).toEqual([
      "achievement:eu-0",
      "achievement:eu-1",
      "achievement:jp-0",
      "achievement:jp-1",
    ]);
  });

  it("the version key goes to the canonical list when complete, else to the earliest complete list", () => {
    const lists = [list("eu", "PS5", 1, "NPWR3_00"), list("jp", "PS5", 2, "NPWR1_00"), list("kr", "PS5", 3, "NPWR2_00")];
    const achievements = ["eu", "jp", "kr"].flatMap((l) => achievementsOf(l, ["0", "1"]));
    const unlocks = achievements.map((a, i) => unlock(a.id, at(10, i)));
    // The canonical list is complete last: it still holds the version key; the others get their own.
    const all = desired({
      lists,
      achievements,
      unlocks,
      progress: [
        { listId: "eu", completedAt: at(12) },
        { listId: "jp", completedAt: at(11) },
        { listId: "kr", completedAt: at(13) },
      ],
    }).filter((d) => d.source === "platinum");
    expect(all.map((d) => [d.sourceKey, d.createdAt])).toEqual([
      [`psn:NPWR1_00:${G}`, at(11)],
      [`psn:NPWR2_00:${G}`, at(13)],
      [`psn:PS5:${G}`, at(12)],
    ]);
    // The canonical list is not complete: the earliest completion holds the version key (the one
    // the rule paid before every list counted), the next one its own.
    const withoutCanonical = desired({
      lists,
      achievements,
      unlocks,
      progress: [
        { listId: "eu", completedAt: null },
        { listId: "jp", completedAt: at(14) },
        { listId: "kr", completedAt: at(13) },
      ],
    }).filter((d) => d.source === "platinum");
    expect(withoutCanonical.map((d) => [d.sourceKey, d.createdAt])).toEqual([
      [`psn:NPWR1_00:${G}`, at(14)],
      [`psn:PS5:${G}`, at(13)],
    ]);
  });

  it("a trophy earned in both regions is paid once per list, each with its own unlock", () => {
    // `eu` is older: canonical. The JP unlock came first and is worth more (silver).
    const lists = [list("eu", "PS5", 1), list("jp", "PS5", 2)];
    const achievements = [...achievementsOf("eu", ["1"]), ...achievementsOf("jp", ["1"], { trophyTier: "silver" })];
    const out = desired({
      lists,
      achievements,
      unlocks: [unlock("eu-1", at(12)), unlock("jp-1", at(11))],
    });
    expect(out).toEqual([
      { source: "achievement", sourceKey: "eu-1", xp: psnXp(achievements[0]), platform: "psn", createdAt: at(12), skills: ["rpg"] },
      { source: "achievement", sourceKey: "jp-1", xp: psnXp(achievements[1]), platform: "psn", createdAt: at(11), skills: ["rpg"] },
    ]);
  });

  it("a trophy earned only outside the canonical list keeps the canonical key for its earliest unlock", () => {
    // The key the rule paid before every list counted (the canonical row's id) still pays the
    // earliest copy; a further copy pays under its own id.
    const lists = [list("eu", "PS5", 1), list("jp", "PS5", 2), list("kr", "PS5", 3)];
    const achievements = [...achievementsOf("eu", ["1"]), ...achievementsOf("jp", ["1", "9"]), ...achievementsOf("kr", ["1"])];
    const out = desired({
      lists,
      achievements,
      unlocks: [unlock("jp-1", at(11)), unlock("jp-9", at(12)), unlock("kr-1", at(10))],
    });
    // jp-9 has no counterpart in the canonical list: its own id.
    expect(keys(out)).toEqual(["achievement:eu-1", "achievement:jp-1", "achievement:jp-9"]);
    expect(out.find((d) => d.sourceKey === "eu-1")?.createdAt).toEqual(at(10));
    expect(out.find((d) => d.sourceKey === "jp-1")?.createdAt).toEqual(at(11));
  });

  it("suspicious unlocks are not desired", () => {
    const lists = [list("eu", "PS5", 1), list("jp", "PS5", 2)];
    const achievements = [...achievementsOf("eu", ["0", "1"]), ...achievementsOf("jp", ["1"])];
    const out = desired({
      lists,
      achievements,
      unlocks: [
        unlock("eu-0", at(10), { suspicious: true }),
        unlock("eu-1", at(10), { suspicious: true }),
        unlock("jp-1", at(12)),
      ],
      // A completion stored with a suspicious unlock in the list pays no platinum.
      progress: [{ listId: "eu", completedAt: at(10) }],
    });
    // The clean JP unlock still pays the trophy, from its own date (under the canonical key: the
    // canonical copy is not a valid unlock).
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: "achievement", sourceKey: "eu-1", createdAt: at(12) });
  });

  it("xbox platinum key carries the titleId", () => {
    const lists = [list("x360", "360", 1, "1111"), list("xone", "ONE", 2, "2222")];
    const achievements = [
      ...achievementsOf("x360", ["1"], { trophyTier: null, points: 50 }),
      ...achievementsOf("xone", ["1"], { trophyTier: null, points: 50 }),
    ];
    const out = desired({
      platform: "xbox",
      lists,
      achievements,
      unlocks: [unlock("x360-1", at(10)), unlock("xone-1", at(11))],
      progress: [
        { listId: "x360", completedAt: at(10) },
        { listId: "xone", completedAt: at(11) },
      ],
    });
    // Xbox keys achievements by their own id (every title is its own version).
    expect(keys(out)).toEqual([
      "achievement:x360-1",
      "achievement:xone-1",
      `platinum:xbox:1111:${G}`,
      `platinum:xbox:2222:${G}`,
    ]);
  });

  it("a game none of whose lists the user holds keeps its own-id achievement keys and pays no platinum", () => {
    const lists = [list("ps5", "PS5", 1)];
    const achievements = achievementsOf("ps5", ["0", "1"]);
    const unlocks = achievements.map((a, i) => unlock(a.id, at(10, i)));
    // The legacy platinum key (before trophy lists) is never paid again: the platinum waits for the list.
    expect(keys(desired({ lists, achievements, unlocks }))).toEqual(["achievement:ps5-0", "achievement:ps5-1"]);
  });

  it("once the user holds a list of the game, the legacy platinum is not desired", () => {
    const lists = [list("ps5", "PS5", 1)];
    const achievements = achievementsOf("ps5", ["0", "1"]);
    const unlocks = achievements.map((a, i) => unlock(a.id, at(10, i)));
    const out = desired({
      lists,
      achievements,
      unlocks,
      progress: [{ listId: "ps5", completedAt: at(10, 3) }],
    });
    expect(keys(out)).toEqual(["achievement:ps5-0", "achievement:ps5-1", `platinum:psn:PS5:${G}`]);
  });
});

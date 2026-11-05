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
function achievementsOf(listId: string | null, apiNames: string[], over: Partial<AchievementRow> = {}): AchievementRow[] {
  return apiNames.map((apiName) => ({
    id: `${listId ?? "nolist"}-${apiName}`,
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
  legacyCompletedAt?: Date | null;
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

  it("two regional PS5 lists pay the platinum once", () => {
    const lists = [list("eu", "PS5", 1, "NPWR2_00"), list("jp", "PS5", 2, "NPWR1_00")];
    const achievements = [...achievementsOf("eu", ["0", "1"]), ...achievementsOf("jp", ["0", "1"])];
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
    expect(platinums).toHaveLength(1);
    // The earliest completion of the version, valued over that list.
    expect(platinums[0]).toMatchObject({ sourceKey: `psn:PS5:${G}`, createdAt: at(10, 1) });
  });

  it("a trophy earned in both regions is paid once, at the earliest unlock, keyed to the canonical achievement", () => {
    // `eu` is older: canonical. The JP unlock came first and is worth more (silver).
    const lists = [list("eu", "PS5", 1), list("jp", "PS5", 2)];
    const achievements = [...achievementsOf("eu", ["1"]), ...achievementsOf("jp", ["1"], { trophyTier: "silver" })];
    const out = desired({
      lists,
      achievements,
      unlocks: [unlock("eu-1", at(12)), unlock("jp-1", at(11))],
    });
    expect(out).toEqual([
      {
        source: "achievement",
        sourceKey: "eu-1",
        xp: psnXp(achievements[1]),
        platform: "psn",
        createdAt: at(11),
        skills: ["rpg"],
      },
    ]);
  });

  it("a trophy earned only in the second region is paid once, keyed to the canonical achievement", () => {
    const lists = [list("eu", "PS5", 1), list("jp", "PS5", 2)];
    const achievements = [...achievementsOf("eu", ["1"]), ...achievementsOf("jp", ["1", "9"])];
    const out = desired({ lists, achievements, unlocks: [unlock("jp-1", at(11)), unlock("jp-9", at(12))] });
    // jp-9 has no counterpart in the canonical list: its own id.
    expect(keys(out)).toEqual(["achievement:eu-1", "achievement:jp-9"]);
    expect(out.find((d) => d.sourceKey === "eu-1")?.createdAt).toEqual(at(11));
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
    // The clean JP unlock still pays the trophy, from its own date.
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

  it("a game with no list keeps its own-id achievement keys and the legacy platinum while completed", () => {
    const achievements = achievementsOf(null, ["0", "1"]);
    const unlocks = achievements.map((a, i) => unlock(a.id, at(10, i)));
    const out = desired({ lists: [], achievements, unlocks, legacyCompletedAt: at(10, 1) });
    expect(keys(out)).toEqual(["achievement:nolist-0", "achievement:nolist-1", `platinum:psn:${G}`]);
    expect(out.find((d) => d.source === "platinum")).toMatchObject({
      xp: platinumBonus(achievements.map(psnXp)),
      createdAt: at(10, 1),
    });
    // Not completed (or the completion was cleared): no platinum.
    expect(keys(desired({ lists: [], achievements, unlocks }))).toEqual(["achievement:nolist-0", "achievement:nolist-1"]);
  });

  it("a game with no list pays no legacy platinum while one of its unlocks is suspicious", () => {
    const achievements = achievementsOf(null, ["0", "1"]);
    const out = desired({
      lists: [],
      achievements,
      unlocks: [unlock("nolist-0", at(10)), unlock("nolist-1", at(10, 1), { suspicious: true })],
      legacyCompletedAt: at(10, 1),
    });
    expect(keys(out)).toEqual(["achievement:nolist-0"]);
  });

  it("once the game has a list, unlocks on list-less rows and the legacy platinum are not desired", () => {
    const lists = [list("ps5", "PS5", 1)];
    const achievements = [...achievementsOf(null, ["0", "1"]), ...achievementsOf("ps5", ["0", "1"])];
    const unlocks = achievements.map((a, i) => unlock(a.id, at(10, i)));
    const out = desired({
      lists,
      achievements,
      unlocks,
      progress: [{ listId: "ps5", completedAt: at(10, 3) }],
      legacyCompletedAt: at(10, 1),
    });
    expect(keys(out)).toEqual(["achievement:ps5-0", "achievement:ps5-1", `platinum:psn:PS5:${G}`]);
  });
});

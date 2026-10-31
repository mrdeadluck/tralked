import { describe, expect, it } from "vitest";
import {
  DAILY_TEMPLATES,
  WEEKLY_TEMPLATES,
  generateMissions,
  missionProgress,
  type UnlockEvent,
} from "./missions";

function ev(partial: Partial<UnlockEvent> & { achievementId: string }): UnlockEvent {
  return {
    gameId: "g1",
    globalPct: 10,
    skills: ["soulslike"],
    unlockedAt: new Date("2026-10-31T12:00:00Z"),
    suspicious: false,
    ...partial,
  };
}

describe("missionProgress", () => {
  it("counts rare unlocks and ignores suspicious ones", () => {
    const events = [
      ev({ achievementId: "a", globalPct: 5 }),
      ev({ achievementId: "b", globalPct: 20 }),
      ev({ achievementId: "c", globalPct: 1 }),
      ev({ achievementId: "d", globalPct: 1, suspicious: true }),
      ev({ achievementId: "e", globalPct: 60 }),
      ev({ achievementId: "f", globalPct: null }),
    ];
    expect(missionProgress({ minCount: 3, maxGlobalPct: 20 }, events)).toEqual({
      count: 3,
      done: true,
    });
  });

  it("is not done below minCount", () => {
    const events = [ev({ achievementId: "a" })];
    expect(missionProgress({ minCount: 3 }, events)).toEqual({
      count: 1,
      done: false,
    });
  });

  it("filters by skill", () => {
    const events = [
      ev({ achievementId: "a", skills: ["soulslike", "rpg"] }),
      ev({ achievementId: "b", skills: ["fps"] }),
    ];
    expect(missionProgress({ minCount: 1, skill: "fps" }, events)).toEqual({
      count: 1,
      done: true,
    });
    expect(missionProgress({ minCount: 2, skill: "rpg" }, events)).toEqual({
      count: 1,
      done: false,
    });
  });

  it("filters by game", () => {
    const events = [
      ev({ achievementId: "a", gameId: "g1" }),
      ev({ achievementId: "b", gameId: "g2" }),
    ];
    expect(missionProgress({ minCount: 1, gameId: "g2" }, events).count).toBe(1);
  });
});

describe("templates", () => {
  it("has 3 daily and 2 weekly templates", () => {
    expect(DAILY_TEMPLATES).toHaveLength(3);
    expect(WEEKLY_TEMPLATES).toHaveLength(2);
  });
});

describe("generateMissions", () => {
  it("returns 3 daily missions deterministically", () => {
    const a = generateMissions("2026-10-31", "daily", ["soulslike"]);
    const b = generateMissions("2026-10-31", "daily", ["soulslike"]);
    expect(a).toHaveLength(3);
    expect(a).toEqual(b);
  });

  it("returns 2 weekly missions", () => {
    expect(generateMissions("2026-W44", "weekly", ["rpg"])).toHaveLength(2);
  });

  it("matches the preview texts and rewards", () => {
    const daily = generateMissions("2026-10-31", "daily", ["soulslike"]);
    expect(daily[0]).toEqual({
      title: "Desbloqueie 3 conquistas raras",
      condition: { minCount: 3, maxGlobalPct: 20 },
      rewardXp: 12000,
    });
    expect(daily[1]).toEqual({
      title: "Ganhe XP em Soulslike",
      condition: { minCount: 1, skill: "soulslike" },
      rewardXp: 5000,
    });
    const weekly = generateMissions("2026-W44", "weekly", ["horror"]);
    expect(weekly[0]).toEqual({
      title: "Desbloqueie 10 conquistas de Survival Horror",
      condition: { minCount: 10, skill: "horror" },
      rewardXp: 40000,
    });
  });

  it("works without top skills and never targets sabio", () => {
    const missions = generateMissions("seed", "daily", []);
    expect(missions).toHaveLength(3);
    for (const m of missions) expect(m.condition.skill).not.toBe("sabio");
    const sabioOnly = generateMissions("seed", "weekly", ["sabio"]);
    for (const m of sabioOnly) expect(m.condition.skill).not.toBe("sabio");
  });

  it("varies the skill with the seed", () => {
    const skills = ["fps", "horror", "soulslike", "rpg", "puzzle", "coop"] as const;
    const picked = new Set(
      Array.from({ length: 20 }, (_, i) =>
        generateMissions(`day-${i}`, "daily", [...skills])[1].condition.skill,
      ),
    );
    expect(picked.size).toBeGreaterThan(1);
  });
});

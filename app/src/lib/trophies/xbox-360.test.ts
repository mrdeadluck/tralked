import { describe, expect, it } from "vitest";
import type { XboxAchievement, XboxApi, XboxTitle } from "@/lib/integrations/xbox/types";
import { measureX360 } from "./xbox-360";

const title = (titleId: string, devices: string[], earned: number, total: number): XboxTitle => ({
  titleId,
  name: `T${titleId}`,
  currentAchievements: earned,
  totalAchievements: total,
  currentGamerscore: 0,
  totalGamerscore: 0,
  progress: 0,
  lastPlayed: null,
  devices,
});

const achievement = (id: number, unlockedAt: Date | null | "undated"): XboxAchievement => ({
  id: String(id),
  name: `A${id}`,
  description: null,
  iconUrl: null,
  hidden: false,
  gamerscore: 10,
  unlocked: unlockedAt !== null,
  unlockedAt: unlockedAt === "undated" ? null : unlockedAt,
  rarityPct: null,
});

function fake(lists: Record<string, XboxAchievement[] | Error>): Pick<XboxApi, "getTitles" | "getAchievements"> & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async getTitles() {
      return [
        title("1", ["Xbox360", "XboxOne", "XboxSeries"], 2, 4),
        title("2", ["Xbox360"], 11, 12),
        title("3", ["XboxOne", "XboxSeries"], 5, 0),
        title("4", ["Xbox360"], 0, 30),
        title("5", ["Xbox360"], 1, 10),
      ];
    },
    async getAchievements(_xuid, titleId, devices) {
      asked.push(`${titleId}:${devices?.join("+")}`);
      const list = lists[titleId];
      if (list instanceof Error) throw list;
      return list ?? [];
    },
  };
}

describe("measureX360", () => {
  it("reads the 360 titles with an unlock through the client and counts what a sync would import", async () => {
    const t0 = Date.UTC(2010, 0, 1, 20);
    const xbox = fake({
      "1": [achievement(1, new Date(t0)), achievement(2, "undated"), achievement(3, null), achievement(4, null)],
      // Eleven unlocks within a minute: a burst on their own dates.
      "2": [...Array.from({ length: 11 }, (_, i) => achievement(i + 1, new Date(Date.UTC(2012, 5, 1, 20) + i * 1000))), achievement(12, null)],
      "5": new Error("Xbox 360 title 5: earned achievement(s) 9 not in its list"),
    });
    const measure = await measureX360(xbox, "xuid");
    expect(xbox.asked).toEqual(["1:Xbox360+XboxOne+XboxSeries", "2:Xbox360", "5:Xbox360"]);
    if (measure === "private") throw new Error("private");
    expect(measure.found).toBe(3);
    expect(measure.totals).toEqual({ titles: 2, achievements: 16, earned: 13, dated: 12 });
    expect(measure.titles.map((t) => [t.titleId, t.status, t.achievements, t.earned, t.dated, t.history.total])).toEqual([
      ["1", "ok", 4, 2, 1, 4],
      ["2", "ok", 12, 11, 11, 12],
      ["5", "failed", 0, 0, 0, 10],
    ]);
    expect(measure.titles[2].error).toContain("not in its list");
    expect(measure.bursts).toBe(11);
  });

  it("stops at the request budget and counts the player's other unlocks in the burst check", async () => {
    const at = new Date(Date.UTC(2010, 0, 1, 20));
    const xbox = fake({ "1": [achievement(1, at), achievement(2, null), achievement(3, null), achievement(4, null)] });
    const others = Array.from({ length: 9 }, (_, i) => ({ achievementId: `one:${i}`, unlockedAt: new Date(at.getTime() + i * 1000) }));
    const measure = await measureX360(xbox, "xuid", { maxTitles: 1, others });
    if (measure === "private") throw new Error("private");
    expect(xbox.asked).toHaveLength(1);
    expect(measure.skipped).toBe(2);
    expect(measure.bursts).toBe(1);
  });
});

describe("measureX360 size check", () => {
  it("a list shorter than the history's total counts as failed, as in the sync", async () => {
    const xbox: Pick<XboxApi, "getTitles" | "getAchievements"> = {
      getTitles: async () => [title("7", ["Xbox360"], 1, 10)],
      getAchievements: async () => [achievement(1, new Date(Date.UTC(2010, 0, 1))), achievement(2, null)],
    };
    const measure = await measureX360(xbox, "xuid");
    if (measure === "private") throw new Error("private");
    expect(measure.titles.map((t) => [t.status, t.error])).toEqual([["failed", expect.stringMatching(/2 of the 10/)]]);
    expect(measure.totals.titles).toBe(0);
  });
});

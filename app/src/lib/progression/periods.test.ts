import { describe, expect, it } from "vitest";
import { dailyPeriodKey, isoWeekKey, weeklyPeriodKey } from "./periods";

describe("mission period keys", () => {
  it("formats ISO weeks, including year boundaries", () => {
    expect(isoWeekKey("2026-10-31")).toBe("2026-W44");
    expect(isoWeekKey("2021-01-03")).toBe("2020-W53");
    expect(isoWeekKey("2024-12-30")).toBe("2025-W01");
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
  });

  it("derives daily and weekly keys in America/Sao_Paulo", () => {
    // 01:00 UTC is still the previous evening in Sao Paulo (UTC-3).
    const instant = new Date("2026-11-02T01:00:00Z"); // Monday in UTC, Sunday in Sao Paulo
    expect(dailyPeriodKey(instant)).toBe("2026-11-01");
    expect(weeklyPeriodKey(instant)).toBe("2026-W44");
  });
});

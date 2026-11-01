import { describe, expect, it } from "vitest";
import { addMonths, dayKey, dayLabel, instantBounds, monthLabel, monthOf, monthParam, monthWeeks, parseMonth, utcBounds } from "./month";

describe("calendar months", () => {
  it("parses and prints AAAA-MM within range", () => {
    expect(parseMonth("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth("2026-1")).toBeNull();
    expect(parseMonth("1979-12")).toBeNull();
    expect(parseMonth("2041-01")).toBeNull();
    expect(parseMonth(undefined)).toBeNull();
    expect(monthParam({ year: 2026, month: 3 })).toBe("2026-03");
  });

  it("moves across years", () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 5 }, -17)).toEqual({ year: 2024, month: 12 });
  });

  it("counts days in Brasília time", () => {
    // 01:30 UTC on Nov 1st is still Oct 31st in São Paulo.
    expect(dayKey(new Date("2026-11-01T01:30:00Z"))).toBe("2026-10-31");
    expect(dayKey(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11-01");
    expect(monthOf(new Date("2026-11-01T01:30:00Z"))).toEqual({ year: 2026, month: 10 });
  });

  it("builds Sunday-first weeks", () => {
    // October 2026 starts on a Thursday and has 31 days.
    const weeks = monthWeeks({ year: 2026, month: 10 });
    expect(weeks[0]).toEqual([null, null, null, null, 1, 2, 3]);
    expect(weeks.at(-1)).toEqual([25, 26, 27, 28, 29, 30, 31]);
    expect(weeks.flat().filter((d) => d !== null)).toHaveLength(31);
    // February 2026 starts on a Sunday: exactly four weeks.
    expect(monthWeeks({ year: 2026, month: 2 })).toHaveLength(4);
  });

  it("bounds a month for date and instant columns", () => {
    expect(utcBounds({ year: 2026, month: 12 })).toEqual({
      start: new Date("2026-12-01T00:00:00Z"),
      end: new Date("2027-01-01T00:00:00Z"),
    });
    const { start, end } = instantBounds({ year: 2026, month: 10 });
    expect(start.getTime()).toBeLessThan(new Date("2026-10-01T03:00:00Z").getTime());
    expect(end.getTime()).toBeGreaterThan(new Date("2026-11-01T03:00:00Z").getTime());
  });

  it("labels in Portuguese", () => {
    expect(monthLabel({ year: 2026, month: 3 })).toBe("março de 2026");
    expect(dayLabel("2026-10-31")).toBe("sábado, 31 de outubro");
    expect(dayLabel("2026-10-31", true)).toBe("sábado, 31 de outubro de 2026");
  });
});

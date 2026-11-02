import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/events";
import { timelineWeeks, weekToOpen } from "./MonthView";

// November 2026 starts on a Sunday: weeks are 1–7, 8–14, 15–21, 22–28, 29–30.
const month = { year: 2026, month: 11 };

const release = (day: string, title: string, imageUrl?: string, big = false): CalendarEvent =>
  ({ kind: "release", day, title, imageUrl, big }) as unknown as CalendarEvent;

const days = new Map<string, CalendarEvent[]>([
  ["2026-11-03", [release("2026-11-03", "A", "https://cdn.example.com/a.jpg")]],
  ["2026-11-05", [release("2026-11-05", "B", "https://cdn.example.com/b.jpg", true)]],
  ["2026-11-20", [release("2026-11-20", "C")]],
]);

describe("timeline weeks", () => {
  it("groups the days with dates by week, big covers first", () => {
    const weeks = timelineWeeks(month, days);
    expect(weeks.map((w) => [w.index, w.range, w.keys])).toEqual([
      [0, "1–7 nov", ["2026-11-03", "2026-11-05"]],
      [2, "15–21 nov", ["2026-11-20"]],
    ]);
    expect(weeks[0].covers).toEqual(["https://cdn.example.com/b.jpg", "https://cdn.example.com/a.jpg"]);
  });

  it("opens today's week, else the next one with dates, else the first", () => {
    const weeks = timelineWeeks(month, days);
    expect(weekToOpen(weeks, "2026-11-04")).toBe(0);
    expect(weekToOpen(weeks, "2026-11-10")).toBe(2);
    expect(weekToOpen(weeks, "2026-11-29")).toBe(2);
    expect(weekToOpen(weeks, null)).toBe(0);
    expect(weekToOpen([], null)).toBeNull();
  });
});

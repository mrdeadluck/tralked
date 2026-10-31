import { describe, expect, it } from "vitest";
import { computeStreak, toLocalDay } from "./streak";

function days(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("computeStreak", () => {
  it("returns zeros without activity", () => {
    expect(computeStreak([], "2026-10-31")).toEqual({
      current: 0,
      best: 0,
      shields: 0,
      activeToday: false,
    });
  });

  it("earns a shield after 7 consecutive days", () => {
    const r = computeStreak(days("2026-10-25", "2026-10-31"), "2026-10-31");
    expect(r).toEqual({ current: 7, best: 7, shields: 1, activeToday: true });
  });

  it("keeps the streak alive when today has no activity yet", () => {
    const r = computeStreak(days("2026-10-28", "2026-10-30"), "2026-10-31");
    expect(r).toMatchObject({ current: 3, activeToday: false });
  });

  it("bridges a 1-day gap with an available shield", () => {
    const active = [...days("2026-10-18", "2026-10-24"), "2026-10-26"];
    const r = computeStreak(active, "2026-10-26");
    expect(r.current).toBe(8);
    expect(r.shields).toBe(0);
    expect(r.activeToday).toBe(true);
  });

  it("resets on a 1-day gap without a shield", () => {
    const r = computeStreak(["2026-10-20", "2026-10-21"], "2026-10-23");
    expect(r).toMatchObject({ current: 0, best: 2, shields: 0 });
  });

  it("restarts at 1 after a gap without a shield", () => {
    const r = computeStreak(
      ["2026-10-20", "2026-10-21", "2026-10-23"],
      "2026-10-23",
    );
    expect(r).toMatchObject({ current: 1, best: 2, activeToday: true });
  });

  it("caps shields at 2", () => {
    const r = computeStreak(days("2026-10-01", "2026-10-31"), "2026-10-31");
    expect(r.shields).toBe(2);
    expect(r.current).toBe(31);
  });

  it("ignores duplicates and unsorted input", () => {
    const r = computeStreak(
      ["2026-10-31", "2026-10-30", "2026-10-31", "2026-10-29"],
      "2026-10-31",
    );
    expect(r.current).toBe(3);
  });
});

describe("toLocalDay", () => {
  it("uses the America/Sao_Paulo timezone", () => {
    expect(toLocalDay(new Date("2026-11-01T02:00:00Z"))).toBe("2026-10-31");
    expect(toLocalDay(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11-01");
  });
});

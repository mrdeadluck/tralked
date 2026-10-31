import { describe, expect, it } from "vitest";
import { timeAgo } from "./time-ago";

const now = new Date("2026-10-31T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const H = 3_600_000;

describe("timeAgo", () => {
  it.each([
    [10_000, "agora"],
    [60_000, "há 1 minuto"],
    [5 * 60_000, "há 5 minutos"],
    [H, "há 1 hora"],
    [2 * H, "há 2 horas"],
    [24 * H, "ontem"],
    [47 * H, "ontem"],
    [3 * 24 * H, "há 3 dias"],
    [45 * 24 * H, "há 1 mês"],
    [400 * 24 * H, "há 1 ano"],
  ])("%i ms ago -> %s", (ms, expected) => {
    expect(timeAgo(ago(ms), now)).toBe(expected);
  });

  it("treats future dates as now", () => {
    expect(timeAgo(new Date(now.getTime() + H), now)).toBe("agora");
  });
});

import { describe, expect, it } from "vitest";
import { recurringKey } from "../src/recurring.js";

/** A São Paulo wall-clock time. */
const local = (wall: string) => new Date(`${wall}:00-03:00`);

describe("recurringKey", () => {
  it("PS Plus: one per month", () => {
    expect(recurringKey("ps-plus", local("2026-11-05T10:00"))).toBe("ps-plus:2026-11");
  });

  it("Game Pass: wave a up to the 15th, b after", () => {
    expect(recurringKey("game-pass", local("2026-11-15T23:00"))).toBe("game-pass:2026-11-a");
    expect(recurringKey("game-pass", local("2026-11-20T10:00"))).toBe("game-pass:2026-11-b");
  });

  it("Epic free game: one per ISO week", () => {
    expect(recurringKey("epic-gratis", local("2026-11-05T10:00"))).toBe("epic-gratis:2026-W45");
    // ISO week of 2027-01-01 (Friday) belongs to 2026's last week.
    expect(recurringKey("epic-gratis", local("2027-01-01T10:00"))).toBe("epic-gratis:2026-W53");
  });

  it("uses the São Paulo day, not UTC", () => {
    // 22:30 local on Oct 31 is already Nov 1 in UTC.
    expect(recurringKey("ps-plus", local("2026-10-31T22:30"))).toBe("ps-plus:2026-10");
  });
});

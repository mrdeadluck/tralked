import { describe, expect, it } from "vitest";
import { RECURRING_WINDOW_DAYS, recurringKey, sameAnnouncement } from "../src/recurring.js";

/** A São Paulo wall-clock time. */
const local = (wall: string) => new Date(`${wall}:00-03:00`);

describe("recurringKey", () => {
  it("is the kind and the São Paulo day the story started", () => {
    expect(recurringKey("ps-plus", local("2026-11-05T10:00"))).toBe("ps-plus:2026-11-05");
    // 22:30 local on Oct 31 is already Nov 1 in UTC.
    expect(recurringKey("game-pass", local("2026-10-31T22:30"))).toBe("game-pass:2026-10-31");
  });
});

describe("sameAnnouncement", () => {
  it("the same kind within the window is one announcement (the sites repeat it for days)", () => {
    expect(RECURRING_WINDOW_DAYS).toBe(6);
    expect(sameAnnouncement("ps-plus:2026-10-29", "ps-plus:2026-10-31")).toBe(true);
    expect(sameAnnouncement("epic-gratis:2026-11-05", "epic-gratis:2026-11-11")).toBe(true);
  });

  it("PS Plus Extra (2nd Wednesday) and Essential (last Wednesday) of one month are two announcements", () => {
    expect(sameAnnouncement("ps-plus:2026-11-11", "ps-plus:2026-11-25")).toBe(false);
  });

  it("Game Pass waves on the 4th and the 14th are two; the weekly Epic games are one a week", () => {
    expect(sameAnnouncement("game-pass:2026-11-04", "game-pass:2026-11-14")).toBe(false);
    expect(sameAnnouncement("epic-gratis:2026-11-05", "epic-gratis:2026-11-12")).toBe(false);
  });

  it("different kinds or malformed keys never match", () => {
    expect(sameAnnouncement("ps-plus:2026-11-05", "game-pass:2026-11-05")).toBe(false);
    expect(sameAnnouncement("ps-plus:2026-11", "ps-plus:2026-11")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { inSlotWindow, localDay, localHour, randomTimeOn } from "../src/clock.js";

describe("localDay / localHour", () => {
  it("uses America/Sao_Paulo, not UTC", () => {
    const d = new Date("2026-11-01T02:30:00Z"); // 23:30 on Oct 31 in Sao Paulo
    expect(localDay(d)).toBe("2026-10-31");
    expect(localHour(d)).toBe(23);
  });

  it("rolls over at local midnight", () => {
    expect(localDay(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11-01");
    expect(localHour(new Date("2026-11-01T03:00:00Z"))).toBe(0);
  });
});

describe("inSlotWindow", () => {
  it("is false at 05:59 and 00:03 local", () => {
    expect(inSlotWindow(new Date("2026-08-10T08:59:00Z"))).toBe(false);
    expect(inSlotWindow(new Date("2026-08-11T03:03:00Z"))).toBe(false);
  });

  it("is true at 06:00 and 23:59 local", () => {
    expect(inSlotWindow(new Date("2026-08-10T09:00:00Z"))).toBe(true);
    expect(inSlotWindow(new Date("2026-08-11T02:59:00Z"))).toBe(true);
  });

  it("honors custom bounds", () => {
    expect(inSlotWindow(new Date("2026-08-10T12:00:00Z"), 10, 12)).toBe(false); // 09:00 local
    expect(inSlotWindow(new Date("2026-08-10T13:00:00Z"), 10, 12)).toBe(true); // 10:00 local
  });
});

describe("randomTimeOn", () => {
  it("returns 06:00 local with rand=0", () => {
    const t = randomTimeOn("2026-08-10", () => 0);
    expect(t.toISOString()).toBe("2026-08-10T09:00:00.000Z");
    expect(localDay(t)).toBe("2026-08-10");
    expect(localHour(t)).toBe(6);
  });

  it("returns 23:59 local with rand close to 1", () => {
    const t = randomTimeOn("2026-08-10", () => 0.9999);
    expect(t.toISOString()).toBe("2026-08-11T02:59:00.000Z");
    expect(localDay(t)).toBe("2026-08-10");
    expect(localHour(t)).toBe(23);
  });

  it("always stays inside the window on the given day", () => {
    for (let i = 0; i < 200; i++) {
      const t = randomTimeOn("2026-08-10");
      expect(localDay(t)).toBe("2026-08-10");
      expect(inSlotWindow(t)).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import { formatAgo } from "./format";

const now = new Date("2026-10-31T15:00:00Z"); // 12:00 in Sao Paulo

describe("formatAgo", () => {
  it("handles minutes and hours on the same local day", () => {
    expect(formatAgo(new Date("2026-10-31T14:59:50Z"), now)).toBe("agora");
    expect(formatAgo(new Date("2026-10-31T14:30:00Z"), now)).toBe("há 30 min");
    expect(formatAgo(new Date("2026-10-31T13:00:00Z"), now)).toBe("há 2 h");
  });

  it("says ontem for the previous local calendar day, even under 24 h", () => {
    expect(formatAgo(new Date("2026-10-30T20:00:00Z"), now)).toBe("ontem");
    expect(formatAgo(new Date("2026-10-30T12:00:00Z"), now)).toBe("ontem");
  });

  it("counts days beyond yesterday", () => {
    expect(formatAgo(new Date("2026-10-28T12:00:00Z"), now)).toBe("há 3 dias");
  });
});

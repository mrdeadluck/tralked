import { describe, expect, it } from "vitest";
import { formatCompact, formatExact, formatXpGain } from "./xp-format";

const plain = (s: string) => s.replace(/ /g, " ");

describe("formatCompact", () => {
  it("keeps small numbers whole", () => {
    expect(formatCompact(5)).toBe("5");
    expect(formatCompact(9876)).toBe("9.876");
  });

  it("abbreviates thousands and millions the pt-BR way", () => {
    expect(plain(formatCompact(12_345))).toBe("12,3 mil");
    expect(plain(formatCompact(3_400_000))).toBe("3,4 mi");
    expect(plain(formatCompact(118_204_551))).toBe("118,2 mi");
  });

  it("survives junk", () => {
    expect(formatCompact(Number.NaN)).toBe("0");
  });
});

describe("formatExact / formatXpGain", () => {
  it("formats", () => {
    expect(formatExact(118_204_551)).toBe("118.204.551");
    expect(formatXpGain(5)).toBe("+5 XP");
    expect(plain(formatXpGain(50_000))).toBe("+50 mil XP");
  });
});

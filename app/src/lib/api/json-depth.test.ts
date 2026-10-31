import { describe, expect, it } from "vitest";
import { jsonDepthExceeds, MAX_JSON_DEPTH } from "./json-depth";

const nested = (levels: number) => `${"[".repeat(levels)}${"]".repeat(levels)}`;

describe("jsonDepthExceeds", () => {
  it("accepts up to the limit and refuses one level more", () => {
    expect(jsonDepthExceeds(nested(MAX_JSON_DEPTH))).toBe(false);
    expect(jsonDepthExceeds(nested(MAX_JSON_DEPTH + 1))).toBe(true);
    expect(jsonDepthExceeds(`{"a":${nested(MAX_JSON_DEPTH)}}`)).toBe(true);
  });

  it("handles 3,000 and 1,000,000 levels without recursion", () => {
    expect(jsonDepthExceeds(nested(3000))).toBe(true);
    expect(jsonDepthExceeds("[".repeat(1_000_000))).toBe(true);
  });

  it("ignores brackets inside strings, including escaped quotes", () => {
    const text = JSON.stringify({ text: "[[[[{{{{".repeat(100), quoted: 'a\\"[[["b' });
    expect(jsonDepthExceeds(text, 2)).toBe(false);
  });

  it("counts siblings, not totals", () => {
    expect(jsonDepthExceeds(JSON.stringify(Array.from({ length: 500 }, () => [[1]])), 3)).toBe(false);
  });
});

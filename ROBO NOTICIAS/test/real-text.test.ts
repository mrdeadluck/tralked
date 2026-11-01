import { describe, expect, it } from "vitest";
import { MIN_TEXT_CHARS, hasRealText } from "../src/pipeline.js";

describe("hasRealText", () => {
  it("counts only a real article body as source text (a page footer is not one)", () => {
    expect(hasRealText(null)).toBe(false);
    expect(hasRealText("Steam News · Política de privacidade · Termos")).toBe(false);
    expect(hasRealText("x".repeat(MIN_TEXT_CHARS))).toBe(true);
  });
});

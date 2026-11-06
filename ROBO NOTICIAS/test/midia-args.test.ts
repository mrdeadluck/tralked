import { describe, expect, it } from "vitest";
import { parseMidiaArgs } from "../src/commands/midia.js";

describe("parseMidiaArgs", () => {
  it("takes one or more --historia ids", () => {
    expect(parseMidiaArgs(["--historia", "4929", "--historia", "5265"])).toEqual([4929, 5265]);
  });
  it("refuses no story, a non-number or an unknown flag", () => {
    expect(() => parseMidiaArgs([])).toThrow(/uso/);
    expect(() => parseMidiaArgs(["--historia", "abc"])).toThrow(/uso/);
    expect(() => parseMidiaArgs(["--publicar"])).toThrow();
  });
});

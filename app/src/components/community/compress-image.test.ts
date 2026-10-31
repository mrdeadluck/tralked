import { describe, expect, it } from "vitest";
import { fitWithin } from "./compress-image";

describe("fitWithin", () => {
  it("shrinks the longest side to 2048 px keeping the aspect ratio", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(1080, 5000)).toEqual({ width: 442, height: 2048 });
  });

  it("never enlarges small images", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

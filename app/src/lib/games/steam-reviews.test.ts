import { describe, expect, it } from "vitest";
import { steamReviewLabel } from "./steam-reviews";

// Parsing the store's review totals (GetItems summary_filtered) is covered in
// lib/integrations/steam/store.test.ts.
describe("steamReviewLabel", () => {
  it("follows the store's thresholds", () => {
    expect(steamReviewLabel(9_600, 10_000)).toBe("Extremamente positivas");
    expect(steamReviewLabel(450, 480)).toBe("Muito positivas");
    expect(steamReviewLabel(40, 45)).toBe("Positivas");
    expect(steamReviewLabel(75, 100)).toBe("Ligeiramente positivas");
    expect(steamReviewLabel(55, 100)).toBe("Neutras");
    expect(steamReviewLabel(30, 100)).toBe("Ligeiramente negativas");
    expect(steamReviewLabel(10, 100)).toBe("Muito negativas");
    expect(steamReviewLabel(50, 1_000)).toBe("Extremamente negativas");
    expect(steamReviewLabel(3, 20)).toBe("Negativas");
    expect(steamReviewLabel(4, 4)).toBe("4 análises");
  });
});

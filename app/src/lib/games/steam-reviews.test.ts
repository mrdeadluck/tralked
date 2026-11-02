import { describe, expect, it } from "vitest";
import { parseStoreReviews } from "@/lib/integrations/steam/store";
import { steamReviewLabel } from "./steam-reviews";

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

  it("reads the totals of an appreviews answer", () => {
    expect(parseStoreReviews({ success: 1, query_summary: { total_positive: 90, total_negative: 10, total_reviews: 100 } })).toEqual({
      positive: 90,
      total: 100,
    });
    expect(parseStoreReviews({ success: 2 })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { shareImageUrl } from "./share-image";

describe("shareImageUrl (the picture a shared news link shows)", () => {
  it("uses the article's wide picture first, then its hero, then any picture", () => {
    expect(shareImageUrl({ wideImageUrl: "https://a.test/wide.jpg", heroUrl: "https://a.test/hero.jpg", imageUrl: "https://a.test/i.jpg" })).toBe(
      "https://a.test/wide.jpg",
    );
    expect(shareImageUrl({ wideImageUrl: null, heroUrl: "https://a.test/hero.jpg", imageUrl: "https://a.test/i.jpg" })).toBe("https://a.test/hero.jpg");
    expect(shareImageUrl({ wideImageUrl: null, heroUrl: null, imageUrl: "https://a.test/i.jpg" })).toBe("https://a.test/i.jpg");
  });

  it("is null without a picture, or with one that is not https", () => {
    expect(shareImageUrl({ wideImageUrl: null, heroUrl: null, imageUrl: null })).toBeNull();
    expect(shareImageUrl({ wideImageUrl: "http://a.test/x.jpg", heroUrl: null, imageUrl: null })).toBeNull();
  });

  it("keeps site paths (official logos under /logos) as they are: metadataBase makes them absolute", () => {
    expect(shareImageUrl({ wideImageUrl: "/logos/grand-theft-auto-vi.png", heroUrl: null, imageUrl: null })).toBe("/logos/grand-theft-auto-vi.png");
  });

  it("swaps heavy originals for light versions WhatsApp still previews", () => {
    // SteamGridDB heroes are multi-MB PNGs; their JPEG thumbnail is 900px wide.
    expect(
      shareImageUrl({ wideImageUrl: "https://cdn2.steamgriddb.com/hero/f997fc90f5aec6fda612026c7cf70140.png", heroUrl: null, imageUrl: null }),
    ).toBe("https://cdn2.steamgriddb.com/hero_thumb/f997fc90f5aec6fda612026c7cf70140.jpg");
    // IGDB: the 720p size.
    expect(shareImageUrl({ wideImageUrl: "https://images.igdb.com/igdb/image/upload/t_1080p/sc10vlp.jpg", heroUrl: null, imageUrl: null })).toBe(
      "https://images.igdb.com/igdb/image/upload/t_720p/sc10vlp.jpg",
    );
  });
});

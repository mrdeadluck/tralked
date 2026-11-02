import { describe, expect, it } from "vitest";
import { caseArt, steamAppIdFromUrl, steamHeaderUrl, steamPortraitUrl } from "./case-art";

describe("caseArt", () => {
  it("orders portrait cover, Steam portrait, then the wide header", () => {
    expect(caseArt({ coverUrl: "https://img/c.jpg", steamAppId: 10 })).toEqual([
      { url: "https://img/c.jpg", wide: false },
      { url: steamPortraitUrl(10), wide: false },
      { url: steamHeaderUrl(10), wide: true },
    ]);
  });

  it("prefers the given wide art over the Steam header and skips missing sources", () => {
    expect(caseArt({ wideUrl: "https://cdn/apps/7/capsule.jpg" })).toEqual([{ url: "https://cdn/apps/7/capsule.jpg", wide: true }]);
    expect(caseArt({})).toEqual([]);
  });

  it("does not guess the Steam portrait when it is known to be missing", () => {
    const hashed = "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/4115450/aef06490c9a4ad912142fe3b766ee08a2b38ef80/capsule_231x87.jpg?t=1";
    expect(caseArt({ steamAppId: 4115450, wideUrl: hashed })).toEqual([{ url: hashed, wide: true }]);
    expect(caseArt({ steamAppId: 10, portraitChecked: true })).toEqual([{ url: steamHeaderUrl(10), wide: true }]);
    // A hashed capsule stored as the "cover" (stubs) also rules the guess out.
    expect(caseArt({ coverUrl: hashed, steamAppId: 4115450 })[0]).toEqual({ url: hashed, wide: true });
    // Plain (older) asset folders still try the portrait first.
    const plain = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/10/capsule_231x87.jpg";
    expect(caseArt({ steamAppId: 10, wideUrl: plain })[0]).toEqual({ url: steamPortraitUrl(10), wide: false });
  });

  it("does not repeat a source", () => {
    expect(caseArt({ coverUrl: steamPortraitUrl(3), steamAppId: 3 })).toHaveLength(2);
  });
});

describe("steamAppIdFromUrl", () => {
  it("reads the app id of plain and hashed Steam CDN paths", () => {
    expect(steamAppIdFromUrl("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1245620/capsule_231x87.jpg?t=1")).toBe(1245620);
    expect(steamAppIdFromUrl("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3489700/0a1b2c/capsule_616x353.jpg")).toBe(3489700);
    expect(steamAppIdFromUrl("https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg")).toBeNull();
    expect(steamAppIdFromUrl(null)).toBeNull();
  });
});

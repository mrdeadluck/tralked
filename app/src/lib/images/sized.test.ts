import { describe, expect, it } from "vitest";
import { noteFailedImage, PNG_THUMB_HINT, sizedImage, sizedUrl } from "./sized";

const IGDB = (token: string, id = "loakfrjghok9fxnh59lt") => `https://images.igdb.com/igdb/image/upload/${token}/${id}.jpg`;
const SS = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4824610/223fa1c5/ss_223fa1c5.1920x1080.jpg?t=1780990195";

describe("sizedImage", () => {
  it("picks the IGDB 16:9 size that covers a wide box", () => {
    expect(sizedUrl(IGDB("t_1080p"), 96)).toBe(IGDB("t_thumb"));
    expect(sizedUrl(IGDB("t_1080p"), 112)).toBe(IGDB("t_screenshot_med"));
    expect(sizedUrl(IGDB("t_1080p"), 792)).toBe(IGDB("t_screenshot_big"));
    expect(sizedUrl(IGDB("t_cover_big"), 1200)).toBe(IGDB("t_720p"));
    expect(sizedUrl(IGDB("t_720p"), 4000)).toBe(IGDB("t_1080p"));
  });

  it("uses IGDB cover sizes for fit boxes and lists every size in srcset", () => {
    const img = sizedImage(IGDB("t_1080p", "co2l7z"), 172, "fit");
    expect(img.src).toBe(IGDB("t_cover_big", "co2l7z"));
    expect(img.srcSet).toBe(
      [
        `${IGDB("t_cover_big", "co2l7z")} 264w`,
        `${IGDB("t_cover_big_2x", "co2l7z")} 528w`,
        `${IGDB("t_720p", "co2l7z")} 720w`,
        `${IGDB("t_1080p", "co2l7z")} 1080w`,
      ].join(", "),
    );
    expect(img.fallbacks).toBeUndefined();
  });

  it("swaps Steam screenshots to their 600 px copy, keeping the version query", () => {
    const img = sizedImage(SS, 384);
    expect(img.src).toBe(SS.replace(".1920x1080.jpg", ".600x338.jpg"));
    expect(img.srcSet).toContain(`${SS} 1920w`);
    expect(sizedUrl(SS, 1000)).toBe(SS);
    // List thumbnails (96 px) take the 116 × 65 copy.
    expect(sizedUrl(SS, 96)).toBe(SS.replace(".1920x1080.jpg", ".116x65.jpg"));
  });

  it("uses SteamGridDB JPEG thumbnails, then the PNG thumbnail and the original as fallbacks", () => {
    const hero = "https://cdn2.steamgriddb.com/hero/11cadbfc3900a66c45907221f0d791e2.png";
    expect(sizedImage(hero, 400)).toEqual({
      src: "https://cdn2.steamgriddb.com/hero_thumb/11cadbfc3900a66c45907221f0d791e2.jpg",
      srcSet: `https://cdn2.steamgriddb.com/hero_thumb/11cadbfc3900a66c45907221f0d791e2.jpg 900w, ${hero} 1920w`,
      fallbacks: ["https://cdn2.steamgriddb.com/hero_thumb/11cadbfc3900a66c45907221f0d791e2.png", hero],
    });
    const grid = "https://cdn2.steamgriddb.com/grid/efb0f96fc2ee386ece83fdacdf9e9c81.png";
    expect(sizedImage(grid, 172, "fit").src).toBe("https://cdn2.steamgriddb.com/thumb/efb0f96fc2ee386ece83fdacdf9e9c81.jpg");
    expect(sizedImage(grid, 400, "fit")).toMatchObject({ src: grid, fallbacks: ["https://cdn2.steamgriddb.com/thumb/efb0f96fc2ee386ece83fdacdf9e9c81.png", grid] });
    // A JPEG original has a JPEG thumbnail: only the original is left to try.
    const jpg = "https://cdn2.steamgriddb.com/grid/56f9c90b73b3703fd8abe316d2bd1e6c.jpg";
    expect(sizedImage(jpg, 172, "fit").fallbacks).toEqual([jpg]);
  });

  it("asks for the PNG thumbnail directly when the URL carries the hint, or after a JPEG one failed", () => {
    const id = "1130064514f563b2d894f0840d31db3c";
    const grid = `https://cdn2.steamgriddb.com/grid/${id}.png`;
    expect(sizedImage(`${grid}${PNG_THUMB_HINT}`, 172, "fit")).toEqual({
      src: `https://cdn2.steamgriddb.com/thumb/${id}.png`,
      srcSet: `https://cdn2.steamgriddb.com/thumb/${id}.png 280w, ${grid} 600w`,
      fallbacks: [grid],
    });
    const other = "https://cdn2.steamgriddb.com/grid/2979eeec451dcd28d06474671b396519.png";
    expect(sizedImage(other, 172, "fit").src).toBe("https://cdn2.steamgriddb.com/thumb/2979eeec451dcd28d06474671b396519.jpg");
    noteFailedImage("https://cdn2.steamgriddb.com/thumb/2979eeec451dcd28d06474671b396519.jpg");
    expect(sizedImage(other, 172, "fit")).toMatchObject({
      src: "https://cdn2.steamgriddb.com/thumb/2979eeec451dcd28d06474671b396519.png",
      fallbacks: [other],
    });
    // Other failures are not remembered.
    noteFailedImage("https://example.com/x.jpg");
    noteFailedImage(undefined);
  });

  it("passes other URLs through unchanged", () => {
    for (const url of [
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2246340/library_hero.jpg",
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/library_600x900.jpg",
      "https://cdn2.steamgriddb.com/logo/abc.png",
      "https://example.com/t_1080p/x.jpg",
      "/uploads/foto.webp",
    ]) {
      expect(sizedImage(url, 200)).toEqual({ src: url });
    }
  });
});

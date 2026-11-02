import { describe, expect, it } from "vitest";
import { artAssets, artKindOf, artRatio, pickArt, type ArtAsset } from "./frame";

const STEAM = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/24980";
const cover: ArtAsset = { url: `${STEAM}/library_600x900.jpg`, kind: "cover" };
const capsule: ArtAsset = { url: `${STEAM}/capsule_616x353.jpg`, kind: "capsule" };
const header: ArtAsset = { url: `${STEAM}/header.jpg`, kind: "header" };
const hero: ArtAsset = { url: `${STEAM}/library_hero.jpg`, kind: "hero" };
const logo: ArtAsset = { url: `${STEAM}/logo.png`, kind: "logo" };
const shot = (n: number): ArtAsset => ({ url: `${STEAM}/ss_${n}abc.1920x1080.jpg`, kind: "screenshot" });

describe("artRatio", () => {
  it("reads stored sizes, then file names, then the kind", () => {
    expect(artRatio({ url: "https://x/a.jpg", kind: "artwork", w: 1000, h: 500 })).toBe(2);
    expect(artRatio(capsule)).toBeCloseTo(616 / 353);
    expect(artRatio(header)).toBeCloseTo(460 / 215);
    expect(artRatio(hero)).toBeCloseTo(3840 / 1240);
    expect(artRatio(shot(1))).toBeCloseTo(16 / 9);
    expect(artRatio({ url: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg", kind: "cover" })).toBeLessThan(1);
  });
});

describe("artKindOf", () => {
  it("knows Steam headers and capsules stored as artwork or cover", () => {
    expect(artKindOf("artwork", `${STEAM}/abc/header.jpg?t=1`)).toBe("header");
    expect(artKindOf("cover", `${STEAM}/capsule_616x353.jpg`)).toBe("capsule");
    expect(artKindOf("video", "https://x/v.mp4")).toBeNull();
  });
});

describe("pickArt (identity: a game's card or case)", () => {
  it("puts the portrait cover in a case and the capsule in a 16:10 card", () => {
    const all = [cover, capsule, header, hero, logo, shot(1)];
    expect(pickArt(all, 1 / 1.38)?.url).toBe(cover.url);
    expect(pickArt(all, 16 / 10)).toEqual({ url: capsule.url, kind: "capsule", whole: true });
    // A lettered image of the box's exact shape fills it.
    expect(pickArt([capsule], 616 / 353)).toEqual({ url: capsule.url, kind: "capsule" });
  });

  it("never crops a header's logo into a 16:10 card: the hero gets the logo over it instead", () => {
    // Mass Effect 2 had only a header, a hero and a logo: the header lost the left of its logo.
    expect(pickArt([cover, header, hero, logo], 16 / 10)).toEqual({ url: hero.url, kind: "hero", position: "center 35%", logo: logo.url });
  });

  it("without a logo, takes clean art of a near shape before a cropped lettered image", () => {
    expect(pickArt([cover, header, shot(1)], 16 / 10)?.url).toBe(shot(1).url);
  });

  it("falls back to the closest image, a portrait cover in a wide box included", () => {
    expect(pickArt([cover], 16 / 10)).toEqual({ url: cover.url, kind: "cover" });
    expect(pickArt([], 16 / 10)).toBeNull();
  });
});

describe("pickArt (scene: a news story)", () => {
  it("prefers clean art, varied by the seed, and never puts a logo under a headline", () => {
    const all = [capsule, hero, logo, shot(1), shot(2), shot(3)];
    const a = pickArt(all, 16 / 10, { mode: "scene", seed: "story-a" });
    expect(a?.kind).toBe("screenshot");
    expect(a?.logo).toBeUndefined();
    const picks = new Set(["x", "yy", "zzz", "story-b", "story-c"].map((seed) => pickArt(all, 16 / 10, { mode: "scene", seed })?.url));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("takes the hero for a 21:9 top and skips images already in the article", () => {
    expect(pickArt([hero, shot(1)], 21 / 9, { mode: "scene" })?.url).toBe(hero.url);
    expect(pickArt([shot(1), shot(2)], 16 / 9, { mode: "scene", exclude: new Set([shot(1).url]) })?.url).toBe(shot(2).url);
  });
});

describe("artAssets", () => {
  it("joins media rows and columns, https only, without repeats", () => {
    const assets = artAssets({
      coverUrl: cover.url,
      heroUrl: hero.url,
      logoUrl: "http://insecure/logo.png",
      media: [
        { kind: "cover", url: cover.url },
        { kind: "artwork", url: `${STEAM}/header.jpg`, width: 460, height: 215 },
        { kind: "video", url: "https://x/v.mp4" },
      ],
    });
    expect(assets.map((a) => a.kind)).toEqual(["cover", "header", "hero"]);
  });
});

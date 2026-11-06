import { describe, expect, it } from "vitest";
import { articleHero, gameScene, type GameRow } from "./news";

const igdb = (size: string, id: string) => `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`;

const game: GameRow = {
  slug: "hades-ii",
  name: "Hades II",
  heroUrl: null,
  coverUrl: igdb("cover_big", "cover"),
  media: [
    { kind: "screenshot", url: igdb("screenshot_big", "a") },
    { kind: "screenshot", url: igdb("screenshot_big", "b") },
  ],
};

describe("gameScene", () => {
  it("never picks, as the hero, an image the article body already shows", () => {
    for (const seed of ["um", "dois", "tres", "quatro", "cinco", "seis"]) {
      expect(gameScene([game], seed, new Set([igdb("1080p", "a")]))).toBe(igdb("1080p", "b"));
      expect(gameScene([game], seed, new Set([igdb("screenshot_big", "b")]))).toBe(igdb("1080p", "a"));
    }
  });

  it("falls back to the full list when the body already uses every image", () => {
    const scene = gameScene([game], "um", new Set([igdb("1080p", "a"), igdb("1080p", "b")]));
    expect([igdb("1080p", "a"), igdb("1080p", "b")]).toContain(scene);
  });

  it("without exclusions picks among hero and screenshots, then the cover", () => {
    expect([igdb("1080p", "a"), igdb("1080p", "b")]).toContain(gameScene([game], "x"));
    expect(gameScene([{ ...game, media: [] }], "x")).toBe(igdb("1080p", "cover"));
  });
});

describe("articleHero (the 21:9 header of the article page)", () => {
  // the-elder-scrolls-vi: only a portrait cover (the logo on black) in the catalog.
  const portraitOnly: GameRow = {
    slug: "the-elder-scrolls-vi",
    name: "The Elder Scrolls VI",
    heroUrl: null,
    coverUrl: igdb("cover_big", "tes6"),
    media: [{ kind: "cover", url: igdb("cover_big", "tes6"), width: 600, height: 900 }],
  };

  it("a game with only a portrait cover gives the company's official picture, never the cropped cover", async () => {
    const hero = await articleHero([portraitOnly], "tes-vi-sentinel", [], "Bethesda revela o nome de The Elder Scrolls VI");
    expect(hero.heroArt).toBeNull();
    expect(hero.heroUrl).toBe("/acervo/bethesda.webp");
  });

  it("without a company picture it gives nothing, so the page draws the generic illustration", async () => {
    const hero = await articleHero([portraitOnly], "tes-vi-sentinel", [], "Novo teaser de The Elder Scrolls VI indica Hammerfell");
    expect(hero).toMatchObject({ heroArt: null, heroUrl: null });
  });

  it("a game with wide art keeps its art and scene", async () => {
    const hero = await articleHero([game], "um", [], "Hades II ganha arma nova");
    expect(hero.heroArt?.some((a) => a.kind === "screenshot")).toBe(true);
    expect([igdb("1080p", "a"), igdb("1080p", "b")]).toContain(hero.heroUrl);
  });

  it("the first game WITH wide art lends it when the first one has only a cover", async () => {
    const hero = await articleHero([portraitOnly, game], "um", [], "The Elder Scrolls VI e Hades II");
    expect(hero.heroArt?.some((a) => a.url.includes("/a.jpg") || a.url.includes("/b.jpg"))).toBe(true);
  });

  it("lists the body's images to skip", async () => {
    const hero = await articleHero([game], "um", [{ type: "image", url: "https://blob.test/1.webp", alt: "x", credit: "y" }], "x");
    expect(hero.heroExclude).toEqual(["https://blob.test/1.webp"]);
  });
});

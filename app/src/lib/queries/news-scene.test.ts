import { describe, expect, it } from "vitest";
import { gameScene, type GameRow } from "./news";

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

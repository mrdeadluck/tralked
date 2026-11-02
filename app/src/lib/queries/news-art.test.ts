import { describe, expect, it } from "vitest";
import { cardArt, type GameRow } from "./news";

const game: GameRow = {
  slug: "zelda-oot",
  name: "The Legend of Zelda: Ocarina of Time",
  heroUrl: null,
  coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co9abc.jpg",
  media: [
    { kind: "artwork", url: "https://images.igdb.com/igdb/image/upload/t_1080p/ar1xyz.jpg", width: 1920, height: 1080 },
    { kind: "screenshot", url: "https://images.igdb.com/igdb/image/upload/t_1080p/sc2qwe.jpg", width: 1920, height: 1080 },
  ],
};

describe("cardArt", () => {
  it("gives a card the game's images when the article has no picture of its own", () => {
    expect(cardArt([game], null)?.map((a) => a.kind)).toEqual(["artwork", "screenshot", "cover"]);
  });

  it("also when the article opens with one of the game's images, at any IGDB size", () => {
    expect(cardArt([game], "https://images.igdb.com/igdb/image/upload/t_720p/ar1xyz.jpg")).not.toBeNull();
  });

  it("keeps an article's own picture as it is", () => {
    expect(cardArt([game], "https://press.example.com/photo.jpg")).toBeNull();
  });
});

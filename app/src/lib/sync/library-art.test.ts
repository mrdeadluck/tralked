import { describe, expect, it } from "vitest";
import { libraryArtUpdate } from "./library-art";

const COVER = { url: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/abc/library_capsule_2x.jpg", width: 600, height: 900 };
const HERO = { url: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/def/library_hero.jpg", width: 3840, height: 1240 };
const HEADER = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/abc/header.jpg?t=1";

describe("libraryArtUpdate", () => {
  it("puts the portrait over a blank or a wide stand-in cover, and the hero over a blank", () => {
    expect(libraryArtUpdate({ coverUrl: null, heroUrl: null }, { cover: COVER, hero: HERO })).toEqual({
      coverUrl: COVER.url,
      heroUrl: HERO.url,
    });
    expect(libraryArtUpdate({ coverUrl: HEADER, heroUrl: "https://x/hero.png" }, { cover: COVER, hero: HERO })).toEqual({
      coverUrl: COVER.url,
    });
  });

  it("keeps a real portrait (SteamGridDB, IGDB) and writes nothing without store art", () => {
    const igdb = "https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg";
    expect(libraryArtUpdate({ coverUrl: igdb, heroUrl: null }, { cover: COVER })).toEqual({});
    expect(libraryArtUpdate({ coverUrl: null, heroUrl: null }, undefined)).toEqual({});
  });
});

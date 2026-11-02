import { describe, expect, it } from "vitest";
import { cleanName, fetchStoreApp, htmlToText, libraryAssetUrls, parseStoreApp, parseStoreAssets, parseStoreDate } from "./store";
import { fetchMostOwnedPage, fetchTags, fetchTopList, parseOwners, rankByOwners } from "./steamspy";

// Trimmed from the real `appdetails?appids=367520&l=brazilian` answer (31/10/2026).
const hollowKnight = {
  "367520": {
    success: true,
    data: {
      type: "game",
      name: "Hollow Knight",
      short_description: "Forje seu caminho em <b>Hollow Knight</b>! Uma aventura &quot;épica&quot;<br>em um reino.",
      developers: ["Team Cherry"],
      publishers: ["Team Cherry"],
      release_date: { coming_soon: false, date: "24/fev./2017" },
      metacritic: { score: 87 },
      achievements: { total: 63 },
      header_image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/367520/h/header.jpg?t=1",
      screenshots: [
        { path_full: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/367520/ss_a.1920x1080.jpg?t=1" },
        { path_full: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/367520/ss_b.jpg" },
      ],
      movies: [
        {
          id: 256679401,
          name: "Release Trailer",
          thumbnail: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/256679401/movie.293x165.jpg",
          hls_h264: "https://video.akamai.steamstatic.com/x/hls.m3u8",
        },
        { id: 2, name: "Old", mp4: { max: "https://cdn.akamai.steamstatic.com/steam/apps/2/movie_max.mp4" } },
        // Not on Steam's CDN: dropped (media is hotlinked as is).
        { id: 9, name: "Elsewhere", mp4: { max: "http://evil.example/movie.mp4" } },
        { id: 3, name: "Third" },
        { id: 4, name: "Fourth" },
        { id: 5, name: "Fifth" },
      ],
    },
  },
};

describe("store", () => {
  it("parses the pt-BR store page into plain fields", () => {
    const app = parseStoreApp(367520, hollowKnight);
    expect(app).toMatchObject({
      appId: 367520,
      type: "game",
      name: "Hollow Knight",
      summary: 'Forje seu caminho em Hollow Knight! Uma aventura "épica" em um reino.',
      developer: "Team Cherry",
      publisher: "Team Cherry",
      releaseDate: new Date(Date.UTC(2017, 1, 24)),
      comingSoon: false,
      criticScore: 87,
      achievementCount: 63,
    });
    expect(app?.screenshots).toEqual([
      { url: expect.stringContaining("ss_a.1920x1080.jpg"), width: 1920, height: 1080 },
      { url: expect.stringContaining("ss_b.jpg") },
    ]);
    expect(app?.trailers).toEqual([
      {
        id: 256679401,
        name: "Release Trailer",
        url: "https://video.akamai.steamstatic.com/store_trailers/256679401/movie_max.mp4",
        thumbnailUrl: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/256679401/movie.293x165.jpg",
      },
      { id: 2, name: "Old", url: "https://cdn.akamai.steamstatic.com/steam/apps/2/movie_max.mp4", thumbnailUrl: undefined },
      expect.objectContaining({ id: 3 }),
      expect.objectContaining({ id: 4 }),
    ]);
  });

  it("keeps only https Steam CDN media", () => {
    const data = structuredClone(hollowKnight);
    data["367520"].data.header_image = "javascript:alert(1)";
    data["367520"].data.screenshots = [{ path_full: "http://shared.akamai.steamstatic.com/ss.jpg" }];
    const app = parseStoreApp(367520, data);
    expect(app?.headerUrl).toBeUndefined();
    expect(app?.screenshots).toEqual([]);
  });

  it("drops trademark signs from names", () => {
    expect(cleanName("Call of Duty®: Black Ops™  III")).toBe("Call of Duty: Black Ops III");
  });

  it("returns null for unknown apps", () => {
    expect(parseStoreApp(1, { "1": { success: false } })).toBeNull();
    expect(parseStoreApp(1, null)).toBeNull();
  });

  it("parses Portuguese store dates", () => {
    expect(parseStoreDate("24/fev./2017")).toEqual(new Date(Date.UTC(2017, 1, 24)));
    expect(parseStoreDate("3 de mar. de 2020")).toEqual(new Date(Date.UTC(2020, 2, 3)));
    expect(parseStoreDate("21/08/2012")).toEqual(new Date(Date.UTC(2012, 7, 21)));
    expect(parseStoreDate("Em breve")).toBeUndefined();
    expect(parseStoreDate("31/02/2020")).toBeUndefined();
    expect(parseStoreDate(undefined)).toBeUndefined();
  });

  it("htmlToText drops markup and decodes entities", () => {
    expect(htmlToText("<p>A &amp; B&#39;s <i>game</i></p>")).toBe("A & B's game");
    // An invalid code point is skipped instead of throwing a RangeError.
    expect(htmlToText("x&#99999999;y&#x110000;z")).toBe("xyz");
  });

  it("fetchStoreApp asks in Brazilian Portuguese and throws on HTTP errors", async () => {
    const urls: string[] = [];
    const ok = async (url: string) => {
      urls.push(url);
      return Response.json(hollowKnight);
    };
    await expect(fetchStoreApp(ok, 367520)).resolves.toMatchObject({ name: "Hollow Knight" });
    expect(urls[0]).toContain("appids=367520&l=brazilian");
    await expect(fetchStoreApp(async () => new Response("", { status: 403 }), 1)).rejects.toThrow(/HTTP 403/);
  });

  it("libraryAssetUrls points at the unhashed library art", () => {
    expect(libraryAssetUrls(367520).cover.url).toBe(
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/367520/library_600x900.jpg",
    );
  });
});

describe("steamspy", () => {
  const top = {
    "10": { appid: 10, name: "Counter-Strike", owners: "10,000,000 .. 20,000,000", ccu: 7323, positive: 243818 },
    "730": { appid: 730, name: "Counter-Strike 2", owners: "50,000,000 .. 100,000,000", ccu: 1_000_000, positive: 1 },
    "70": { appid: 70, name: "Half-Life", owners: "10,000,000 .. 20,000,000", ccu: 100, positive: 1 },
  };

  it("parses owners ranges", () => {
    expect(parseOwners("10,000,000 .. 20,000,000")).toBe(10_000_000);
    expect(parseOwners(undefined)).toBe(0);
  });

  it("ranks the union of the top lists by owners, then players, without duplicates", async () => {
    const list = await fetchTopList(async () => Response.json(top), "top100owned");
    const ranked = rankByOwners([list, [{ appId: 730, name: "Counter-Strike 2", ownersMin: 1, ccu: 0, positive: 0 }]]);
    expect(ranked.map((a) => a.appId)).toEqual([730, 10, 70]);
  });

  it("reads the most-owned page", async () => {
    const urls: string[] = [];
    const page = await fetchMostOwnedPage(async (url) => {
      urls.push(url);
      return Response.json(top);
    });
    expect(urls[0]).toContain("request=all&page=0");
    expect(page.map((a) => a.appId).sort((a, b) => a - b)).toEqual([10, 70, 730]);
    await expect(fetchMostOwnedPage(async () => new Response("", { status: 503 }))).rejects.toThrow(/HTTP 503/);
  });

  it("reads tags, and an empty list when SteamSpy has none", async () => {
    await expect(fetchTags(async () => Response.json({ appid: 1, tags: { RPG: 10 } }), 1)).resolves.toEqual({ RPG: 10 });
    await expect(fetchTags(async () => Response.json({ appid: 1, tags: [] }), 1)).resolves.toEqual({});
  });
});

describe("parseStoreAssets", () => {
  it("builds the hashed library art URLs of GetItems", () => {
    const assets = parseStoreAssets({
      response: {
        store_items: [
          {
            appid: 4115450,
            assets: {
              asset_url_format: "steam/apps/4115450/${FILENAME}?t=1793261976",
              library_capsule: "471e7785/library_capsule.jpg",
              library_capsule_2x: "471e7785/library_capsule_2x.jpg",
              library_hero: "1cd52ca8/library_hero.jpg",
            },
          },
          { appid: 10, assets: { asset_url_format: "steam/apps/10/${FILENAME}" } },
          { appid: 11 },
        ],
      },
    });
    expect(assets.get(4115450)).toEqual({
      cover: {
        url: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4115450/471e7785/library_capsule_2x.jpg?t=1793261976",
        width: 600,
        height: 900,
      },
      hero: {
        url: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4115450/1cd52ca8/library_hero.jpg?t=1793261976",
        width: 3840,
        height: 1240,
      },
    });
    expect(assets.has(10)).toBe(false);
    expect(assets.has(11)).toBe(false);
  });

  it("ignores odd file names and unreadable answers", () => {
    const odd = { response: { store_items: [{ appid: 1, assets: { asset_url_format: "steam/apps/1/${FILENAME}", library_capsule: "../x?y=<b>" } }] } };
    expect(parseStoreAssets(odd).size).toBe(0);
    expect(parseStoreAssets(null).size).toBe(0);
  });
});

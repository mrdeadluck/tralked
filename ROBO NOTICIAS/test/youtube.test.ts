import { describe, expect, it } from "vitest";
import { collectLive, parseFeed } from "../src/collect/index.js";
import { isTrailerVideo, youtubeIdOf } from "../src/collect/youtube.js";
import type { Source } from "../src/config.js";
import { createTralked } from "../src/tralked.js";

const CHANNEL = "https://www.youtube.com/feeds/videos.xml?channel_id=UC-2Y8dQb0S6DtpxNgAKoJKA";

const entry = (id: string, title: string, link = `https://www.youtube.com/watch?v=${id}`) => `
  <entry>
    <id>yt:video:${id}</id>
    <yt:videoId>${id}</yt:videoId>
    <title>${title}</title>
    <link rel="alternate" href="${link}"/>
    <published>2026-10-31T10:00:00+00:00</published>
    <media:group><media:description>Descrição de ${title}.</media:description></media:group>
  </entry>`;

const feed = (...entries: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"><title>PlayStation</title>${entries.join("")}</feed>`;

describe("youtubeIdOf", () => {
  it("reads watch, short, embed and youtu.be links, and nothing else", () => {
    expect(youtubeIdOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1")).toBe("dQw4w9WgXcQ");
    expect(youtubeIdOf("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeIdOf("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeIdOf("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeIdOf("https://evil.test/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youtubeIdOf("https://www.youtube.com/watch?v=short")).toBeNull();
  });
});

describe("isTrailerVideo", () => {
  const watch = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  it.each([
    ["Kiborg - Body Split Update Trailer | PS5 & PS4 Games", true],
    ["Look Outside - Launch Trailer | PS5 & PS4 Games", true],
    ["Apex Legends: Trailer de Jogabilidade – Cipher", true],
    ["Gears of War: E-Day - Official Gameplay Reveal", true],
    ["【ドラゴンボール レジェンズ】レジェンズフェスティバル2026 ティザーPV", true],
    ["Monster Hunter Wilds - Nintendo Switch 2 Prologue Demo", true],
    ["The Division 2: Echoes of Central Park Launch Livestream", false],
    ["SILENT HILL: Townfall | Accolades Trailer (4K: EN/ESRB) | KONAMI", false],
    ["AnsweRED Podcast Episode 34 | Back to Night City", false],
    ["BlizzCon 2026 | Classic Cup: StarCraft Remastered | Entertainment Match", false],
    ["LEGO Batman: Legacy of the Dark Knight - Sale Promo", false],
    ["Find the perfect look to haunt Ezo this Halloween weekend.", false],
  ])("%s → %s", (title, expected) => {
    expect(isTrailerVideo(title, watch)).toBe(expected);
  });

  it("never keeps a Short", () => {
    expect(isTrailerVideo("Official Trailer", "https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(false);
  });
});

describe("YouTube channel feeds", () => {
  it("parseFeed keeps the video id and the description", () => {
    const [item] = parseFeed(feed(entry("AAAAAAAAAAA", "Hades II - Launch Trailer")), "yt");
    expect(item).toMatchObject({
      url: "https://www.youtube.com/watch?v=AAAAAAAAAAA",
      videoId: "AAAAAAAAAAA",
      summary: "Descrição de Hades II - Launch Trailer.",
    });
  });

  it("collectLive keeps only trailers of a video source, as title-only items", async () => {
    const source: Source = {
      id: "yt",
      name: "PlayStation (YouTube channel)",
      kind: "rss",
      url: CHANNEL,
      tier: "oficial",
      category: "GAMES",
      gamingFilter: false,
      video: true,
      active: true,
    };
    const xml = feed(
      entry("AAAAAAAAAAA", "Hades II - Launch Trailer"),
      entry("BBBBBBBBBBB", "Hades II Launch Livestream"),
      entry("CCCCCCCCCCC", "Hades II - Official Trailer", "https://www.youtube.com/shorts/CCCCCCCCCCC"),
    );
    const fetchFn = async (url: string) => (url === CHANNEL ? new Response(xml, { status: 200 }) : new Response("", { status: 404 }));
    const { items, failures } = await collectLive([source], fetchFn);
    expect(failures).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ videoId: "AAAAAAAAAAA", textUnavailable: true, sourceId: "yt" });
  });
});

describe("site media endpoint", () => {
  it("GET /api/v1/games/{slug}/media, null on 404", async () => {
    const urls: string[] = [];
    const body = { game: { slug: "hades-ii", name: "Hades II", developer: null, publisher: null }, images: [], videos: [{ youtubeId: "AAAAAAAAAAA" }] };
    const replies = [new Response(JSON.stringify(body), { status: 200 }), new Response(JSON.stringify({ error: { code: "not_found" } }), { status: 404 })];
    const client = createTralked({
      baseUrl: "https://tralked.test",
      key: "k",
      fetchFn: (async (url: string) => {
        urls.push(String(url));
        return replies.shift()!;
      }) as typeof fetch,
    });
    await expect(client.media("hades-ii")).resolves.toEqual(body);
    await expect(client.media("nope")).resolves.toBeNull();
    expect(urls).toEqual(["https://tralked.test/api/v1/games/hades-ii/media", "https://tralked.test/api/v1/games/nope/media"]);
  });
});

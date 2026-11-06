import { describe, expect, it, vi } from "vitest";
import type { Source } from "../src/config.js";
import type { ItemRow, StoryRow } from "../src/db.js";
import { VIDEO_MAX_AGE_MS, aboutVideo, channelVideoFor, officialSourceVideo, videoPublishedAt } from "../src/media/video.js";

const SOURCES: Source[] = [
  { id: "ign", name: "IGN", kind: "rss", url: "https://feeds.test/ign.xml", tier: "portal", category: "GAMES", gamingFilter: false, active: true },
  {
    id: "beth-yt",
    name: "Bethesda Softworks (YouTube channel)",
    kind: "rss",
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=x",
    tier: "oficial",
    category: "GAMES",
    gamingFilter: false,
    video: true,
    active: true,
  },
];

let nextId = 1;
const item = (over: Partial<ItemRow> = {}, youtube: string[] = []): ItemRow => ({
  id: nextId++,
  url: `https://www.ign.com/a${nextId}`,
  source_id: "ign",
  title: "The Elder Scrolls VI is called Sentinel",
  summary: null,
  published_at: null,
  fetched_at: "2026-11-03T12:00:00Z",
  content_hash: null,
  text: "x",
  status: "clustered",
  triage_json: null,
  publisher: null,
  text_unavailable: 0,
  video_id: null,
  media_json: JSON.stringify({ images: [], youtube, posts: [] }),
  ...over,
});

/** The story broke on 03/11 (Sentinel). */
const STORY_AT = new Date("2026-11-03T15:00:00Z");

/** A YouTube watch page carrying its publication date the way YouTube writes it. */
const watchPage = (published: string) =>
  `<!DOCTYPE html><html><head><meta itemprop="name" content="x"></head><body><div id="watch7-content"><meta itemprop="datePublished" content="${published}"></div></body></html>`;

/**
 * oEmbed answers and watch pages by video id (published on 03/11 unless `published` says otherwise;
 * `published: null` serves a page without a date); anything else is a 404.
 */
function oembed(videos: Record<string, { title: string; author_name: string; published?: string | null }>) {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.pathname === "/watch") {
      const v = videos[u.searchParams.get("v")!];
      if (!v) return new Response("no", { status: 404 });
      const published = v.published === undefined ? "2026-11-03T07:07:34-08:00" : v.published;
      return new Response(published === null ? "<html><body>sem data</body></html>" : watchPage(published), { status: 200 });
    }
    const id = new URL(u.searchParams.get("url")!).searchParams.get("v")!;
    const v = videos[id];
    return v
      ? new Response(JSON.stringify({ title: v.title, author_name: v.author_name }), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("no", { status: 404 });
  });
}

const input = (items: ItemRow[]) => ({ items, sources: SOURCES, games: ["The Elder Scrolls VI"], companies: ["Bethesda"], storyAt: STORY_AT });

describe("officialSourceVideo", () => {
  it("takes the official channel's video about the game the story is about", async () => {
    const fetchFn = oembed({ AAAAAAAAAAA: { title: "The Elder Scrolls VI: Official Name Reveal", author_name: "Bethesda Softworks" } });
    expect(await officialSourceVideo(input([item({}, ["AAAAAAAAAAA"])]), fetchFn)).toEqual({
      youtubeId: "AAAAAAAAAAA",
      title: "The Elder Scrolls VI: Official Name Reveal",
      channel: "Bethesda Softworks",
    });
    expect(String(fetchFn.mock.calls[0]![0])).toBe(
      "https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DAAAAAAAAAAA&format=json",
    );
  });

  it("refuses a news site's channel (a reaction video), and an official video about something else", async () => {
    const fetchFn = oembed({
      BBBBBBBBBBB: { title: "TES 6 trailer reaction", author_name: "IGN" },
      CCCCCCCCCCC: { title: "Fallout 76 - Official Season Trailer", author_name: "Bethesda Softworks" },
    });
    expect(await officialSourceVideo(input([item({}, ["BBBBBBBBBBB", "CCCCCCCCCCC"])]), fetchFn)).toBeNull();
  });

  it("a channel named exactly after one of the story's companies counts as official; one that only contains it does not", async () => {
    const fetchFn = oembed({
      DDDDDDDDDDD: { title: "The Elder Scrolls VI teaser", author_name: "Bethesda" },
      FFFFFFFFFFF: { title: "Pokémon Legends: Z-A – Our Honest Reaction", author_name: "Nintendo Life" },
    });
    expect((await officialSourceVideo(input([item({}, ["DDDDDDDDDDD"])]), fetchFn))?.youtubeId).toBe("DDDDDDDDDDD");
    const pokemon = { ...input([item({}, ["FFFFFFFFFFF"])]), games: ["Pokémon Legends: Z-A"], companies: ["Nintendo"] };
    expect(await officialSourceVideo(pokemon, fetchFn)).toBeNull();
  });

  it("the name without subtitle counts only when it ends in a number (not another game of the series)", async () => {
    const fetchFn = oembed({ GGGGGGGGGGG: { title: "Call of Duty: Warzone – Season 3 Official Trailer", author_name: "Bethesda Softworks" } });
    const cod = { ...input([item({}, ["GGGGGGGGGGG"])]), games: ["Call of Duty: Black Ops 7"] };
    expect(await officialSourceVideo(cod, fetchFn)).toBeNull();
  });

  it("without games, the title must name one of the story's companies and be a trailer", async () => {
    const fetchFn = oembed({
      EEEEEEEEEEE: { title: "Bethesda Showcase 2026 - Official Trailer", author_name: "Bethesda Softworks" },
      HHHHHHHHHHH: { title: "DOOM: The Dark Ages - Official Trailer", author_name: "Bethesda Softworks" },
    });
    const noGame = (ids: string[]) => ({ ...input([item({}, ids)]), games: [] });
    expect((await officialSourceVideo(noGame(["EEEEEEEEEEE"]), fetchFn))?.youtubeId).toBe("EEEEEEEEEEE");
    expect(await officialSourceVideo(noGame(["HHHHHHHHHHH"]), fetchFn)).toBeNull();
  });

  it("an old official video the source cites (the 2018 teaser) is refused; the new one is taken (story 4929)", async () => {
    const fetchFn = oembed({
      OkFdqqyI8y4: { title: "The Elder Scrolls VI – Official Announcement Teaser", author_name: "Bethesda Softworks", published: "2018-06-10T19:54:48-07:00" },
      mFu8t9735IY: { title: "The Elder Scrolls VI – Official Name Reveal", author_name: "Bethesda Softworks", published: "2026-11-03T07:07:34-08:00" },
    });
    expect((await officialSourceVideo(input([item({}, ["OkFdqqyI8y4", "mFu8t9735IY"])]), fetchFn))?.youtubeId).toBe("mFu8t9735IY");
    expect(fetchFn.mock.calls.map((c) => String(c[0]))).toContain("https://www.youtube.com/watch?v=OkFdqqyI8y4");
  });

  it("a video published a few days before the story passes; one older than the limit, or without a readable date, does not", async () => {
    const days = (n: number) => new Date(STORY_AT.getTime() - n * 86_400_000).toISOString();
    const fetchFn = oembed({
      AAAAAAAAAA1: { title: "The Elder Scrolls VI teaser", author_name: "Bethesda Softworks", published: days(5) },
      AAAAAAAAAA2: { title: "The Elder Scrolls VI teaser", author_name: "Bethesda Softworks", published: days(VIDEO_MAX_AGE_MS / 86_400_000 + 1) },
      AAAAAAAAAA3: { title: "The Elder Scrolls VI teaser", author_name: "Bethesda Softworks", published: null },
    });
    expect((await officialSourceVideo(input([item({}, ["AAAAAAAAAA1"])]), fetchFn))?.youtubeId).toBe("AAAAAAAAAA1");
    expect(await officialSourceVideo(input([item({}, ["AAAAAAAAAA2"])]), fetchFn)).toBeNull();
    expect(await officialSourceVideo(input([item({}, ["AAAAAAAAAA3"])]), fetchFn)).toBeNull();
  });

  it("oEmbed failures cost only that video; at most 5 lookups", async () => {
    const ids = ["AAAAAAAAAA1", "AAAAAAAAAA2", "AAAAAAAAAA3", "AAAAAAAAAA4", "AAAAAAAAAA5", "AAAAAAAAAA6"];
    const fetchFn = vi.fn(async () => Promise.reject(new Error("offline")));
    expect(await officialSourceVideo(input([item({}, ids)]), fetchFn)).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });
});

describe("channelVideoFor", () => {
  const channelItem = (title: string, publishedAt: string, over: Partial<ItemRow> = {}) =>
    item({ source_id: "beth-yt", title, published_at: publishedAt, video_id: "mFu8t9735IY", url: "https://www.youtube.com/watch?v=mFu8t9735IY", ...over });
  const at = (games: string[]) => ({ sources: SOURCES, games, storyAt: STORY_AT });

  it("an official channel's video naming the story's game, published close to it, is the story's video (story 4929)", () => {
    const reveal = channelItem("The Elder Scrolls VI: Official Name Reveal", "2026-11-03T15:07:34Z");
    expect(channelVideoFor({ ...at(["The Elder Scrolls VI: Sentinel", "The Elder Scrolls VI"]), candidates: [reveal] })).toEqual({
      youtubeId: "mFu8t9735IY",
      title: "The Elder Scrolls VI: Official Name Reveal",
      channel: "Bethesda Softworks",
    });
  });

  it("refuses a video of another game, one far from the story, a non-channel item and a story without games", () => {
    const fallout = channelItem("Fallout 76: World Pets Overview", "2026-11-03T15:00:00Z", { video_id: "AAAAAAAAAA1" });
    const old = channelItem("The Elder Scrolls VI – Official Announcement Teaser", "2026-11-01T10:00:00Z", { video_id: "OkFdqqyI8y4" });
    const notChannel = item({ title: "The Elder Scrolls VI trailer", published_at: "2026-11-03T15:00:00Z", video_id: "AAAAAAAAAA2" });
    const games = ["The Elder Scrolls VI"];
    expect(channelVideoFor({ ...at(games), candidates: [fallout, old, notChannel] })).toBeNull();
    expect(channelVideoFor({ ...at([]), candidates: [channelItem("The Elder Scrolls VI reveal", "2026-11-03T15:00:00Z")] })).toBeNull();
  });

  it("takes the one closest to the story", () => {
    const a = channelItem("The Elder Scrolls VI teaser", "2026-11-02T20:00:00Z", { video_id: "AAAAAAAAAA1" });
    const b = channelItem("The Elder Scrolls VI reveal", "2026-11-03T14:00:00Z", { video_id: "AAAAAAAAAA2" });
    expect(channelVideoFor({ ...at(["The Elder Scrolls VI"]), candidates: [a, b] })?.youtubeId).toBe("AAAAAAAAAA2");
  });
});

describe("videoPublishedAt", () => {
  const page = (html: string) => vi.fn(async () => new Response(html, { status: 200 }));

  it("reads the watch page's datePublished, or its publishDate JSON", async () => {
    expect((await videoPublishedAt("OkFdqqyI8y4", page(watchPage("2018-06-10T19:54:48-07:00"))))?.toISOString()).toBe("2018-06-11T02:54:48.000Z");
    const json = page('<script>var ytInitialPlayerResponse = {"microformat":{"playerMicroformatRenderer":{"publishDate":"2026-11-03T07:07:34-08:00"}}};</script>');
    expect((await videoPublishedAt("mFu8t9735IY", json))?.toISOString()).toBe("2026-11-03T15:07:34.000Z");
  });

  it("null when the page fails, has no date or the id is invalid", async () => {
    expect(await videoPublishedAt("OkFdqqyI8y4", vi.fn(async () => new Response("no", { status: 429 })))).toBeNull();
    expect(await videoPublishedAt("OkFdqqyI8y4", page("<html></html>"))).toBeNull();
    expect(await videoPublishedAt("OkFdqqyI8y4", vi.fn(async () => Promise.reject(new Error("offline"))))).toBeNull();
    const fetchFn = page(watchPage("2026-11-03T07:07:34-08:00"));
    expect(await videoPublishedAt("not/an/id", fetchFn)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("aboutVideo", () => {
  const story = (headline: string) => ({ headline }) as StoryRow;
  it("a story about a trailer, gameplay or reveal; not a DLC story", () => {
    expect(aboutVideo(story("Hades II ganha trailer de lançamento"), [item()])).toBe(true);
    expect(aboutVideo(story("Sentinel"), [item({ title: "Official Gameplay Reveal" })])).toBe(true);
    expect(aboutVideo(story("Hades II recebe DLC grátis"), [item({ title: "Hades II gets free DLC" })])).toBe(false);
    expect(aboutVideo(story("Hades II recebe DLC grátis"), [item({ video_id: "AAAAAAAAAAA" })])).toBe(true);
  });
});

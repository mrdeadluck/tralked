import { describe, expect, it, vi } from "vitest";
import type { Source } from "../src/config.js";
import type { ItemRow, StoryRow } from "../src/db.js";
import { aboutVideo, officialSourceVideo } from "../src/media/video.js";

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

/** oEmbed answers by video id; anything else is a 404. */
function oembed(videos: Record<string, { title: string; author_name: string }>) {
  return vi.fn(async (url: string) => {
    const id = new URL(new URL(url).searchParams.get("url")!).searchParams.get("v")!;
    const v = videos[id];
    return v ? new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } }) : new Response("no", { status: 404 });
  });
}

const input = (items: ItemRow[]) => ({ items, sources: SOURCES, games: ["The Elder Scrolls VI"], companies: ["Bethesda"] });

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

  it("a channel named after one of the story's companies counts as official", async () => {
    const fetchFn = oembed({ DDDDDDDDDDD: { title: "The Elder Scrolls VI teaser", author_name: "Bethesda Game Studios" } });
    expect((await officialSourceVideo(input([item({}, ["DDDDDDDDDDD"])]), fetchFn))?.youtubeId).toBe("DDDDDDDDDDD");
  });

  it("without games, a trailer word in the title is enough", async () => {
    const fetchFn = oembed({ EEEEEEEEEEE: { title: "Xbox Games Showcase 2026 - Official Trailer", author_name: "Bethesda Softworks" } });
    const out = await officialSourceVideo({ ...input([item({}, ["EEEEEEEEEEE"])]), games: [] }, fetchFn);
    expect(out?.youtubeId).toBe("EEEEEEEEEEE");
  });

  it("oEmbed failures cost only that video; at most 5 lookups", async () => {
    const ids = ["AAAAAAAAAA1", "AAAAAAAAAA2", "AAAAAAAAAA3", "AAAAAAAAAA4", "AAAAAAAAAA5", "AAAAAAAAAA6"];
    const fetchFn = vi.fn(async () => Promise.reject(new Error("offline")));
    expect(await officialSourceVideo(input([item({}, ids)]), fetchFn)).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(5);
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

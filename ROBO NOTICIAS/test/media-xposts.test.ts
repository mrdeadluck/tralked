import { describe, expect, it, vi } from "vitest";
import type { ItemRow } from "../src/db.js";
import { loadXProfiles, storyPosts } from "../src/media/xposts.js";

let nextId = 1;
const item = (posts: { handle: string; statusId: string }[]): ItemRow => ({
  id: nextId++,
  url: `https://www.ign.com/a${nextId}`,
  source_id: "ign",
  title: "t",
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
  media_json: JSON.stringify({
    images: [],
    youtube: [],
    posts: posts.map((p) => ({ ...p, url: `https://x.com/${p.handle}/status/${p.statusId}` })),
  }),
});

const embed = (name: string, handle: string, text: string, date: string) => ({
  author_name: name,
  author_url: `https://twitter.com/${handle}`,
  html: `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">${text} <a href="https://t.co/abc">pic.twitter.com/abc</a></p>&mdash; ${name} (@${handle}) <a href="https://twitter.com/${handle}/status/1?ref_src=twsrc%5Etfw">${date}</a></blockquote>\n`,
});

/** publish.twitter.com answers by status id. */
function oembed(byId: Record<string, ReturnType<typeof embed>>) {
  return vi.fn(async (url: string) => {
    const target = new URL(url).searchParams.get("url")!;
    const id = target.split("/").pop()!;
    const v = byId[id];
    return v ? new Response(JSON.stringify(v), { status: 200 }) : new Response("no", { status: 404 });
  });
}

const PROFILES = [{ handle: "bethesda", name: "Bethesda" }];

describe("storyPosts", () => {
  it("an official profile's post is taken, with text, author and date from oEmbed", async () => {
    const fetchFn = oembed({ "11": embed("Bethesda", "bethesda", "The next chapter &amp; more.", "November 3, 2026") });
    const posts = await storyPosts({ items: [item([{ handle: "bethesda", statusId: "11" }])], rumor: false, sourceTexts: [] }, fetchFn, PROFILES);
    expect(posts).toEqual([
      {
        official: true,
        url: "https://x.com/bethesda/status/11",
        authorName: "Bethesda",
        authorHandle: "bethesda",
        text: "The next chapter & more.",
        postedAt: "2026-11-03T12:00:00.000Z",
      },
    ]);
    const called = new URL(String(fetchFn.mock.calls[0]![0]));
    expect(called.origin + called.pathname).toBe("https://publish.twitter.com/oembed");
    expect(called.searchParams.get("omit_script")).toBe("true");
    expect(called.searchParams.get("dnt")).toBe("true");
  });

  it("a fan's post is refused in a regular story and taken in a rumor", async () => {
    const fetchFn = oembed({ "12": embed("Fan 123", "fan123", "TES 6 leak!", "November 2, 2026") });
    const items = [item([{ handle: "fan123", statusId: "12" }])];
    expect(await storyPosts({ items, rumor: false, sourceTexts: ["Bethesda revealed the name."] }, fetchFn, PROFILES)).toEqual([]);
    expect(await storyPosts({ items, rumor: true, sourceTexts: [] }, fetchFn, PROFILES)).toHaveLength(1);
  });

  it("the post of someone the sources quote is taken", async () => {
    const fetchFn = oembed({ "13": embed("Jason Schreier", "jasonschreier", "Hearing that...", "November 1, 2026") });
    const items = [item([{ handle: "jasonschreier", statusId: "13" }])];
    const posts = await storyPosts({ items, rumor: false, sourceTexts: ["According to Jason Schreier, the game..."] }, fetchFn, PROFILES);
    expect(posts.map((p) => p.authorHandle)).toEqual(["jasonschreier"]);
    const byHandle = await storyPosts({ items, rumor: false, sourceTexts: ["Via @JasonSchreier on X"] }, fetchFn, PROFILES);
    expect(byHandle).toHaveLength(1);
  });

  it("an oEmbed failure drops the post without breaking; at most 2 posts, no repeats, in source order", async () => {
    const fetchFn = oembed({
      "21": embed("Bethesda", "bethesda", "One", "November 3, 2026"),
      "22": embed("Bethesda", "bethesda", "Two", "November 3, 2026"),
      "23": embed("Bethesda", "bethesda", "Three", "November 3, 2026"),
    });
    const items = [
      item([
        { handle: "bethesda", statusId: "20" },
        { handle: "bethesda", statusId: "21" },
      ]),
      item([
        { handle: "bethesda", statusId: "21" },
        { handle: "bethesda", statusId: "22" },
        { handle: "bethesda", statusId: "23" },
      ]),
    ];
    const posts = await storyPosts({ items, rumor: false, sourceTexts: [] }, fetchFn, PROFILES);
    expect(posts.map((p) => p.text)).toEqual(["One", "Two"]);
    const broken = vi.fn(async () => Promise.reject(new Error("offline")));
    expect(await storyPosts({ items, rumor: false, sourceTexts: [] }, broken, PROFILES)).toEqual([]);
  });

  it("I4: a fan account named after the game is not 'quoted' just because the sources name the game", async () => {
    const fetchFn = oembed({ "31": embed("GTA 6", "gta6countdown", "GTA 6 in 14 days!", "November 5, 2026") });
    const items = [item([{ handle: "gta6countdown", statusId: "31" }])];
    const story = { items, rumor: false, sourceTexts: ["Rockstar released new GTA 6 screenshots."], games: ["GTA 6"], companies: ["Rockstar Games"] };
    expect(await storyPosts(story, fetchFn, PROFILES)).toEqual([]);
  });

  it("I4: an outlet's own account is not quoted by its own name", async () => {
    const fetchFn = oembed({ "32": embed("Insider Gaming", "InsiderGamingIG", "Exclusive: TES VI news", "November 5, 2026") });
    const items = [item([{ handle: "InsiderGamingIG", statusId: "32" }])];
    const story = { items, rumor: false, sourceTexts: ["Insider Gaming reports..."], outlets: ["Insider Gaming"] };
    expect(await storyPosts(story, fetchFn, PROFILES)).toEqual([]);
  });

  it("I4: with games, an official post must be about one of them (or its series)", async () => {
    const fetchFn = oembed({
      "41": embed("Bethesda", "bethesda", "Today we're sharing the name of the next Elder Scrolls title.", "November 3, 2026"),
      "42": embed("Bethesda", "bethesda", "DOOM: The Dark Ages DLC is out now.", "November 3, 2026"),
    });
    const items = [
      item([
        { handle: "bethesda", statusId: "41" },
        { handle: "bethesda", statusId: "42" },
      ]),
    ];
    const posts = await storyPosts({ items, rumor: false, sourceTexts: [], games: ["The Elder Scrolls VI: Sentinel"] }, fetchFn, PROFILES);
    expect(posts.map((p) => p.text)).toEqual(["Today we're sharing the name of the next Elder Scrolls title."]);
  });

  it("M10: posts say whether their author is an official profile", async () => {
    const fetchFn = oembed({ "51": embed("Fan 123", "fan123", "Leak!", "November 2, 2026"), "52": embed("Bethesda", "bethesda", "Hi", "November 2, 2026") });
    const items = [item([{ handle: "fan123", statusId: "51" }, { handle: "bethesda", statusId: "52" }])];
    const posts = await storyPosts({ items, rumor: true, sourceTexts: [] }, fetchFn, PROFILES);
    expect(posts.map((p) => [p.authorHandle, p.official])).toEqual([
      ["fan123", false],
      ["bethesda", true],
    ]);
  });

  it("the profiles file is valid", () => {
    const profiles = loadXProfiles();
    expect(profiles.length).toBeGreaterThan(20);
    for (const p of profiles) expect(p.handle).toMatch(/^[A-Za-z0-9_]{1,15}$/);
    expect(profiles.some((p) => p.handle === "bethesda")).toBe(true);
  });
});

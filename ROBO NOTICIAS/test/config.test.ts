import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, loadSources } from "../src/config.js";

const baseEnv = { ANTHROPIC_API_KEY: "sk-test", TRALKED_API_KEY: "tk-test" };

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig(baseEnv);
    expect(c.TRALKED_API_URL).toBe("https://tralked.com");
    expect(c.MODEL_WRITER).toBe("claude-opus-5-5");
    expect(c.MODEL_FAST).toBe("claude-haiku-5-5");
    expect(c.DAILY_BUDGET_USD).toBe(5);
    expect(c.BACKFILL_BUDGET_USD).toBe(70);
    expect(c.MAX_PER_DAY).toBe(20);
    expect(c.SLOT_FIRST_HOUR).toBe(6);
    expect(c.SLOT_LAST_HOUR).toBe(23);
    expect(c.BACKFILL_DAYS).toBe(90);
    expect(c.BACKFILL_TOTAL).toBe(750);
    expect(c.DATA_DIR).toBe("./data");
    expect(c.RESEND_API_KEY).toBeUndefined();
    expect(c.ALERT_EMAIL).toBeUndefined();
  });

  it("coerces numeric strings from the environment", () => {
    const c = loadConfig({ ...baseEnv, DAILY_BUDGET_USD: "2.5", MAX_PER_DAY: "10" });
    expect(c.DAILY_BUDGET_USD).toBe(2.5);
    expect(c.MAX_PER_DAY).toBe(10);
  });

  it("treats empty optional values as unset", () => {
    const c = loadConfig({ ...baseEnv, RESEND_API_KEY: "", ALERT_EMAIL: "", TRALKED_API_URL: "" });
    expect(c.RESEND_API_KEY).toBeUndefined();
    expect(c.TRALKED_API_URL).toBe("https://tralked.com");
  });

  it("runs on Claude Code by default, without ANTHROPIC_API_KEY", () => {
    const c = loadConfig({ TRALKED_API_KEY: "tk" });
    expect(c.AI_BACKEND).toBe("claude-code");
    expect(c.CLAUDE_BIN).toBe("claude");
    expect(c.CLAUDE_WEEKLY_STOP).toBe(0.9);
  });

  it("throws naming ANTHROPIC_API_KEY when the API backend has no key", () => {
    expect(() => loadConfig({ TRALKED_API_KEY: "tk", AI_BACKEND: "api" })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("throws naming TRALKED_API_KEY when it is missing", () => {
    expect(() => loadConfig({ ANTHROPIC_API_KEY: "sk" })).toThrow(/TRALKED_API_KEY/);
  });
});

function writeSources(data: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "robo-fontes-"));
  const p = join(dir, "fontes.json");
  writeFileSync(p, JSON.stringify(data));
  return p;
}

const validSource = {
  id: "ign",
  name: "IGN",
  kind: "rss",
  url: "https://example.com/feed",
  tier: "portal",
  category: "GAMES",
  gamingFilter: false,
  active: true,
};

describe("loadSources", () => {
  it("loads a valid file", () => {
    const list = loadSources(writeSources([validSource]));
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("ign");
  });

  it("rejects an unknown category", () => {
    expect(() => loadSources(writeSources([{ ...validSource, category: "GUIAS" }]))).toThrow(/category/);
  });

  const gnUrl = "https://news.google.com/rss/search?q=site:example.com&hl=en-US&gl=US&ceid=US:en";

  it("accepts linkResolve google-news on a Google News url", () => {
    const list = loadSources(writeSources([{ ...validSource, url: gnUrl, linkResolve: "google-news" }]));
    expect(list[0]?.linkResolve).toBe("google-news");
  });

  it("leaves linkResolve undefined when absent", () => {
    expect(loadSources(writeSources([validSource]))[0]?.linkResolve).toBeUndefined();
  });

  it("rejects an unknown linkResolve value", () => {
    expect(() =>
      loadSources(writeSources([{ ...validSource, url: gnUrl, linkResolve: "bing" }])),
    ).toThrow(/linkResolve/);
  });

  it("rejects linkResolve google-news on a non-Google-News url", () => {
    expect(() =>
      loadSources(writeSources([{ ...validSource, linkResolve: "google-news" }])),
    ).toThrow(/news\.google\.com/);
  });

  it("reports a malformed url with linkResolve as a validation error, not a TypeError", () => {
    const run = () => loadSources(writeSources([{ ...validSource, url: "not a url", linkResolve: "google-news" }]));
    expect(run).toThrow(/Invalid sources file/);
    expect(run).not.toThrow(TypeError);
  });

  const ytUrl = "https://www.youtube.com/feeds/videos.xml?channel_id=UC-2Y8dQb0S6DtpxNgAKoJKA";

  it("accepts video on a YouTube channel feed and rejects it anywhere else", () => {
    expect(loadSources(writeSources([{ ...validSource, url: ytUrl, video: true, lang: "en" }]))[0]?.video).toBe(true);
    expect(() => loadSources(writeSources([{ ...validSource, video: true }]))).toThrow(/video/);
    const playlist = "https://www.youtube.com/feeds/videos.xml?playlist_id=PL123";
    expect(() => loadSources(writeSources([{ ...validSource, url: playlist, video: true }]))).toThrow(/video/);
    expect(() => loadSources(writeSources([{ ...validSource, lang: "de" }]))).toThrow(/lang/);
  });

  it("real file: every video source is an active-or-not channel feed with a unique channel", () => {
    const videos = loadSources().filter((s) => s.video);
    expect(videos.length).toBeGreaterThanOrEqual(15);
    const channels = videos.map((s) => new URL(s.url).searchParams.get("channel_id"));
    expect(new Set(channels).size).toBe(channels.length);
    for (const s of videos) expect(s.tier).toBe("oficial");
  });

  it("rejects duplicate ids", () => {
    expect(() => loadSources(writeSources([validSource, validSource]))).toThrow(/duplicate/i);
  });

  it("loads the real config/fontes.json", () => {
    const list = loadSources();
    expect(list.length).toBeGreaterThan(20);
    expect(list.some((s) => s.active)).toBe(true);
  });

  it("real file: every google-news source points at news.google.com, and Lucas's named sources are active", () => {
    const list = loadSources();
    for (const s of list.filter((x) => x.linkResolve === "google-news")) {
      expect(new URL(s.url).hostname).toBe("news.google.com");
    }
    const byId = new Map(list.map((s) => [s.id, s]));
    expect(byId.get("digitalfoundry")?.active).toBe(true);
    expect(byId.get("rockstar-newswire")?.active).toBe(true);
  });

  it("real file: Steam, Nintendo, mobile and PC sources checked live on 06/11 are active (B4)", () => {
    const byId = new Map(loadSources().map((s) => [s.id, s]));
    const expected = {
      "steam-blog": { tier: "oficial", url: "https://store.steampowered.com/feeds/news/collection/steam/" },
      "nintendo-europe": { tier: "oficial", url: "https://www.nintendo.com/en-gb/news.xml" },
      "nintendo-life": { tier: "portal", url: "https://www.nintendolife.com/feeds/latest" },
      "pocket-gamer": { tier: "portal", url: "https://www.pocketgamer.com/news/index.rss", gamingFilter: true },
      pcgamesn: { tier: "portal", url: "https://www.pcgamesn.com/mainrss.xml" },
    };
    for (const [id, want] of Object.entries(expected)) {
      expect(byId.get(id), id).toMatchObject({ kind: "rss", category: "GAMES", active: true, ...want });
    }
  });
});

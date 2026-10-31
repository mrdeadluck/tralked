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
    expect(c.MAX_PER_DAY).toBe(15);
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

  it("throws naming ANTHROPIC_API_KEY when it is missing", () => {
    expect(() => loadConfig({ TRALKED_API_KEY: "tk" })).toThrow(/ANTHROPIC_API_KEY/);
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
});

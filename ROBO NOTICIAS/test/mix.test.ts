import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { MIX, mixScore } from "../src/mix.js";

const none = { topics: {}, platforms: {} };
const local = (wall: string) => new Date(`${wall}:00-03:00`);

describe("mixScore", () => {
  it("Steam/PC gets a small lead at the same score", () => {
    const steam = mixScore({ score: 70, topic: "atualizacao", platforms: ["steam-pc"] }, none);
    const ps = mixScore({ score: 70, topic: "atualizacao", platforms: ["playstation"] }, none);
    expect(steam).toBe(70 + MIX.steamPcBonus);
    expect(steam).toBeGreaterThan(ps);
  });

  it("a topic at its daily cap loses to another topic", () => {
    const today = { topics: { lancamento: 3 }, platforms: {} };
    const launch = mixScore({ score: 80, topic: "lancamento", platforms: ["multi"] }, today);
    const sales = mixScore({ score: 60, topic: "vendas", platforms: ["multi"] }, today);
    expect(sales).toBeGreaterThan(launch);
  });

  it("Nintendo is guaranteed while it has not come out today, from the minimum score", () => {
    const nintendo = { score: 55, topic: "anuncio", platforms: ["nintendo"] };
    const xbox = { score: 65, topic: "anuncio", platforms: ["xbox"] };
    expect(mixScore(nintendo, none)).toBeGreaterThan(mixScore(xbox, none));
    const after = { topics: {}, platforms: { nintendo: 1 } };
    expect(mixScore(nintendo, after)).toBeLessThan(mixScore(xbox, after));
    expect(mixScore({ ...nintendo, score: 45 }, none)).toBe(45);
  });

  it("a platform at its daily cap is penalized, except multi", () => {
    const today = { topics: {}, platforms: { "steam-pc": 6, multi: 9 } };
    expect(mixScore({ score: 70, topic: null, platforms: ["steam-pc"] }, today)).toBe(70 + MIX.steamPcBonus - MIX.overCapPenalty);
    expect(mixScore({ score: 70, topic: null, platforms: ["multi"] }, today)).toBe(70);
  });

  it("a story without topic or platforms keeps its score", () => {
    expect(mixScore({ score: 61, topic: null, platforms: [] }, { topics: { lancamento: 9 }, platforms: { xbox: 9 } })).toBe(61);
  });
});

describe("publishedTodayMix", () => {
  it("counts the topics and platforms of the live articles published on the local day", () => {
    const db = openDb(":memory:");
    const add = (key: string, topic: string | null, platforms: string[], at: Date, mode: "live" | "backfill" = "live") => {
      const id = db.upsertStory(
        { key, headline: key, category: "GAMES", score: 60, bomb: false, rumor: false, gamesJson: "[]", mode, status: "published", topic, platformsJson: JSON.stringify(platforms) },
        at,
      );
      db.saveArticle({ storyId: id, payloadJson: "{}", status: "published", siteId: key, publishedAt: at.toISOString() }, at);
    };
    add("a", "trailer", ["steam-pc", "playstation"], local("2026-11-06T08:00"));
    add("b", "trailer", ["steam-pc"], local("2026-11-06T23:30"));
    add("c", "vendas", ["nintendo"], local("2026-11-05T23:30")); // yesterday
    add("d", "vendas", ["xbox"], local("2026-11-06T10:00"), "backfill");
    add("e", null, [], local("2026-11-06T11:00"));
    expect(db.publishedTodayMix("2026-11-06")).toEqual({ topics: { trailer: 2 }, platforms: { "steam-pc": 2, playstation: 1 } });
  });
});

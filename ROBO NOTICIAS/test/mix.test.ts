import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { MIX, mixScore } from "../src/mix.js";

const none = { topics: {}, platforms: {}, games: {} };
const local = (wall: string) => new Date(`${wall}:00-03:00`);

describe("mixScore", () => {
  it("Steam/PC gets a small lead at the same score", () => {
    const steam = mixScore({ score: 70, topic: "atualizacao", platforms: ["steam-pc"] }, none);
    const ps = mixScore({ score: 70, topic: "atualizacao", platforms: ["playstation"] }, none);
    expect(steam).toBe(70 + MIX.steamPcBonus);
    expect(steam).toBeGreaterThan(ps);
  });

  it("a topic at its daily cap loses to another topic", () => {
    const today = { topics: { lancamento: MIX.topicCap }, platforms: {}, games: {} };
    const launch = mixScore({ score: 80, topic: "lancamento", platforms: ["multi"] }, today);
    const sales = mixScore({ score: 60, topic: "vendas", platforms: ["multi"] }, today);
    expect(sales).toBeGreaterThan(launch);
  });

  it("Nintendo is guaranteed while it has not come out today, from the minimum score", () => {
    const nintendo = { score: 55, topic: "anuncio", platforms: ["nintendo"] };
    const xbox = { score: 65, topic: "anuncio", platforms: ["xbox"] };
    expect(mixScore(nintendo, none)).toBeGreaterThan(mixScore(xbox, none));
    const after = { topics: {}, platforms: { nintendo: 1 }, games: {} };
    expect(mixScore(nintendo, after)).toBeLessThan(mixScore(xbox, after));
    expect(mixScore({ ...nintendo, score: 45 }, none)).toBe(45);
  });

  it("a platform at its daily cap is penalized, except multi", () => {
    const today = { topics: {}, platforms: { "steam-pc": MIX.platformCap, multi: 30 }, games: {} };
    expect(mixScore({ score: 70, topic: null, platforms: ["steam-pc"] }, today)).toBe(70 + MIX.steamPcBonus - MIX.overCapPenalty);
    expect(mixScore({ score: 70, topic: null, platforms: ["multi"] }, today)).toBe(70);
  });

  it("a story without topic or platforms keeps its score", () => {
    expect(mixScore({ score: 61, topic: null, platforms: [] }, { topics: { lancamento: 9 }, platforms: { xbox: 9 }, games: { "gta 6": 3 } })).toBe(61);
  });

  it("the caps fit a day of 20 articles: 4 of one topic, 8 of one platform", () => {
    expect(MIX.topicCap).toBe(4);
    expect(MIX.platformCap).toBe(8);
  });

  it("a game already out today loses a little for each article on it, so it can still win with big news", () => {
    const today = { topics: {}, platforms: {}, games: { "grand theft auto 6": 2 } };
    const gta = { score: 80, topic: "declaracao", platforms: ["multi"], games: ["Grand Theft Auto VI"] };
    expect(MIX.sameGamePenalty).toBe(10);
    expect(mixScore(gta, today)).toBe(80 - 2 * MIX.sameGamePenalty);
    expect(mixScore(gta, today)).toBeGreaterThan(mixScore({ score: 55, topic: "vendas", platforms: ["multi"], games: [] }, today));
    expect(mixScore({ ...gta, score: 62 }, today)).toBeLessThan(mixScore({ score: 55, topic: "vendas", platforms: ["multi"], games: [] }, today));
  });

  it("a story about two games is penalized by the most repeated one, once", () => {
    const today = { topics: {}, platforms: {}, games: { "grand theft auto 6": 1, "red dead redemption 2": 3 } };
    const both = { score: 70, topic: null, platforms: [], games: ["Grand Theft Auto VI", "Red Dead Redemption 2"] };
    expect(mixScore(both, today)).toBe(70 - 3 * MIX.sameGamePenalty);
  });
});

describe("publishedTodayMix", () => {
  it("counts the topics, platforms and games of the live articles published on the local day", () => {
    const db = openDb(":memory:");
    const add = (key: string, topic: string | null, platforms: string[], at: Date, mode: "live" | "backfill" = "live", games: string[] = []) => {
      const id = db.upsertStory(
        { key, headline: key, category: "GAMES", score: 60, bomb: false, rumor: false, gamesJson: JSON.stringify(games), mode, status: "published", topic, platformsJson: JSON.stringify(platforms) },
        at,
      );
      db.saveArticle({ storyId: id, payloadJson: "{}", status: "published", siteId: key, publishedAt: at.toISOString() }, at);
    };
    add("a", "trailer", ["steam-pc", "playstation"], local("2026-11-06T08:00"), "live", ["Grand Theft Auto VI"]);
    add("b", "trailer", ["steam-pc"], local("2026-11-06T23:30"), "live", ["Grand Theft Auto 6", "Grand Theft Auto VI"]);
    add("c", "vendas", ["nintendo"], local("2026-11-05T23:30"), "live", ["Grand Theft Auto VI"]); // yesterday
    add("d", "vendas", ["xbox"], local("2026-11-06T10:00"), "backfill");
    add("e", null, [], local("2026-11-06T11:00"));
    expect(db.publishedTodayMix("2026-11-06")).toEqual({
      topics: { trailer: 2 },
      platforms: { "steam-pc": 2, playstation: 1 },
      games: { "grand theft auto 6": 2 },
    });
  });
});

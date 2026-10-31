import { describe, expect, it } from "vitest";
import { createSteamFixture } from "./fixture";

const HK = 367520;

describe("steam fixture", () => {
  const steam = createSteamFixture();

  it("returns a public demo profile", async () => {
    const p = await steam.getPlayerSummary("any");
    expect(p.profilePublic).toBe(true);
    expect(p.personaName).toBeTruthy();
  });

  it("owned games include Hollow Knight with playtime", async () => {
    const games = await steam.getOwnedGames("any");
    if (!Array.isArray(games)) throw new Error("the fixture lists a public library");
    expect(games.length).toBeGreaterThanOrEqual(10);
    const hk = games.find((g) => g.appId === HK);
    expect(hk?.playtimeMin).toBeGreaterThan(0);
  });

  it("Hollow Knight schema has the preview achievements", async () => {
    const schema = await steam.getSchemaForGame(HK);
    expect(schema).toHaveLength(27);
    expect(schema.find((a) => a.name === "Falsehood")).toMatchObject({
      apiName: "FALSEHOOD",
      hidden: false,
    });
    expect(schema.find((a) => a.name === "Embrace the Void")?.hidden).toBe(true);
  });

  it("Hollow Knight global percentages match the preview", async () => {
    const pct = await steam.getGlobalAchievementPercentages(HK);
    expect(pct.FALSEHOOD).toBe(86.4);
    expect(pct.EMBRACE_THE_VOID).toBe(2.2);
    expect(Object.keys(pct)).toHaveLength(27);
  });

  it("Hollow Knight player achievements mix unlocked and locked", async () => {
    const ach = await steam.getPlayerAchievements("any", HK);
    expect(ach).not.toBe("private");
    if (ach === "private") return;
    expect(ach).toHaveLength(27);
    expect(ach.find((a) => a.apiName === "FALSEHOOD")?.unlockedAt).toBeInstanceOf(Date);
    expect(ach.find((a) => a.apiName === "SOUL_AND_SHADE")?.unlockedAt).toBeNull();
  });

  it("the library has never-played games, names, last-2-weeks playtime and last played times", async () => {
    const games = await steam.getOwnedGames("any");
    if (!Array.isArray(games)) throw new Error("the fixture lists a public library");
    expect(games.filter((g) => g.playtimeMin === 0).length).toBeGreaterThanOrEqual(3);
    expect(games.every((g) => g.name)).toBe(true);
    expect(games.find((g) => g.appId === HK)).toMatchObject({ playtime2WeeksMin: 95, lastPlayedAt: expect.any(Date) });
    expect(games.find((g) => g.playtimeMin === 0)?.lastPlayedAt).toBeNull();
  });

  it("has a wishlist with priorities and dates", async () => {
    const wishlist = await steam.getWishlist("any");
    if (wishlist === "private") throw new Error("the fixture wishlist is public");
    expect(wishlist.length).toBeGreaterThanOrEqual(3);
    expect(wishlist[0]).toMatchObject({ priority: 0, addedAt: expect.any(Date) });
  });

  it("pages through the store app list by last appid", async () => {
    const first = await steam.getAppList({ maxResults: 4 });
    if (first === "unsupported") throw new Error("the fixture lists apps");
    expect(first.apps).toHaveLength(4);
    expect(first.haveMore).toBe(true);
    const second = await steam.getAppList({ lastAppId: first.lastAppId, maxResults: 100 });
    if (second === "unsupported") throw new Error("the fixture lists apps");
    expect(second.haveMore).toBe(false);
    expect(second.apps[0].appId).toBeGreaterThan(first.lastAppId);
  });

  it("unknown appIds return empty data", async () => {
    expect(await steam.getSchemaForGame(1)).toEqual([]);
    expect(await steam.getGlobalAchievementPercentages(1)).toEqual({});
    expect(await steam.getPlayerAchievements("any", 1)).toEqual([]);
  });
});

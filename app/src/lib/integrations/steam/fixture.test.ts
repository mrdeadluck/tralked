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

  it("unknown appIds return empty data", async () => {
    expect(await steam.getSchemaForGame(1)).toEqual([]);
    expect(await steam.getGlobalAchievementPercentages(1)).toEqual({});
    expect(await steam.getPlayerAchievements("any", 1)).toEqual([]);
  });
});

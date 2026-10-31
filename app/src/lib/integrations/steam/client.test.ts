import { describe, expect, it, vi } from "vitest";
import { createSteamClient } from "./client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(body, status));
  const client = createSteamClient({ apiKey: "KEY", fetch: fetchMock });
  const lastUrl = () => new URL(String(fetchMock.mock.calls.at(-1)![0]));
  return { client, fetchMock, lastUrl };
}

describe("steam client", () => {
  it("getPlayerSummary maps the player and public visibility", async () => {
    const { client, lastUrl } = setup({
      response: {
        players: [
          {
            steamid: "765",
            personaname: "Ana",
            avatarfull: "http://a/full.jpg",
            communityvisibilitystate: 3,
          },
        ],
      },
    });
    await expect(client.getPlayerSummary("765")).resolves.toEqual({
      steamId: "765",
      personaName: "Ana",
      avatarUrl: "http://a/full.jpg",
      profilePublic: true,
    });
    const url = lastUrl();
    expect(url.origin + url.pathname).toBe(
      "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/",
    );
    expect(url.searchParams.get("key")).toBe("KEY");
    expect(url.searchParams.get("steamids")).toBe("765");
  });

  it("getPlayerSummary flags non-public profiles", async () => {
    const { client } = setup({
      response: {
        players: [
          { steamid: "1", personaname: "B", avatarfull: "x", communityvisibilitystate: 1 },
        ],
      },
    });
    expect((await client.getPlayerSummary("1")).profilePublic).toBe(false);
  });

  it("getPlayerSummary throws when the player does not exist", async () => {
    const { client } = setup({ response: { players: [] } });
    await expect(client.getPlayerSummary("1")).rejects.toThrow(/not found/i);
  });

  it("getOwnedGames returns appId and playtime in minutes", async () => {
    const { client, lastUrl } = setup({
      response: {
        game_count: 2,
        games: [
          { appid: 367520, name: "Hollow Knight", playtime_forever: 3120 },
          { appid: 620, playtime_forever: 0 },
        ],
      },
    });
    await expect(client.getOwnedGames("765")).resolves.toEqual([
      { appId: 367520, playtimeMin: 3120 },
      { appId: 620, playtimeMin: 0 },
    ]);
    const url = lastUrl();
    expect(url.pathname).toBe("/IPlayerService/GetOwnedGames/v1/");
    expect(url.searchParams.get("steamid")).toBe("765");
    expect(url.searchParams.get("include_appinfo")).toBe("1");
    expect(url.searchParams.get("key")).toBe("KEY");
  });

  it("getOwnedGames returns [] when the library is hidden (no games key)", async () => {
    const { client } = setup({ response: {} });
    await expect(client.getOwnedGames("765")).resolves.toEqual([]);
  });

  it("getSchemaForGame maps achievements", async () => {
    const { client, lastUrl } = setup({
      game: {
        availableGameStats: {
          achievements: [
            { name: "A1", displayName: "First", hidden: 0, description: "d", icon: "http://i" },
            { name: "A2", displayName: "Second", hidden: 1 },
          ],
        },
      },
    });
    await expect(client.getSchemaForGame(367520)).resolves.toEqual([
      { apiName: "A1", name: "First", description: "d", iconUrl: "http://i", hidden: false },
      { apiName: "A2", name: "Second", description: undefined, iconUrl: undefined, hidden: true },
    ]);
    const url = lastUrl();
    expect(url.pathname).toBe("/ISteamUserStats/GetSchemaForGame/v2/");
    expect(url.searchParams.get("appid")).toBe("367520");
    expect(url.searchParams.get("key")).toBe("KEY");
  });

  it("getSchemaForGame returns [] for games without achievements", async () => {
    const { client } = setup({ game: { gameName: "X" } });
    await expect(client.getSchemaForGame(1)).resolves.toEqual([]);
  });

  it("getGlobalAchievementPercentages parses string percents", async () => {
    const { client, lastUrl } = setup({
      achievementpercentages: {
        achievements: [
          { name: "A1", percent: "86.4000" },
          { name: "A2", percent: 2.2 },
        ],
      },
    });
    await expect(client.getGlobalAchievementPercentages(367520)).resolves.toEqual({
      A1: 86.4,
      A2: 2.2,
    });
    const url = lastUrl();
    expect(url.pathname).toBe("/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/");
    expect(url.searchParams.get("gameid")).toBe("367520");
  });

  it("getPlayerAchievements maps unlock times (0 = locked)", async () => {
    const { client, lastUrl } = setup({
      playerstats: {
        success: true,
        achievements: [
          { apiname: "A1", achieved: 1, unlocktime: 1700000000 },
          { apiname: "A2", achieved: 0, unlocktime: 0 },
        ],
      },
    });
    await expect(client.getPlayerAchievements("765", 367520)).resolves.toEqual([
      { apiName: "A1", unlockedAt: new Date(1700000000 * 1000) },
      { apiName: "A2", unlockedAt: null },
    ]);
    const url = lastUrl();
    expect(url.pathname).toBe("/ISteamUserStats/GetPlayerAchievements/v1/");
    expect(url.searchParams.get("steamid")).toBe("765");
    expect(url.searchParams.get("appid")).toBe("367520");
    expect(url.searchParams.get("key")).toBe("KEY");
  });

  it("getPlayerAchievements returns 'private' when playerstats.success is false", async () => {
    const { client } = setup({
      playerstats: { error: "Profile is not public", success: false },
    });
    await expect(client.getPlayerAchievements("765", 1)).resolves.toBe("private");
  });

  it("getPlayerAchievements returns 'private' on HTTP 403", async () => {
    const { client } = setup({ error: "forbidden" }, 403);
    await expect(client.getPlayerAchievements("765", 1)).resolves.toBe("private");
  });

  it("getPlayerAchievements returns [] for games without achievements", async () => {
    const { client } = setup({ playerstats: { success: true } });
    await expect(client.getPlayerAchievements("765", 1)).resolves.toEqual([]);
  });

  it("throws on unexpected HTTP errors", async () => {
    const { client } = setup({}, 500);
    await expect(client.getOwnedGames("765")).rejects.toThrow(/500/);
  });
});

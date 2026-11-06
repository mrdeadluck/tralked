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
          {
            appid: 367520,
            name: "Hollow Knight",
            playtime_forever: 3120,
            playtime_2weeks: 45,
            rtime_last_played: 1700000000,
          },
          { appid: 620, playtime_forever: 0, rtime_last_played: 0 },
        ],
      },
    });
    await expect(client.getOwnedGames("765")).resolves.toEqual([
      {
        appId: 367520,
        playtimeMin: 3120,
        name: "Hollow Knight",
        playtime2WeeksMin: 45,
        lastPlayedAt: new Date(1700000000 * 1000),
      },
      { appId: 620, playtimeMin: 0, name: undefined, playtime2WeeksMin: 0, lastPlayedAt: null },
    ]);
    const url = lastUrl();
    expect(url.pathname).toBe("/IPlayerService/GetOwnedGames/v1/");
    expect(url.searchParams.get("steamid")).toBe("765");
    expect(url.searchParams.get("include_appinfo")).toBe("1");
    expect(url.searchParams.get("include_played_free_games")).toBe("1");
    expect(url.searchParams.get("key")).toBe("KEY");
  });

  it("getWishlist maps items; an empty or private answer is an empty list; 403 is private", async () => {
    const { client, lastUrl } = setup({
      response: {
        items: [
          { appid: 1145360, priority: 0, date_added: 1700000000 },
          { appid: 0, priority: 1 },
          { appid: 620 },
        ],
      },
    });
    await expect(client.getWishlist("765")).resolves.toEqual([
      { appId: 1145360, priority: 0, addedAt: new Date(1700000000 * 1000) },
      { appId: 620, priority: null, addedAt: null },
    ]);
    expect(lastUrl().pathname).toBe("/IWishlistService/GetWishlist/v1/");
    expect(lastUrl().searchParams.get("steamid")).toBe("765");
    await expect(setup({ response: {} }).client.getWishlist("1")).resolves.toEqual([]);
    await expect(setup({}, 403).client.getWishlist("1")).resolves.toBe("private");
    await expect(setup({}, 500).client.getWishlist("1")).rejects.toThrow(/HTTP 500/);
  });

  it("getAppList reads one page of games with the pagination cursor", async () => {
    const { client, lastUrl } = setup({
      response: {
        apps: [
          { appid: 10, name: "Counter-Strike", last_modified: 1666823513 },
          { appid: 20, name: "  " },
          { appid: 30, name: "Day of Defeat" },
        ],
        have_more_results: true,
        last_appid: 30,
      },
    });
    await expect(client.getAppList({ lastAppId: 5, ifModifiedSince: 1600000000, maxResults: 3 })).resolves.toEqual({
      apps: [
        { appId: 10, name: "Counter-Strike", lastModified: 1666823513 },
        { appId: 30, name: "Day of Defeat", lastModified: null },
      ],
      haveMore: true,
      lastAppId: 30,
    });
    const url = lastUrl();
    expect(url.pathname).toBe("/IStoreService/GetAppList/v1/");
    expect(url.searchParams.get("include_games")).toBe("1");
    expect(url.searchParams.get("last_appid")).toBe("5");
    expect(url.searchParams.get("if_modified_since")).toBe("1600000000");
    expect(url.searchParams.get("max_results")).toBe("3");
    await expect(setup({ response: {} }).client.getAppList()).resolves.toEqual({ apps: [], haveMore: false, lastAppId: 0 });
  });

  it("getOwnedGames with an appId asks Steam for that app only (appids_filter)", async () => {
    const { client, lastUrl } = setup({ response: { game_count: 1, games: [{ appid: 620, playtime_forever: 90 }] } });
    await expect(client.getOwnedGames("765", { appId: 620 })).resolves.toMatchObject([{ appId: 620, playtimeMin: 90 }]);
    const input = JSON.parse(lastUrl().searchParams.get("input_json")!);
    expect(input).toMatchObject({ steamid: "765", appids_filter: [620] });
  });

  it("getOwnedGames returns 'private' when game details are hidden ({response:{}})", async () => {
    const { client } = setup({ response: {} });
    await expect(client.getOwnedGames("765")).resolves.toBe("private");
  });

  it("getOwnedGames returns [] for a real empty library (game_count 0)", async () => {
    const { client } = setup({ response: { game_count: 0 } });
    await expect(client.getOwnedGames("765")).resolves.toEqual([]);
  });

  it("getRecentlyPlayedGames maps the last two weeks' games (no date); {response:{}} is private", async () => {
    const { client, lastUrl } = setup({
      response: {
        total_count: 1,
        games: [{ appid: 4115450, name: " Phantom Blade Zero ", playtime_2weeks: 148, playtime_forever: 148 }],
      },
    });
    await expect(client.getRecentlyPlayedGames!("765")).resolves.toEqual([
      { appId: 4115450, name: "Phantom Blade Zero", playtimeMin: 148, playtime2WeeksMin: 148, lastPlayedAt: null },
    ]);
    expect(lastUrl().pathname).toBe("/IPlayerService/GetRecentlyPlayedGames/v1/");
    expect(lastUrl().searchParams.get("steamid")).toBe("765");
    await expect(setup({ response: { total_count: 0 } }).client.getRecentlyPlayedGames!("1")).resolves.toEqual([]);
    await expect(setup({ response: {} }).client.getRecentlyPlayedGames!("1")).resolves.toBe("private");
  });

  it("passes a timeout signal to every request", async () => {
    const { client, fetchMock } = setup({ response: { game_count: 0 } });
    await client.getOwnedGames("765");
    await client.getPlayerAchievements("765", 1);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
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

  it("getGlobalAchievementPercentages: HTTP 403 (no public global stats) is no data, other errors throw", async () => {
    await expect(setup({}, 403).client.getGlobalAchievementPercentages(1789480)).resolves.toEqual({});
    await expect(setup({}, 500).client.getGlobalAchievementPercentages(1)).rejects.toThrow(/HTTP 500/);
  });

  it("getPlayerAchievements maps achieved and unlock times (achieved with unlocktime 0 = date unknown)", async () => {
    const { client, lastUrl } = setup({
      playerstats: {
        success: true,
        achievements: [
          { apiname: "A1", achieved: 1, unlocktime: 1700000000 },
          { apiname: "A2", achieved: 0, unlocktime: 0 },
          // Team Fortress 2, 2026-11-05: old achievements come achieved without a date.
          { apiname: "A3", achieved: 1, unlocktime: 0 },
        ],
      },
    });
    await expect(client.getPlayerAchievements("765", 367520)).resolves.toEqual([
      { apiName: "A1", achieved: true, unlockedAt: new Date(1700000000 * 1000) },
      { apiName: "A2", achieved: false, unlockedAt: null },
      { apiName: "A3", achieved: true, unlockedAt: null },
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

  it("getPlayerAchievements returns [] on HTTP 400 (app has no stats)", async () => {
    const { client } = setup({ playerstats: { error: "Requested app has no stats", success: false } }, 400);
    await expect(client.getPlayerAchievements("765", 1)).resolves.toEqual([]);
  });

  it("getPlayerAchievements returns [] when success:false says the app has no stats", async () => {
    const { client } = setup({ playerstats: { error: "Requested app has no stats", success: false } });
    await expect(client.getPlayerAchievements("765", 1)).resolves.toEqual([]);
  });

  it("getPlayerAchievements throws on other success:false errors without leaking the key", async () => {
    const { client } = setup({ playerstats: { error: "Something odd", success: false } });
    const err = await client.getPlayerAchievements("765", 1).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/Something odd/);
    expect((err as Error).message).not.toContain("KEY");
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

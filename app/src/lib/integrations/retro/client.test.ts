import { describe, expect, it, vi } from "vitest";
import { createRetroClient, parseRetroDate } from "./client";
import { createRetroFixture } from "./fixture";

const KEY = "ra-web-api-key-secret";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(handler: (url: URL) => Response | Promise<Response>) {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async (input) => handler(new URL(String(input))),
  );
  const client = createRetroClient({
    apiKey: KEY,
    username: "TralkedBot",
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { client, fetchMock };
}

describe("retroachievements client", () => {
  it("reads the profile motto with the web API key", async () => {
    const { client, fetchMock } = setup(() =>
      json({ User: "MaxMilyin", ULID: "00003EMFWR7XB8SDPEHB3K56ZQ", UserPic: "/UserPic/MaxMilyin.png", Motto: "TRK-ABC123" }),
    );
    await expect(client.findProfile("MaxMilyin")).resolves.toEqual({
      user: "MaxMilyin",
      ulid: "00003EMFWR7XB8SDPEHB3K56ZQ",
      motto: "TRK-ABC123",
      avatarUrl: "https://media.retroachievements.org/UserPic/MaxMilyin.png",
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://retroachievements.org/API/API_GetUserProfile.php");
    expect(url.searchParams.get("y")).toBe(KEY);
    expect(url.searchParams.get("z")).toBe("TralkedBot");
    expect(url.searchParams.get("u")).toBe("MaxMilyin");
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns null for unknown users (404 or empty body)", async () => {
    await expect(setup(() => json({}, 404)).client.findProfile("x")).resolves.toBeNull();
    await expect(setup(() => json({})).client.findProfile("x")).resolves.toBeNull();
  });

  it("pages through the user's games", async () => {
    const game = (id: number) => ({
      GameID: id,
      Title: `Game ${id}`,
      ConsoleName: "SNES",
      MaxPossible: 10,
      NumAwarded: 5,
      NumAwardedHardcore: 4,
      MostRecentAwardedDate: "2026-01-01T10:00:00+00:00",
    });
    const { client, fetchMock } = setup((url) => {
      const offset = Number(url.searchParams.get("o"));
      const results = offset === 0 ? Array.from({ length: 500 }, (_, i) => game(i)) : [game(500)];
      return json({ Count: results.length, Total: 501, Results: results });
    });
    const games = await client.getGames("MaxMilyin");
    expect(games).toHaveLength(501);
    expect(games[0]).toEqual({
      gameId: "0",
      title: "Game 0",
      consoleName: "SNES",
      maxPossible: 10,
      numAwarded: 5,
      numAwardedHardcore: 4,
      lastPlayed: new Date("2026-01-01T10:00:00Z"),
    });
    const offsets = fetchMock.mock.calls.map((c) => new URL(String(c[0])).searchParams.get("o"));
    expect(offsets).toEqual(["0", "500"]);
  });

  it("reads a game's achievements with hardcore unlocks and rarity", async () => {
    const { client } = setup(() =>
      json({
        NumDistinctPlayers: 200,
        // Seconds (RA's unit): 2 h 5 min 30 s.
        UserTotalPlaytime: 7530,
        Achievements: {
          "9": { ID: 9, Title: "Easy", Description: "Do it", Points: 3, NumAwarded: 150, BadgeName: "250336", DateEarned: "2016-03-12 17:47:29", DateEarnedHardcore: "2016-03-12 17:47:29" },
          "10": { ID: 10, Title: "Soft", Points: 5, NumAwarded: 10, DateEarned: "2016-03-13 10:00:00" },
          "11": { ID: 11, Title: "Locked", Points: 10, NumAwarded: 1 },
        },
      }),
    );
    const progress = await client.getGameProgress("MaxMilyin", "1");
    expect(progress.playtimeMin).toBe(125);
    expect(progress.achievements).toEqual([
      {
        id: "9",
        name: "Easy",
        description: "Do it",
        iconUrl: "https://media.retroachievements.org/Badge/250336.png",
        points: 3,
        rarityPct: 75,
        earned: true,
        earnedAt: new Date("2016-03-12T17:47:29Z"),
        hardcore: true,
      },
      expect.objectContaining({ id: "10", earned: true, hardcore: false, rarityPct: 5, earnedAt: new Date("2016-03-13T10:00:00Z") }),
      expect.objectContaining({ id: "11", earned: false, hardcore: false, earnedAt: null, rarityPct: 0.5 }),
    ]);
  });

  it("never leaks the key: neither in HTTP errors nor in network errors", async () => {
    const http = (await setup(() => json({}, 500)).client.getGames("x").catch((e: Error) => e)) as Error;
    expect(http.message).toBe("RetroAchievements API_GetUserCompletionProgress failed with HTTP 500");
    const network = (await setup(() => {
      throw new TypeError(`fetch failed for https://retroachievements.org/API/x.php?y=${KEY}`);
    }).client.findProfile("x").catch((e: Error) => e)) as Error;
    expect(network.message).not.toContain(KEY);
    expect(http.message).not.toContain(KEY);
  });

  it("parses RA dates as UTC", () => {
    expect(parseRetroDate("2016-03-12 17:47:29")).toEqual(new Date("2016-03-12T17:47:29Z"));
    expect(parseRetroDate(undefined)).toBeNull();
    expect(parseRetroDate("nope")).toBeNull();
  });
});

describe("retroachievements fixture", () => {
  const retro = createRetroFixture();

  it("finds the seeded account by username or ULID and returns its game", async () => {
    const profile = await retro.findProfile("lucasexemplo");
    expect(profile?.ulid).toBe("01JTRALKED00000000000LUCAS");
    await expect(retro.findProfile("01JTRALKED00000000000LUCAS")).resolves.toEqual(profile);
    const [game] = await retro.getGames("LucasExemplo");
    const progress = await retro.getGameProgress("LucasExemplo", game.gameId);
    expect(progress.achievements.filter((a) => a.hardcore)).toHaveLength(2);
    await expect(retro.findProfile("ninguem")).resolves.toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import { createRetroCatalogClient, createRetroCatalogFixture } from "./catalog";

const KEY = "ra-web-api-key-secret";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function setup(handler: (url: URL) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => handler(new URL(String(input))));
  const client = createRetroCatalogClient({ apiKey: KEY, username: "TralkedBot", fetch: fetchMock as unknown as typeof fetch });
  return { client, fetchMock };
}

describe("retroachievements catalog client", () => {
  it("lists active game systems only", async () => {
    const { client, fetchMock } = setup(() =>
      json([
        { ID: 1, Name: "Mega Drive", Active: true, IsGameSystem: true },
        { ID: 100, Name: "Hubs", Active: true, IsGameSystem: false },
        { ID: 102, Name: "Old", Active: false, IsGameSystem: true },
        { ID: 3, Name: "SNES/Super Famicom" },
      ]),
    );
    await expect(client.getConsoles()).resolves.toEqual([
      { id: 1, name: "Mega Drive" },
      { id: 3, name: "SNES/Super Famicom" },
    ]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/API/API_GetConsoleIDs.php");
    expect(url.searchParams.get("y")).toBe(KEY);
    expect(url.searchParams.get("z")).toBe("TralkedBot");
    expect(url.searchParams.get("a")).toBe("1");
    expect(url.searchParams.get("g")).toBe("1");
  });

  it("reads a console's games with achievements (f=1)", async () => {
    const { client, fetchMock } = setup(() =>
      json([
        {
          Title: " Advanced Busterhawk: Gley Lancer ",
          ID: 3684,
          ConsoleID: 1,
          ConsoleName: "Mega Drive",
          ImageIcon: "/Images/020895.png",
          NumAchievements: 44,
          NumLeaderboards: 33,
          Points: 595,
          DateModified: "2022-11-20 03:44:12",
          ForumTopicID: 1936,
        },
        { Title: "Odd icon", ID: 2, ConsoleID: 1, ImageIcon: "javascript:alert(1)", NumAchievements: 3 },
        { Title: "No achievements", ID: 3, ConsoleID: 1, NumAchievements: 0 },
      ]),
    );
    const games = await client.getGameList(1);
    expect(games).toEqual([
      {
        id: 3684,
        title: "Advanced Busterhawk: Gley Lancer",
        consoleId: 1,
        consoleName: "Mega Drive",
        iconPath: "/Images/020895.png",
        achievementCount: 44,
        points: 595,
        modifiedAt: new Date("2022-11-20T03:44:12Z"),
      },
      expect.objectContaining({ id: 2, iconPath: null, consoleName: "", points: 0, modifiedAt: null }),
    ]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/API/API_GetGameList.php");
    expect(url.searchParams.get("i")).toBe("1");
    expect(url.searchParams.get("f")).toBe("1");
    expect(url.searchParams.has("h")).toBe(false);
  });

  it("reads a game's set in display order with rarity, and null for an unknown game", async () => {
    const { client, fetchMock } = setup((url) =>
      url.searchParams.get("i") === "404"
        ? json({}, 404)
        : json({
            ID: 1,
            NumDistinctPlayers: 200,
            Achievements: {
              "10": { ID: 10, Title: "Second", Points: 5, NumAwarded: 10, DisplayOrder: 2 },
              "9": { ID: 9, Title: "First", Description: "Do it", Points: 3, NumAwarded: 150, BadgeName: "250336", DisplayOrder: 1 },
            },
          }),
    );
    await expect(client.getGameAchievements(1)).resolves.toEqual([
      { id: "9", name: "First", description: "Do it", iconUrl: "https://media.retroachievements.org/Badge/250336.png", points: 3, rarityPct: 75 },
      { id: "10", name: "Second", description: null, iconUrl: null, points: 5, rarityPct: 5 },
    ]);
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe("/API/API_GetGameExtended.php");
    await expect(client.getGameAchievements(404)).resolves.toBeNull();
  });

  it("never leaks the key in errors", async () => {
    const http = (await setup(() => json({}, 500)).client.getGameList(1).catch((e: Error) => e)) as Error;
    expect(http.message).toBe("RetroAchievements API_GetGameList failed with HTTP 500");
    const network = (await setup(() => {
      throw new TypeError(`fetch failed for https://retroachievements.org/API/x.php?y=${KEY}`);
    })
      .client.getConsoles()
      .catch((e: Error) => e)) as Error;
    expect(network.message).not.toContain(KEY);
  });
});

describe("retroachievements catalog fixture", () => {
  it("lists the fixture games and their sets", async () => {
    const api = createRetroCatalogFixture();
    const consoles = await api.getConsoles();
    const games = (await Promise.all(consoles.map((c) => api.getGameList(c.id)))).flat();
    expect(games.map((g) => g.id)).toContain(990001);
    await expect(api.getGameAchievements(990001)).resolves.toHaveLength(4);
    await expect(api.getGameAchievements(990003)).resolves.toEqual([]);
    await expect(api.getGameAchievements(1)).resolves.toBeNull();
  });
});

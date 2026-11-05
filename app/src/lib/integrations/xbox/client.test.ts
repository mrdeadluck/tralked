import { describe, expect, it, vi } from "vitest";
import { createXboxClient } from "./client";
import { createXboxFixture } from "./fixture";

const KEY = "openxbl-secret-key";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(handler: (url: URL) => Response) {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async (input) => handler(new URL(String(input))),
  );
  const client = createXboxClient({ apiKey: KEY, fetch: fetchMock as unknown as typeof fetch });
  return { client, fetchMock };
}

describe("xbox client (OpenXBL)", () => {
  it("reads MinutesPlayed of many titles in batched POSTs to the user stats proxy", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => String(1000 + i));
    const { client, fetchMock } = setup((url) => {
      expect(url.pathname).toBe("/api/v2/player/stats");
      return json({
        statlistscollection: [
          {
            stats: [
              { name: "MinutesPlayed", titleid: "1000", value: "754" },
              { name: "MinutesPlayed", titleid: 1001, value: 12 },
              { name: "OtherStat", titleid: "1002", value: "9" },
              { name: "MinutesPlayed", titleid: "1003", value: "n/a" },
            ],
          },
        ],
      });
    });
    const minutes = await client.getMinutesPlayed("2535", ids);
    expect(minutes).toEqual(new Map([["1000", 754], ["1001", 12]]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.xuids).toEqual(["2535"]);
    expect(body.stats).toHaveLength(25);
    expect(body.stats[0]).toEqual({ name: "MinutesPlayed", titleId: "1000" });
    expect(new Headers(init?.headers).get("X-Authorization")).toBe(KEY);
  });

  it("gives OpenXBL 20 s per request (slower than the other sources' 10 s)", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const { client } = setup(() => json({ statlistscollection: [] }));
      await client.getMinutesPlayed("2535", ["1"]);
      expect(timeout).toHaveBeenCalledWith(20_000);
      expect(timeout).not.toHaveBeenCalledWith(10_000);
    } finally {
      timeout.mockRestore();
    }
  });

  it("reports private stats", async () => {
    const { client } = setup(() => json({}, 403));
    await expect(client.getMinutesPlayed("2535", ["1"])).resolves.toBe("private");
  });

  it("finds a profile by gamertag with its bio", async () => {
    const { client, fetchMock } = setup((url) => {
      if (url.pathname === "/api/v2/search/Lucas%20Exemplo") {
        return json({ people: [{ xuid: "999", gamertag: "Outro" }, { xuid: "123", gamertag: "Lucas Exemplo" }] });
      }
      if (url.pathname === "/api/v2/account/123") {
        return json({
          profileUsers: [
            {
              id: "123",
              settings: [
                { id: "Gamertag", value: "Lucas Exemplo" },
                { id: "Bio", value: "código TRK-XYZ789" },
                { id: "GameDisplayPicRaw", value: "https://images/pic.png" },
              ],
            },
          ],
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(client.findProfile("Lucas Exemplo")).resolves.toEqual({
      xuid: "123",
      gamertag: "Lucas Exemplo",
      bio: "código TRK-XYZ789",
      avatarUrl: "https://images/pic.png",
    });
    for (const [, init] of fetchMock.mock.calls) {
      expect((init?.headers as Record<string, string>)["X-Authorization"]).toBe(KEY);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("reads a known XUID's profile without searching the gamertag", async () => {
    const { client, fetchMock } = setup((url) => {
      if (url.pathname === "/api/v2/account/123") {
        // Wrapped in `content`, as some OpenXBL answers are.
        return json({
          content: {
            profileUsers: [{ id: "123", settings: [{ id: "Gamertag", value: "Lucas Exemplo" }, { id: "Bio", value: "TRK-ABC234" }] }],
          },
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(client.getProfile("123")).resolves.toEqual({
      xuid: "123",
      gamertag: "Lucas Exemplo",
      bio: "TRK-ABC234",
      avatarUrl: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null for an unknown XUID", async () => {
    const { client } = setup(() => json({ code: 28 }, 404));
    await expect(client.getProfile("404")).resolves.toBeNull();
  });

  it("returns null when no player has the gamertag", async () => {
    const { client } = setup(() => json({ people: [{ xuid: "1", gamertag: "Parecido" }] }));
    await expect(client.findProfile("Ninguem")).resolves.toBeNull();
  });

  it("lists titles and achievements with gamerscore, unlock time and rarity", async () => {
    const { client } = setup((url) => {
      if (url.pathname === "/api/v2/achievements/player/123") {
        return json({
          titles: [
            {
              titleId: 1234,
              name: "Hollow Knight",
              achievement: { currentAchievements: 1, totalAchievements: 2, currentGamerscore: 10, totalGamerscore: 30, progressPercentage: 33 },
              titleHistory: { lastTimePlayed: "2026-03-01T10:00:00Z" },
              devices: ["XboxOne", "XboxSeries", 7],
            },
            { titleId: 99, name: "Sem aparelhos" },
          ],
        });
      }
      return json({
        achievements: [
          {
            id: "1",
            name: "Primeiro",
            description: "Faça algo",
            progressState: "Achieved",
            progression: { timeUnlocked: "2026-02-01T12:00:00.123Z" },
            mediaAssets: [{ type: "Icon", url: "https://i/1.png" }],
            rewards: [{ type: "Gamerscore", value: "10" }],
            rarity: { currentPercentage: 4.5 },
          },
          {
            id: "2",
            name: "Segundo",
            lockedDescription: "Secreto",
            isSecret: true,
            progressState: "NotStarted",
            progression: { timeUnlocked: "0001-01-01T00:00:00.0000000Z" },
            rewards: [{ type: "Gamerscore", value: "20" }],
          },
        ],
      });
    });
    await expect(client.getTitles("123")).resolves.toEqual([
      {
        titleId: "1234",
        name: "Hollow Knight",
        currentAchievements: 1,
        totalAchievements: 2,
        currentGamerscore: 10,
        totalGamerscore: 30,
        progress: 33,
        lastPlayed: new Date("2026-03-01T10:00:00Z"),
        devices: ["XboxOne", "XboxSeries"],
      },
      {
        titleId: "99",
        name: "Sem aparelhos",
        currentAchievements: 0,
        totalAchievements: 0,
        currentGamerscore: 0,
        totalGamerscore: 0,
        progress: 0,
        lastPlayed: null,
        devices: [],
      },
    ]);
    await expect(client.getAchievements("123", "1234")).resolves.toEqual([
      {
        id: "1",
        name: "Primeiro",
        description: "Faça algo",
        iconUrl: "https://i/1.png",
        hidden: false,
        gamerscore: 10,
        unlocked: true,
        unlockedAt: new Date("2026-02-01T12:00:00.123Z"),
        rarityPct: 4.5,
      },
      {
        id: "2",
        name: "Segundo",
        description: "Secreto",
        iconUrl: null,
        hidden: true,
        gamerscore: 20,
        unlocked: false,
        unlockedAt: null,
        rarityPct: null,
      },
    ]);
  });

  it("parses devices of the title history", async () => {
    const { client } = setup(() =>
      json({
        titles: [
          { titleId: "1096157000", name: "Halo 3", devices: ["Xbox360"], achievement: { currentAchievements: 4, totalAchievements: 50 } },
          { titleId: "219630713", name: "Halo MCC", devices: ["XboxOne", "XboxSeries", "PC"], achievement: { currentAchievements: 1 } },
          { titleId: "7", name: "No devices" },
        ],
      }),
    );
    const titles = await client.getTitles("2535");
    expect(titles === "private" ? [] : titles.map((t) => t.devices)).toEqual([["Xbox360"], ["XboxOne", "XboxSeries", "PC"], []]);
  });

  it("a 360 title reads achievements from the 360 route", async () => {
    // Recorded shape of OpenXBL's /achievements/x360/{xuid}/title/{titleId} (ids masked).
    const { client, fetchMock } = setup((url) => {
      if (url.pathname === "/api/v2/achievements/x360/2535000000000001/title/1096157000") {
        return json({
          achievements: [
            { id: 1, titleId: 1096157000, name: "Skull", description: "Find it", lockedDescription: "Secret", isSecret: false, unlocked: true, unlockedOnline: true, gamerscore: 20, imageId: 255, timeUnlocked: "2010-05-04T12:00:00.0000000Z", rarity: { currentPercentage: 12.5 } },
            { id: 2, titleId: 1096157000, name: "Hidden one", lockedDescription: "Play more", isSecret: true, unlocked: false, unlockedOnline: false, gamerscore: 10, imageId: 256, timeUnlocked: "0001-01-01T00:00:00.0000000Z" },
          ],
        });
      }
      return json({ achievements: [] });
    });
    const list = await client.getAchievements("2535000000000001", "1096157000", ["Xbox360"]);
    if (list === "private") throw new Error("private");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(list.map((a) => [a.id, a.name, a.unlocked, a.gamerscore, a.hidden])).toEqual([
      ["1", "Skull", true, 20, false],
      ["2", "Hidden one", false, 10, true],
    ]);
    expect(list[0].unlockedAt).toEqual(new Date("2010-05-04T12:00:00Z"));
    expect(list[1].unlockedAt).toBeNull();
    expect(list[1].description).toBe("Play more");
    expect(list[0].rarityPct).toBe(12.5);
  });

  it("a non-360 title keeps the player route, and an empty 360 answer falls back to it", async () => {
    const seen: string[] = [];
    const { client } = setup((url) => {
      seen.push(url.pathname);
      return url.pathname.includes("/x360/")
        ? json({ achievements: [] })
        : json({ achievements: [{ id: "9", name: "A", progressState: "Achieved", progression: { timeUnlocked: "2021-01-01T00:00:00Z" } }] });
    });
    await client.getAchievements("2535", "10", ["XboxOne"]);
    expect(seen).toEqual(["/api/v2/achievements/player/2535/10"]);
    seen.length = 0;
    const back = await client.getAchievements("2535", "11", ["Xbox360", "XboxOne"]);
    expect(seen).toEqual(["/api/v2/achievements/x360/2535/title/11", "/api/v2/achievements/player/2535/11"]);
    expect(back === "private" ? 0 : back.length).toBe(1);
  });

  it("a 404 or an unrecognised body is unknown, not an empty list; a genuinely empty list is empty", async () => {
    const make = (res: () => Response) => setup(res).client;
    await expect(make(() => json({ code: "NOT_FOUND" }, 404)).getAchievements("2535", "10")).rejects.toThrow(/not found/);
    await expect(make(() => json({ foo: 1 })).getAchievements("2535", "10")).rejects.toThrow(/unexpected/);
    await expect(make(() => json({ achievements: [] })).getAchievements("2535", "10")).resolves.toEqual([]);
  });

  it("a 360 route that 404s or answers an unrecognised body falls back to the player route", async () => {
    for (const x360 of [() => json({}, 404), () => json({ surprise: true })]) {
      const seen: string[] = [];
      const { client } = setup((url) => {
        seen.push(url.pathname);
        return url.pathname.includes("/x360/") ? x360() : json({ achievements: [{ id: "9", name: "A", progressState: "Achieved" }] });
      });
      const list = await client.getAchievements("2535", "11", ["Xbox360"]);
      expect(seen).toHaveLength(2);
      expect(list === "private" ? 0 : list.length).toBe(1);
    }
  });

  it("drops achievement records without an id or a name (360 and player routes)", async () => {
    const { client } = setup((url) =>
      url.pathname.includes("/x360/")
        ? json({ achievements: [{ name: "No id", unlocked: true }, { id: 3 }, { id: 4, name: "" }] })
        : json({ achievements: [{ name: "No id" }, { id: 5, name: "Ok" }, { id: 6 }] }),
    );
    const list = await client.getAchievements("2535", "11", ["Xbox360"]);
    expect(list === "private" ? [] : list.map((a) => a.id)).toEqual(["5"]);
  });

  it("reports private data and keeps the key out of errors", async () => {
    const privateClient = setup(() => json({}, 403)).client;
    await expect(privateClient.getTitles("1")).resolves.toBe("private");
    await expect(privateClient.getAchievements("1", "2")).resolves.toBe("private");

    const failing = setup(() => json({}, 500)).client;
    const error = (await failing.getTitles("1").catch((e: Error) => e)) as Error;
    expect(error.message).toBe("Xbox titles failed with HTTP 500");
    expect(error.message).not.toContain(KEY);
  });
});

describe("xbox fixture", () => {
  const xbox = createXboxFixture();

  it("knows the seeded gamertag and its titles", async () => {
    const profile = await xbox.findProfile("lucas exemplo");
    expect(profile?.xuid).toBe("2535400000000001");
    const titles = await xbox.getTitles("2535400000000001");
    // Two with achievements and one played without any unlock yet.
    expect(titles).toHaveLength(3);
    const minutes = await xbox.getMinutesPlayed("2535400000000001", ["90000001", "90000005", "99999999"]);
    expect(minutes).toEqual(new Map([["90000001", 720], ["90000005", 140]]));
    await expect(xbox.getMinutesPlayed("2535400000000003", ["90000001"])).resolves.toBe("private");
    const list = await xbox.getAchievements("2535400000000001", "90000003");
    expect((list as { unlocked: boolean }[]).filter((a) => a.unlocked)).toHaveLength(6);
  });

  it("returns null for unknown gamertags and private for the closed profile", async () => {
    await expect(xbox.findProfile("ninguem")).resolves.toBeNull();
    await expect(xbox.getTitles("2535400000000003")).resolves.toBe("private");
  });
});

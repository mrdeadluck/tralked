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

  // Recorded shapes (2026-11-05, ids masked): the definitions route lists every achievement of a
  // 360 title with a placeholder state (never unlocked, a 2002 date); the 360 route only the earned.
  const DEFINITIONS = "/api/v2/achievements/player/2535000000000001/title/1096157000";
  const EARNED = "/api/v2/achievements/x360/2535000000000001/title/1096157000";
  const definition = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    titleId: 1096157000,
    name: `Def ${id}`,
    description: `Do ${id}`,
    lockedDescription: `Hint ${id}`,
    isSecret: false,
    unlocked: false,
    unlockedOnline: false,
    gamerscore: 10 * id,
    imageId: 254 + id,
    timeUnlocked: "2002-11-15T00:00:00.0000000Z",
    platform: 255,
    rarity: { currentPercentage: id },
    ...extra,
  });
  const earned = (id: number, timeUnlocked: string) => ({ ...definition(id), unlocked: true, unlockedOnline: true, timeUnlocked, platform: 1 });
  const paged = (achievements: unknown[], continuationToken: string | null = null) => ({
    content: { achievements, version: "1", pagingInfo: { continuationToken, totalRecords: achievements.length } },
    code: 200,
  });

  it("a 360 title joins every achievement (definitions route) with the earned ones (360 route) by id", async () => {
    const seen: string[] = [];
    const { client } = setup((url) => {
      seen.push(url.pathname);
      if (url.pathname === DEFINITIONS) {
        return json(paged([definition(1), definition(2, { isSecret: true, description: "" }), definition(3)]));
      }
      if (url.pathname === EARNED) return json(paged([earned(2, "2010-05-04T12:00:00.0000000Z")]));
      throw new Error(`unexpected ${url}`);
    });
    const list = await client.getAchievements("2535000000000001", "1096157000", ["Xbox360", "XboxOne", "XboxSeries"]);
    if (list === "private") throw new Error("private");
    // Two requests, never the player route (empty for 360).
    expect(seen).toEqual([DEFINITIONS, EARNED]);
    // The real total: three achievements, one earned (the definitions' placeholder state ignored).
    expect(list.map((a) => [a.id, a.name, a.unlocked, a.gamerscore, a.hidden])).toEqual([
      ["1", "Def 1", false, 10, false],
      ["2", "Def 2", true, 20, true],
      ["3", "Def 3", false, 30, false],
    ]);
    expect(list[1].unlockedAt).toEqual(new Date("2010-05-04T12:00:00Z"));
    expect(list[0].unlockedAt).toBeNull();
    expect(list[1].description).toBe("Hint 2");
    expect(list[0].description).toBe("Do 1");
    expect(list[0].rarityPct).toBe(1);
    // The 360 image CDN: title and image ids in hex.
    expect(list[0].iconUrl).toBe("https://image-ssl.xboxlive.com/global/t.41560748/ach/0/ff");
  });

  it("a 360 title earned with no date keeps the unlock (the sync dates it when first seen)", async () => {
    const { client } = setup((url) =>
      url.pathname === DEFINITIONS ? json(paged([definition(1)])) : json(paged([earned(1, "0001-01-01T00:00:00.0000000Z")])),
    );
    const list = await client.getAchievements("2535000000000001", "1096157000", ["Xbox360"]);
    expect(list === "private" ? [] : list.map((a) => [a.unlocked, a.unlockedAt])).toEqual([[true, null]]);
  });

  it("a 360 title is a failed read (nothing partial) when either route fails or answers something else", async () => {
    const answers: { definitions: () => Response; earned: () => Response }[] = [
      { definitions: () => json({}, 404), earned: () => json(paged([])) },
      { definitions: () => json({ surprise: true }), earned: () => json(paged([])) },
      { definitions: () => json({}, 500), earned: () => json(paged([])) },
      { definitions: () => json(paged([definition(1)])), earned: () => json({}, 404) },
      { definitions: () => json(paged([definition(1)])), earned: () => json({ surprise: true }) },
      { definitions: () => json(paged([definition(1)])), earned: () => json({}, 500) },
    ];
    for (const answer of answers) {
      const { client, fetchMock } = setup((url) => (url.pathname === DEFINITIONS ? answer.definitions() : answer.earned()));
      await expect(client.getAchievements("2535000000000001", "1096157000", ["Xbox360"])).rejects.toThrow(/Xbox 360/);
      expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
    }
  });

  it("a 360 title whose earned achievements are not all in its definitions is a failed read", async () => {
    const { client } = setup((url) =>
      url.pathname === DEFINITIONS
        ? json(paged([definition(1)]))
        : json(paged([earned(1, "2010-05-04T12:00:00Z"), earned(7, "2010-05-05T12:00:00Z")])),
    );
    await expect(client.getAchievements("2535000000000001", "1096157000", ["Xbox360"])).rejects.toThrow(/not in its list/);
  });

  it("a 360 title whose definitions span more than one page is a failed read (never a cut list)", async () => {
    const { client } = setup((url) =>
      url.pathname === DEFINITIONS ? json(paged([definition(1)], "150")) : json(paged([])),
    );
    await expect(client.getAchievements("2535000000000001", "1096157000", ["Xbox360"])).rejects.toThrow(/page/);
  });

  it("a 360 title with no definitions and nothing earned is empty, in two requests", async () => {
    const { client, fetchMock } = setup(() => json(paged([])));
    await expect(client.getAchievements("2535000000000001", "1096157000", ["Xbox360"])).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a 403 on either 360 route fails the title, it never marks the account private", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const refusedRoute of [DEFINITIONS, EARNED]) {
        const { client } = setup((url) => (url.pathname === refusedRoute ? json({}, 403) : json(paged([definition(1)]))));
        await expect(client.getAchievements("2535000000000001", "1096157000", ["Xbox360"])).rejects.toThrow(/refused \(HTTP 403\)/);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it("a non-360 title keeps the player route, in one request", async () => {
    const seen: string[] = [];
    const { client } = setup((url) => {
      seen.push(url.pathname);
      return json({ achievements: [{ id: "9", name: "A", progressState: "Achieved", progression: { timeUnlocked: "2021-01-01T00:00:00Z" } }] });
    });
    const list = await client.getAchievements("2535", "10", ["XboxOne", "XboxSeries", "PC"]);
    expect(seen).toEqual(["/api/v2/achievements/player/2535/10"]);
    expect(list === "private" ? 0 : list.length).toBe(1);
  });

  it("a 404 or an unrecognised body is unknown, not an empty list; a genuinely empty list is empty", async () => {
    const make = (res: () => Response) => setup(res).client;
    await expect(make(() => json({ code: "NOT_FOUND" }, 404)).getAchievements("2535", "10")).rejects.toThrow(/not found/);
    await expect(make(() => json({ foo: 1 })).getAchievements("2535", "10")).rejects.toThrow(/unexpected/);
    await expect(make(() => json({ achievements: [] })).getAchievements("2535", "10")).resolves.toEqual([]);
  });

  it("drops achievement records without an id or a name (360 and player routes)", async () => {
    // The left-out records are reported (one 360 record without an id, one without a name).
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = setup((url) =>
      url.pathname.includes("/title/")
        ? url.pathname.includes("/x360/")
          ? json(paged([]))
          : json(paged([{ name: "No id" }, definition(3, { name: "" }), definition(5)]))
        : json({ achievements: [{ name: "No id" }, { id: 5, name: "Ok" }, { id: 6 }] }),
    );
    const x360 = await client.getAchievements("2535", "11", ["Xbox360"]);
    expect(x360 === "private" ? [] : x360.map((a) => a.id)).toEqual(["5"]);
    const one = await client.getAchievements("2535", "11", ["XboxOne"]);
    expect(one === "private" ? [] : one.map((a) => a.id)).toEqual(["5"]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("a 360 definition listed twice counts once; an earned record without an id is reported", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { client } = setup((url) =>
        url.pathname === DEFINITIONS
          ? json(paged([definition(1), definition(2), definition(1, { name: "Again" })]))
          : json(paged([earned(2, "2010-05-04T12:00:00Z"), { name: "No id", unlocked: true }])),
      );
      const list = await client.getAchievements("2535000000000001", "1096157000", ["Xbox360"]);
      expect(list === "private" ? [] : list.map((a) => [a.id, a.name, a.unlocked])).toEqual([
        ["1", "Def 1", false],
        ["2", "Def 2", true],
      ]);
      expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringMatching(/360 earned achievements: 1 record\(s\) without an id/)]);
    } finally {
      warn.mockRestore();
    }
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

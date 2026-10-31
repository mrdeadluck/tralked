import { describe, expect, it, vi } from "vitest";
import { createIgdbClient, IgdbRateLimitError } from "./client";
import { createIgdbFixture } from "./fixture";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Route = (url: URL, init: RequestInit) => unknown;

function setup(routes: { token?: Route; external?: Route; games?: Route; ttb?: Route }) {
  const tokenRoute: Route =
    routes.token ?? (() => ({ access_token: "TOKEN", expires_in: 3600, token_type: "bearer" }));
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "id.twitch.tv") return jsonResponse(tokenRoute(url, init));
    const route = {
      "/v4/external_games": routes.external,
      "/v4/games": routes.games,
      "/v4/game_time_to_beats": routes.ttb,
    }[url.pathname];
    if (!route) throw new Error(`unexpected request ${url}`);
    return jsonResponse(route(url, init));
  });
  const sleep = vi.fn(async () => {});
  let clock = 0;
  const client = createIgdbClient({
    clientId: "CID",
    clientSecret: "SECRET",
    fetch: fetchMock as unknown as typeof fetch,
    now: () => clock,
    sleep,
  });
  return { client, fetchMock, sleep, advance: (ms: number) => (clock += ms) };
}

const fullGame = {
  id: 1234,
  name: "Hollow Knight",
  summary: "A bug adventure.",
  first_release_date: 1487894400,
  aggregated_rating: 90.5,
  cover: { id: 9, image_id: "co1rgi" },
  genres: [{ name: "Platform" }, { name: "Adventure" }],
  themes: [{ name: "Action" }],
  game_modes: [{ name: "Single player" }],
  player_perspectives: [{ name: "Side view" }],
  keywords: [{ name: "metroidvania" }, { name: "soulslike" }],
};

describe("igdb client", () => {
  it("authenticates with Twitch client credentials and queries the three endpoints", async () => {
    const { client, fetchMock } = setup({
      external: () => [{ game: 1234 }],
      games: () => [fullGame],
      ttb: () => [{ game_id: 1234, completely: 108000 }],
    });
    const result = await client.findBySteamAppId(367520);

    expect(result).toEqual({
      igdbId: 1234,
      name: "Hollow Knight",
      summary: "A bug adventure.",
      releaseDate: new Date(1487894400 * 1000),
      genres: ["Platform", "Adventure"],
      themes: ["Action"],
      gameModes: ["Single player"],
      perspectives: ["Side view"],
      keywords: ["metroidvania", "soulslike"],
      aggregatedRating: 90.5,
      coverImageId: "co1rgi",
      timeToBeatCompleteSec: 108000,
    });

    const [tokenCall, extCall, gamesCall, ttbCall] = fetchMock.mock.calls;
    const tokenUrl = new URL(String(tokenCall[0]));
    expect(tokenUrl.origin + tokenUrl.pathname).toBe("https://id.twitch.tv/oauth2/token");
    expect(tokenUrl.searchParams.get("client_id")).toBe("CID");
    expect(tokenUrl.searchParams.get("client_secret")).toBe("SECRET");
    expect(tokenUrl.searchParams.get("grant_type")).toBe("client_credentials");
    expect(tokenCall[1]?.method).toBe("POST");

    expect(String(extCall[0])).toBe("https://api.igdb.com/v4/external_games");
    expect(extCall[1]?.method).toBe("POST");
    const headers = extCall[1]?.headers as Record<string, string>;
    expect(headers["Client-ID"]).toBe("CID");
    expect(headers.Authorization).toBe("Bearer TOKEN");
    expect(String(extCall[1]?.body)).toContain('uid = "367520"');
    expect(String(extCall[1]?.body)).toContain("external_game_source = 1");

    expect(String(gamesCall[0])).toBe("https://api.igdb.com/v4/games");
    expect(String(gamesCall[1]?.body)).toContain("where id = 1234");
    for (const f of [
      "genres.name",
      "themes.name",
      "game_modes.name",
      "player_perspectives.name",
      "keywords.name",
      "aggregated_rating",
      "cover.image_id",
      "first_release_date",
      "summary",
    ]) {
      expect(String(gamesCall[1]?.body)).toContain(f);
    }

    expect(String(ttbCall[0])).toBe("https://api.igdb.com/v4/game_time_to_beats");
    expect(String(ttbCall[1]?.body)).toContain("where game_id = 1234");
    expect(String(ttbCall[1]?.body)).toContain("completely");
  });

  it("passes a timeout signal to the token request and to every query", async () => {
    const { client, fetchMock } = setup({
      external: () => [{ game: 1 }],
      games: () => [{ id: 1, name: "G" }],
      ttb: () => [],
    });
    await client.findBySteamAppId(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("returns null when the Steam app is unknown to IGDB", async () => {
    const { client, fetchMock } = setup({ external: () => [] });
    await expect(client.findBySteamAppId(1)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2); // token + external_games
  });

  it("returns null when the game record is missing", async () => {
    const { client } = setup({ external: () => [{ game: 5 }], games: () => [] });
    await expect(client.findBySteamAppId(1)).resolves.toBeNull();
  });

  it("omits optional fields and defaults lists to empty", async () => {
    const { client } = setup({
      external: () => [{ game: 7 }],
      games: () => [{ id: 7, name: "Bare" }],
      ttb: () => [],
    });
    await expect(client.findBySteamAppId(1)).resolves.toEqual({
      igdbId: 7,
      name: "Bare",
      summary: undefined,
      releaseDate: undefined,
      genres: [],
      themes: [],
      gameModes: [],
      perspectives: [],
      keywords: [],
      aggregatedRating: undefined,
      coverImageId: undefined,
      timeToBeatCompleteSec: undefined,
    });
  });

  it("caches the token until it expires, then refreshes", async () => {
    const tokenRoute = vi.fn(() => ({ access_token: "TOKEN", expires_in: 3600 }));
    const { client, advance } = setup({
      token: tokenRoute,
      external: () => [],
    });
    await client.findBySteamAppId(1);
    await client.findBySteamAppId(2);
    expect(tokenRoute).toHaveBeenCalledTimes(1);
    advance(3600 * 1000);
    await client.findBySteamAppId(3);
    expect(tokenRoute).toHaveBeenCalledTimes(2);
  });

  it("throttles to at most 4 requests per second", async () => {
    const { client, sleep } = setup({
      external: () => [{ game: 1 }],
      games: () => [{ id: 1, name: "G" }],
      ttb: () => [],
    });
    await client.findBySteamAppId(1);
    // 3 API calls with a frozen clock: the 2nd and 3rd must each wait 250ms.
    const waits = sleep.mock.calls.map((c) => (c as unknown as [number])[0]);
    expect(waits).toEqual([250, 250]);
  });

  it("retries a 429 once, after a delay, and then succeeds", async () => {
    let externalCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("twitch")) return jsonResponse({ access_token: "T", expires_in: 3600 });
      externalCalls++;
      return externalCalls === 1 ? jsonResponse({}, 429) : jsonResponse([]);
    });
    const sleep = vi.fn(async () => {});
    const client = createIgdbClient({
      clientId: "a",
      clientSecret: "b",
      fetch: fetchMock as unknown as typeof fetch,
      now: () => 0,
      sleep,
    });
    await expect(client.findBySteamAppId(1)).resolves.toBeNull();
    expect(externalCalls).toBe(2);
    const waits = sleep.mock.calls.map((c) => (c as unknown as [number])[0]);
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(1000);
  });

  it("throws IgdbRateLimitError when the retry is rate limited too", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("twitch")
        ? jsonResponse({ access_token: "T", expires_in: 3600 })
        : jsonResponse({}, 429),
    );
    const client = createIgdbClient({
      clientId: "a",
      clientSecret: "b",
      fetch: fetchMock as unknown as typeof fetch,
      sleep: async () => {},
    });
    await expect(client.findBySteamAppId(1)).rejects.toBeInstanceOf(IgdbRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(3); // token + 2 attempts
  });

  it("throws on API errors", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("twitch")
        ? jsonResponse({ access_token: "T", expires_in: 3600 })
        : jsonResponse({}, 500),
    );
    const client = createIgdbClient({
      clientId: "a",
      clientSecret: "b",
      fetch: fetchMock as unknown as typeof fetch,
      sleep: async () => {},
    });
    await expect(client.findBySteamAppId(1)).rejects.toThrow(/500/);
  });
});

describe("igdb client: search and media", () => {
  it("finds a game by exact (normalized) name only", async () => {
    const bodies: string[] = [];
    const { client } = setup({
      games: (_url, init) => {
        const body = String(init.body);
        bodies.push(body);
        if (body.startsWith("search")) {
          return [
            { id: 1, name: "Hollow Knight: Silksong" },
            { id: 2, name: "Hollow Knight™" },
          ];
        }
        return [{ id: 2, name: "Hollow Knight" }];
      },
      ttb: () => [],
    });
    const found = await client.findByName('Hollow "Knight"');
    expect(found?.igdbId).toBe(2);
    expect(bodies[0]).toBe('search "Hollow  Knight"; fields id,name; limit 10;');
    expect(bodies[1]).toContain("where id = 2");
  });

  it("returns null when no search hit has the same name", async () => {
    const { client } = setup({ games: () => [{ id: 1, name: "Hollow Knight: Silksong" }] });
    await expect(client.findByName("Hollow Knight")).resolves.toBeNull();
  });

  it("reads trailers, screenshots and artworks in one query", async () => {
    let body = "";
    const { client } = setup({
      games: (_url, init) => {
        body = String(init.body);
        return [
          {
            id: 7,
            videos: [
              { video_id: "UAO2urG23S4", name: "Trailer" },
              { video_id: "javascript:alert(1)", name: "Bad" },
            ],
            screenshots: [{ image_id: "sc1", width: 1920, height: 1080 }, {}],
            artworks: [{ image_id: "ar1" }],
          },
        ];
      },
    });
    await expect(client.getMedia(7)).resolves.toEqual({
      videos: [{ youtubeId: "UAO2urG23S4", name: "Trailer" }],
      screenshots: [{ imageId: "sc1", width: 1920, height: 1080 }],
      artworks: [{ imageId: "ar1", width: null, height: null }],
    });
    expect(body).toContain("where id = 7");
    expect(body).toContain("videos.video_id");
  });
});

describe("igdb fixture", () => {
  const igdb = createIgdbFixture();

  it("returns Hollow Knight for appId 367520", async () => {
    const hk = await igdb.findBySteamAppId(367520);
    expect(hk?.name).toBe("Hollow Knight");
    expect(hk?.genres).toContain("Platform");
    expect(hk?.keywords).toContain("soulslike");
    expect(hk?.releaseDate).toBeInstanceOf(Date);
    expect(hk?.timeToBeatCompleteSec).toBeGreaterThan(0);
  });

  it("returns null for unknown appIds", async () => {
    await expect(igdb.findBySteamAppId(1)).resolves.toBeNull();
  });
});

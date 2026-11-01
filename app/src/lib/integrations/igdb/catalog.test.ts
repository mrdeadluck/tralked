import { afterEach, describe, expect, it, vi } from "vitest";
import { createIgdbCatalogFixture, IGDB_FIXTURE_GAMES } from "./catalog-fixture";
import { createIgdbClient, precisionFromCategory, precisionFromFormat, toCatalogGame } from "./client";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function setup(answers: Record<string, unknown[]>) {
  const bodies: Record<string, string[]> = {};
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "id.twitch.tv") return jsonResponse({ access_token: "T", expires_in: 3600 });
    const endpoint = url.pathname.replace("/v4/", "");
    (bodies[endpoint] ??= []).push(String(init.body));
    return jsonResponse(answers[endpoint] ?? []);
  });
  const client = createIgdbClient({
    clientId: "CID",
    clientSecret: "S",
    fetch: fetchMock as unknown as typeof fetch,
    now: () => 0,
    sleep: async () => {},
  });
  return { client, bodies };
}

const record = {
  id: 77,
  name: " Astro Expedição ",
  platforms: [167, 48],
  first_release_date: 1_790_000_000,
  cover: { image_id: "co9abc" },
  hypes: 40,
  total_rating_count: 12,
  external_games: [
    { uid: "4115450", external_game_source: 1 },
    { uid: "abc", external_game_source: 1 },
    { uid: "999", category: 1 },
    { uid: "123", external_game_source: 5 },
  ],
};

describe("IGDB catalog reads", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps a game: trimmed name, platforms, Steam appids (new and deprecated source field), popularity", () => {
    expect(toCatalogGame(record)).toEqual({
      igdbId: 77,
      name: "Astro Expedição",
      platforms: [167, 48],
      firstReleaseDate: 1_790_000_000,
      steamAppIds: [4115450, 999],
      coverImageId: "co9abc",
      popularity: 52,
    });
    expect(toCatalogGame({ id: 1, name: "  " })).toBeNull();
  });

  it("reads date precision from the deprecated category enum, else from the /date_formats table", () => {
    expect(["day", "month", "year", "q1", "q2", "q3", "q4", "tbd"].map((_, i) => precisionFromCategory(i))).toEqual([
      "day", "month", "year", "q1", "q2", "q3", "q4", "tbd",
    ]);
    expect(precisionFromCategory(42)).toBe("tbd");
    expect(precisionFromFormat("YYYYMMMMDD")).toBe("day");
    expect(precisionFromFormat("YYYYMMMM")).toBe("month");
    expect(precisionFromFormat("YYYY")).toBe("year");
    expect(precisionFromFormat("YYYYQ3")).toBe("q3");
    expect(precisionFromFormat("TBD")).toBe("tbd");
    expect(precisionFromFormat(undefined)).toBe("tbd");
  });

  it("asks release_dates per window and order, popular games only; resolves date_format ids once", async () => {
    const { client, bodies } = setup({
      release_dates: [
        // New shape: date_format is an id of /date_formats (here 11 = day, 12 = quarter 4).
        { id: 5, date: 1_790_000_000, date_format: 11, human: "Sep 21, 2026", platform: 167, game: record },
        { id: 6, date: 1_790_000_000, date_format: 12, platform: 48, game: record },
        // Deprecated category next to date_format: date_format wins (category no longer tracks it).
        { id: 7, date: 1_790_000_000, category: 6, date_format: 11, platform: 48, game: record },
        // Unknown id, or neither field: never an exact day.
        { id: 8, date: 1_790_000_000, date_format: 99, platform: 48, game: record },
        { id: 9, date: 1_790_000_000, platform: 48, game: record },
        // A row whose game was not expanded is dropped.
        { id: 10, date: 1_790_000_000, platform: 48, game: 77 },
      ],
      date_formats: [
        { id: 11, format: "YYYYMMMMDD" },
        { id: 12, format: "YYYYQ4" },
        { id: 13, format: "TBD" },
      ],
    });
    const query = { platforms: [167, 48], from: 100, to: 200, popularOnly: true, offset: 500, limit: 900 };
    const rows = await client.getReleaseDates({ ...query, order: "desc" });
    await client.getReleaseDates({ ...query, order: "asc", popularOnly: false });
    const [past, ahead] = bodies.release_dates;
    expect(past).toContain("where platform = (167,48) & date >= 100 & date < 200");
    expect(past).toContain("game.game_type = (0,4,8,9,10,11) & (game.hypes > 0 | game.total_rating_count > 0)");
    expect(past).toContain("sort date desc; limit 500; offset 500;");
    expect(past).toContain("game.external_games.uid");
    expect(ahead).not.toContain("game.hypes > 0");
    expect(ahead).toContain("sort date asc;");
    expect(rows.map((r) => [r.id, r.precision])).toEqual([
      [5, "day"],
      [6, "q4"],
      [7, "day"],
      [8, "tbd"],
      [9, "tbd"],
    ]);
    expect(rows[0].game.steamAppIds).toEqual([4115450, 999]);
    // The format table is read once per client.
    expect(bodies.date_formats).toHaveLength(1);
  });

  it("pages the catalog by id, optionally only games changed since, counting raw rows", async () => {
    const { client, bodies } = setup({ games: [record, { id: 90, name: " " }] });
    const page = await client.listGames({ platforms: [7, 8], afterId: 1000, limit: 500 });
    expect(page.games.map((g) => g.igdbId)).toEqual([77]);
    // The unusable row still counts: a full raw page means there may be more.
    expect(page).toMatchObject({ rawCount: 2, lastId: 90 });
    await client.listGames({ platforms: [7], afterId: 0, updatedSince: 1_700_000_000, limit: 10 });
    expect(bodies.games[0]).toContain("where platforms = (7,8) & game_type = (0,4,8,9,10,11) & id > 1000; sort id asc; limit 500;");
    expect(bodies.games[1]).toContain("& id > 0 & updated_at > 1700000000; sort id asc; limit 10;");
  });

  it("reads details of many games in one request and platform ids by name", async () => {
    const { client, bodies } = setup({
      games: [{ id: 77, name: "Astro", summary: "S", genres: [{ name: "Shooter" }] }],
      platforms: [{ id: 508 }],
    });
    const games = await client.getGames([77, 78, -1]);
    expect(bodies.games[0]).toContain("where id = (77,78); limit 500;");
    expect(games).toEqual([expect.objectContaining({ igdbId: 77, name: "Astro", genres: ["Shooter"] })]);
    expect(await client.getGames([])).toEqual([]);
    expect(await client.findPlatformIds(['Nintendo "Switch" 2'])).toEqual([508]);
    expect(bodies.platforms[0]).toContain('where name = ("Nintendo Switch 2")');
  });
});

describe("IGDB catalog fixture", () => {
  it("serves releases around now, in either order, filtered and paged", async () => {
    const now = Date.UTC(2030, 5, 10, 15);
    const fixture = createIgdbCatalogFixture(() => now);
    const day = Date.UTC(2030, 5, 10) / 1000;
    const base = { platforms: [167, 169, 130, 48], popularOnly: true, offset: 0, limit: 500 };
    const all = await fixture.getReleaseDates({ ...base, from: day - 30 * 86400, to: day + 120 * 86400, order: "asc" });
    expect(all.length).toBeGreaterThan(4);
    expect(all.every((r, i) => i === 0 || all[i - 1].date! <= r.date!)).toBe(true);
    const back = await fixture.getReleaseDates({ ...base, from: day - 30 * 86400, to: day + 1, order: "desc" });
    expect(back.every((r, i) => i === 0 || back[i - 1].date! >= r.date!)).toBe(true);
    const ps5 = await fixture.getReleaseDates({ ...base, platforms: [167], from: day, to: day + 120 * 86400, order: "asc" });
    expect(ps5.every((r) => r.platform === 167 && r.date! >= day)).toBe(true);
    expect(await fixture.getReleaseDates({ ...base, from: 0, to: day * 2, order: "asc", limit: 2 })).toHaveLength(2);
  });

  it("pages its catalog by id and answers details", async () => {
    const fixture = createIgdbCatalogFixture();
    const first = await fixture.listGames({ platforms: [4, 7, 11, 6], afterId: 0, limit: 2 });
    expect(first.games.map((g) => g.igdbId)).toEqual([...IGDB_FIXTURE_GAMES].map((g) => g.igdbId).sort((a, b) => a - b).slice(0, 2));
    expect(first.rawCount).toBe(2);
    const rest = await fixture.listGames({ platforms: [4, 7, 11, 6], afterId: first.lastId, limit: 100 });
    expect(rest.games.every((g) => g.igdbId > first.lastId)).toBe(true);
    expect(await fixture.listGames({ platforms: [4], afterId: 0, updatedSince: 1, limit: 10 })).toEqual({ games: [], rawCount: 0, lastId: 0 });
    const [mario] = await fixture.getGames([1074]);
    expect(mario.name).toBe("Super Mario 64");
  });
});

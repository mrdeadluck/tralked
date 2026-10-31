import { describe, expect, it, vi } from "vitest";
import { createRawgClient } from "./client";
import { createRawgFixture } from "./fixture";

function setup(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  const client = createRawgClient({ apiKey: "KEY", fetch: fetchMock });
  return { client, fetchMock };
}

describe("rawg client", () => {
  it("searches Steam-store games by name and picks the exact name match", async () => {
    const { client, fetchMock } = setup({
      results: [
        { id: 1, name: "Hollow Knight: Silksong", metacritic: null, playtime: 0 },
        { id: 4062, name: "hollow knight", metacritic: 87, playtime: 12 },
      ],
    });
    await expect(client.findBySteamAppId(367520, "Hollow Knight")).resolves.toEqual({
      rawgId: 4062,
      metacritic: 87,
      playtimeHours: 12,
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://api.rawg.io/api/games");
    expect(url.searchParams.get("key")).toBe("KEY");
    expect(url.searchParams.get("search")).toBe("Hollow Knight");
    expect(url.searchParams.get("stores")).toBe("1");
  });

  it("passes a timeout signal to the request", async () => {
    const { client, fetchMock } = setup({ results: [] });
    await client.findBySteamAppId(1, "Any");
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps missing metacritic and zero playtime to undefined", async () => {
    const { client } = setup({
      results: [{ id: 2, name: "Indie", metacritic: null, playtime: 0 }],
    });
    await expect(client.findBySteamAppId(1, "Indie")).resolves.toEqual({
      rawgId: 2,
      metacritic: undefined,
      playtimeHours: undefined,
    });
  });

  it("returns null when no result matches the name exactly", async () => {
    const { client } = setup({ results: [{ id: 1, name: "Something Else" }] });
    await expect(client.findBySteamAppId(1, "Hollow Knight")).resolves.toBeNull();
  });

  it("returns null for empty results", async () => {
    const { client } = setup({ results: [] });
    await expect(client.findBySteamAppId(1, "X")).resolves.toBeNull();
  });

  it("throws on HTTP errors", async () => {
    const { client } = setup({}, 401);
    await expect(client.findBySteamAppId(1, "X")).rejects.toThrow(/401/);
  });
});

describe("rawg fixture", () => {
  const rawg = createRawgFixture();

  it("returns Hollow Knight data for appId 367520", async () => {
    const hk = await rawg.findBySteamAppId(367520, "Hollow Knight");
    expect(hk?.rawgId).toBeGreaterThan(0);
    expect(hk?.metacritic).toBe(87);
    expect(hk?.playtimeHours).toBeGreaterThan(0);
  });

  it("returns null for unknown appIds", async () => {
    await expect(rawg.findBySteamAppId(1, "Nope")).resolves.toBeNull();
  });
});

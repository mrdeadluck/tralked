import { describe, expect, it, vi } from "vitest";
import { assetUrl, createSgdbClient } from "./client";
import { createSgdbFixture } from "./fixture";

describe("sgdb client", () => {
  it("asks each shape apart (portrait and wide grids, heroes, logos) and keeps the first with its size", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const kind = url.pathname.split("/")[3];
      const wide = url.searchParams.get("dimensions")?.startsWith("920") ? "-wide" : "";
      return new Response(
        JSON.stringify({
          success: true,
          data: [
            { url: `https://img/${kind}${wide}-1`, width: 600, height: 900 },
            { url: `https://img/${kind}${wide}-2` },
          ],
        }),
        { status: 200 },
      );
    });
    const client = createSgdbClient({ apiKey: "KEY", fetch: fetchMock });
    const art = await client.getArt(367520);
    expect(art).toMatchObject({
      coverUrl: "https://img/grids-1",
      heroUrl: "https://img/heroes-1",
      logoUrl: "https://img/logos-1",
      cover: { url: "https://img/grids-1", width: 600, height: 900 },
      capsule: { url: "https://img/grids-wide-1" },
    });
    const urls = fetchMock.mock.calls.map((c) => String(c[0])).sort();
    expect(urls).toEqual([
      "https://www.steamgriddb.com/api/v2/grids/steam/367520?dimensions=600x900&types=static&nsfw=false&humor=false",
      "https://www.steamgriddb.com/api/v2/grids/steam/367520?dimensions=920x430,460x215&types=static&nsfw=false&humor=false",
      "https://www.steamgriddb.com/api/v2/heroes/steam/367520?types=static&nsfw=false&humor=false",
      "https://www.steamgriddb.com/api/v2/logos/steam/367520?types=static&nsfw=false&humor=false",
    ]);
    for (const call of fetchMock.mock.calls) {
      const init = (call as unknown as [unknown, RequestInit])[1];
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer KEY");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("leaves missing assets undefined (empty data and 404)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.includes("/grids/")) return new Response(JSON.stringify({ success: true, data: [] }));
      if (path.includes("/heroes/")) return new Response(JSON.stringify({ success: false }), { status: 404 });
      return new Response(JSON.stringify({ success: true, data: [{ url: "https://img/logo" }] }));
    });
    const client = createSgdbClient({ apiKey: "KEY", fetch: fetchMock });
    const art = await client.getArt(1);
    expect(art.coverUrl).toBeUndefined();
    expect(art.capsule).toBeUndefined();
    expect(art.heroUrl).toBeUndefined();
    expect(art.logo).toEqual({ url: "https://img/logo", width: null, height: null });
  });

  it("marks art whose thumbnail exists only in PNG (transparent images)", () => {
    const grid = "https://cdn2.steamgriddb.com/grid/1130064514f563b2d894f0840d31db3c.png";
    expect(assetUrl({ url: grid, thumb: "https://cdn2.steamgriddb.com/thumb/1130064514f563b2d894f0840d31db3c.png" })).toBe(
      `${grid}#png-thumb`,
    );
    expect(assetUrl({ url: grid, thumb: "https://cdn2.steamgriddb.com/thumb/1130064514f563b2d894f0840d31db3c.jpg" })).toBe(grid);
    expect(assetUrl({ url: grid })).toBe(grid);
    expect(assetUrl(undefined)).toBeUndefined();
  });

  it("throws on other HTTP errors", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    const client = createSgdbClient({ apiKey: "KEY", fetch: fetchMock });
    await expect(client.getArt(1)).rejects.toThrow(/401/);
  });
});

describe("sgdb fixture", () => {
  const sgdb = createSgdbFixture();

  it("returns art for Hollow Knight", async () => {
    const art = await sgdb.getArt(367520);
    expect(art.coverUrl).toMatch(/^https:\/\//);
    expect(art.heroUrl).toMatch(/^https:\/\//);
    expect(art.logoUrl).toMatch(/^https:\/\//);
  });

  it("returns an empty object for unknown appIds", async () => {
    await expect(sgdb.getArt(1)).resolves.toEqual({});
  });
});

import { describe, expect, it, vi } from "vitest";
import { createSgdbClient } from "./client";
import { createSgdbFixture } from "./fixture";

describe("sgdb client", () => {
  it("fetches grid, hero and logo with bearer auth and takes the first url", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      const kind = path.split("/")[3];
      return new Response(
        JSON.stringify({ success: true, data: [{ url: `https://img/${kind}-1` }, { url: `https://img/${kind}-2` }] }),
        { status: 200 },
      );
    });
    const client = createSgdbClient({ apiKey: "KEY", fetch: fetchMock });
    await expect(client.getArt(367520)).resolves.toEqual({
      coverUrl: "https://img/grids-1",
      heroUrl: "https://img/heroes-1",
      logoUrl: "https://img/logos-1",
    });
    const urls = fetchMock.mock.calls.map((c) => String(c[0])).sort();
    expect(urls).toEqual([
      "https://www.steamgriddb.com/api/v2/grids/steam/367520",
      "https://www.steamgriddb.com/api/v2/heroes/steam/367520",
      "https://www.steamgriddb.com/api/v2/logos/steam/367520",
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
    await expect(client.getArt(1)).resolves.toEqual({
      coverUrl: undefined,
      heroUrl: undefined,
      logoUrl: "https://img/logo",
    });
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

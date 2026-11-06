import { afterEach, describe, expect, it, vi } from "vitest";
import { revalidateGames } from "./revalidate-games";

afterEach(() => vi.unstubAllGlobals());

describe("revalidateGames", () => {
  it("posts the slugs to APP_URL with the cron secret", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await revalidateGames(["a", "b"], { CRON_SECRET: "s3", APP_URL: "https://example.test" } as never);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://example.test/api/revalidate-games");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer s3");
    expect(JSON.parse(init.body as string)).toEqual({ slugs: ["a", "b"] });
  });

  it("defaults to tralked.com, needs the secret and fails on a refusal", async () => {
    const fetchMock = vi.fn(async () => new Response("no", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(revalidateGames(["a"], {} as never)).rejects.toThrow("CRON_SECRET");
    await expect(revalidateGames(["a"], { CRON_SECRET: "x" } as never)).rejects.toThrow("401");
    expect(String((fetchMock.mock.calls[0] as unknown as [URL])[0])).toBe("https://tralked.com/api/revalidate-games");
  });
});

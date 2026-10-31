import { describe, expect, it, vi } from "vitest";
import { createPoliteFetch, isSteamCdnUrl, readText, TRALKED_USER_AGENT } from "./polite-fetch";

/** A virtual clock: `sleep` advances time instead of waiting. */
function clock() {
  let time = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
    },
    sleeps,
  };
}

describe("createPoliteFetch", () => {
  it("spaces requests to the same host by the interval, other hosts independently, and sends the User-Agent", async () => {
    const c = clock();
    const starts: { host: string; at: number; ua: string | null }[] = [];
    const politeFetch = createPoliteFetch({
      minIntervalMs: 1200,
      hostIntervalsMs: { "store.steampowered.com": 1500 },
      now: c.now,
      sleep: c.sleep,
      fetch: async (url, init) => {
        starts.push({ host: new URL(String(url)).host, at: c.now(), ua: new Headers(init?.headers).get("user-agent") });
        return new Response("ok");
      },
    });

    await politeFetch("https://steamcommunity.com/a");
    await politeFetch("https://steamcommunity.com/b");
    await politeFetch("https://steamspy.com/x");
    await politeFetch("https://store.steampowered.com/1");
    await politeFetch("https://store.steampowered.com/2");

    const at = (host: string) => starts.filter((s) => s.host === host).map((s) => s.at);
    const community = at("steamcommunity.com");
    expect(community[1] - community[0]).toBeGreaterThanOrEqual(1200);
    const store = at("store.steampowered.com");
    expect(store[1] - store[0]).toBeGreaterThanOrEqual(1500);
    expect(starts.every((s) => s.ua === TRALKED_USER_AGENT)).toBe(true);
  });

  it("concurrent callers queue up per host", async () => {
    // Time stands still: every caller reserves its slot before anyone has slept.
    const sleeps: number[] = [];
    const politeFetch = createPoliteFetch({
      now: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetch: async () => new Response("ok"),
    });
    await Promise.all([1, 2, 3].map((n) => politeFetch(`https://steamcommunity.com/${n}`)));
    expect(sleeps).toEqual([1200, 2400]);
  });

  it("retries 429 and 5xx with backoff (Retry-After wins), then returns the response", async () => {
    const c = clock();
    const statuses = [429, 503, 200];
    const retries: { attempt: number; waitMs: number; reason: string }[] = [];
    const politeFetch = createPoliteFetch({
      now: c.now,
      sleep: c.sleep,
      backoffMs: 5000,
      onRetry: ({ attempt, waitMs, reason }) => retries.push({ attempt, waitMs, reason }),
      fetch: async () => {
        const status = statuses.shift()!;
        return new Response("", { status, headers: status === 429 ? { "retry-after": "30" } : {} });
      },
    });
    const res = await politeFetch("https://store.steampowered.com/api/appdetails?appids=1");
    expect(res.status).toBe(200);
    expect(retries).toEqual([
      { attempt: 1, waitMs: 30_000, reason: "HTTP 429" },
      { attempt: 2, waitMs: 10_000, reason: "HTTP 503" },
    ]);
  });

  it("gives up after the last retry: the final response, or the network error", async () => {
    const c = clock();
    const always500 = createPoliteFetch({ now: c.now, sleep: c.sleep, retries: 2, fetch: async () => new Response("", { status: 500 }) });
    expect((await always500("https://steamspy.com/api.php")).status).toBe(500);

    let calls = 0;
    const offline = createPoliteFetch({
      now: c.now,
      sleep: c.sleep,
      retries: 1,
      fetch: async () => {
        calls++;
        throw new TypeError("fetch failed");
      },
    });
    await expect(offline("https://steamspy.com/api.php")).rejects.toThrow("fetch failed");
    expect(calls).toBe(2);
  });

  it("a 429 makes every queued caller of that host back off, not just the refused one", async () => {
    vi.useFakeTimers();
    try {
      const t0 = Date.now();
      const starts: Record<string, number[]> = {};
      let refused = false;
      const politeFetch = createPoliteFetch({
        fetch: async (url) => {
          const path = new URL(String(url)).pathname;
          (starts[path] ??= []).push(Date.now() - t0);
          if (path === "/a" && !refused) {
            refused = true;
            return new Response("", { status: 429, headers: { "retry-after": "30" } });
          }
          return new Response("ok");
        },
      });
      const done = Promise.all([
        politeFetch("https://steamcommunity.com/a"),
        politeFetch("https://steamcommunity.com/b"),
        politeFetch("https://steamspy.com/c"),
      ]);
      await vi.advanceTimersByTimeAsync(60_000);
      await done;
      // /b had the 1.2 s slot, but the host was refused at 0 s for 30 s.
      expect(starts["/b"][0]).toBeGreaterThanOrEqual(30_000);
      expect(starts["/a"][1]).toBeGreaterThanOrEqual(30_000);
      // Other hosts are not affected.
      expect(starts["/c"][0]).toBeLessThan(1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("only fetches Steam endpoints over https, and follows redirects only to them", async () => {
    const urls: string[] = [];
    const politeFetch = createPoliteFetch({
      sleep: async () => undefined,
      fetch: async (url) => {
        urls.push(String(url));
        const path = new URL(String(url)).pathname;
        if (path === "/moved") return new Response(null, { status: 302, headers: { location: "https://store.steampowered.com/here" } });
        if (path === "/away") return new Response(null, { status: 302, headers: { location: "https://evil.example/x" } });
        return new Response("ok");
      },
    });
    await expect(politeFetch("https://evil.example/")).rejects.toThrow(/Refusing/);
    await expect(politeFetch("http://steamcommunity.com/")).rejects.toThrow(/Refusing/);
    expect((await politeFetch("https://steamcommunity.com/moved")).status).toBe(200);
    expect(urls.at(-1)).toBe("https://store.steampowered.com/here");
    expect((await politeFetch("https://steamcommunity.com/away")).status).toBe(302);
    expect(urls).not.toContain("https://evil.example/x");
    // `redirect: "manual"` hands every redirect back to the caller.
    expect((await politeFetch("https://steamcommunity.com/moved", { redirect: "manual" })).status).toBe(302);
  });

  it("readText refuses bodies over the cap, declared or streamed", async () => {
    await expect(readText(new Response("x".repeat(100)), 50)).rejects.toThrow(/too large/);
    await expect(readText(new Response("small", { headers: { "content-length": "999999999" } }))).rejects.toThrow(/too large/);
    await expect(readText(new Response("é ok"))).resolves.toBe("é ok");
    expect(isSteamCdnUrl("https://shared.akamai.steamstatic.com/a.jpg")).toBe(true);
    expect(isSteamCdnUrl("https://steamstatic.com.evil.example/a.jpg")).toBe(false);
    expect(isSteamCdnUrl("http://shared.akamai.steamstatic.com/a.jpg")).toBe(false);
  });

  it("does not retry client errors", async () => {
    let calls = 0;
    const politeFetch = createPoliteFetch({
      sleep: async () => undefined,
      fetch: async () => {
        calls++;
        return new Response("", { status: 404 });
      },
    });
    expect((await politeFetch("https://steamcommunity.com/x")).status).toBe(404);
    expect(calls).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { createPoliteFetch, TRALKED_USER_AGENT } from "./polite-fetch";

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

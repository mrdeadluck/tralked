import { beforeEach, describe, expect, it } from "vitest";
import { consumeRateLimit, RATE_LIMIT, rateLimitHeaders, resetRateLimits } from "./rate-limit";

beforeEach(() => resetRateLimits());

describe("rate limit", () => {
  it("allows 60 requests per minute per key, then refuses until the window ends", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < RATE_LIMIT; i++) expect(consumeRateLimit("k", t0 + i).ok).toBe(true);
    const refused = consumeRateLimit("k", t0 + 30_000);
    expect(refused).toMatchObject({ ok: false, remaining: 0, resetSeconds: 30 });
    expect(rateLimitHeaders(refused)["Retry-After"]).toBe("30");
    expect(consumeRateLimit("k", t0 + 60_000)).toMatchObject({ ok: true, remaining: RATE_LIMIT - 1 });
  });

  it("counts each key on its own", () => {
    for (let i = 0; i < RATE_LIMIT; i++) consumeRateLimit("a", 0);
    expect(consumeRateLimit("a", 1).ok).toBe(false);
    expect(consumeRateLimit("b", 1).ok).toBe(true);
  });

  it("reports the remaining budget in headers", () => {
    const headers = rateLimitHeaders(consumeRateLimit("c", 0));
    expect(headers).toEqual({ "X-RateLimit-Limit": "60", "X-RateLimit-Remaining": "59", "X-RateLimit-Reset": "60" });
  });
});

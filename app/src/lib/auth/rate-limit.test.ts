import { describe, expect, it } from "vitest";
import { createLimiter } from "./rate-limit";

describe("createLimiter (in-memory, fixed window per key)", () => {
  it("allows `limit` hits per window, then refuses with the seconds until it resets", () => {
    const limiter = createLimiter({ limit: 3, windowMs: 60_000 });
    const t0 = 1_000_000;
    expect(limiter.hit("ip:1", t0).ok).toBe(true);
    expect(limiter.hit("ip:1", t0 + 1).ok).toBe(true);
    expect(limiter.hit("ip:1", t0 + 2).ok).toBe(true);
    expect(limiter.hit("ip:1", t0 + 10_000)).toEqual({ ok: false, retryAfterSec: 50 });
    // Another key has its own budget.
    expect(limiter.hit("ip:2", t0 + 10_000).ok).toBe(true);
    // A new window starts after windowMs.
    expect(limiter.hit("ip:1", t0 + 60_000).ok).toBe(true);
  });

  it("check() does not count; reset() forgets a key", () => {
    const limiter = createLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check("a", 0).ok).toBe(true);
    expect(limiter.check("a", 0).ok).toBe(true);
    limiter.hit("a", 0);
    expect(limiter.check("a", 1).ok).toBe(false);
    limiter.reset("a");
    expect(limiter.check("a", 1).ok).toBe(true);
  });

  it("drops expired windows so memory does not grow without bound", () => {
    const limiter = createLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });
    limiter.hit("a", 0);
    limiter.hit("b", 0);
    limiter.hit("c", 5000);
    expect(limiter.size()).toBe(1);
  });
});

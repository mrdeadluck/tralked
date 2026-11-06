import { beforeEach, describe, expect, it, vi } from "vitest";

const updateTag = vi.fn();
const refresh = vi.fn();
vi.mock("next/cache", () => ({ updateTag, refresh, cacheLife: vi.fn(), cacheTag: vi.fn() }));

let userAgent = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36";
let ip = "203.0.113.50";
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": userAgent, "x-forwarded-for": ip }),
}));

const load = vi.fn(async () => "none" as "none" | "loaded" | "failed");
vi.mock("@/lib/sync/psn-catalog-trophies", () => ({ loadPsnCatalogTrophies: () => load() }));

const findUnique = vi.fn(async () => ({ id: "g1", slug: "jogo-um" }));
vi.mock("@/lib/db", () => ({ prisma: { game: { findUnique } } }));

describe("loadPsnTrophies", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    userAgent = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36";
    ip = "203.0.113.50";
    (await import("@/lib/auth/rate-limit")).psnOpenIpLimiter.clear();
  });

  it("does nothing for robots and scripts", async () => {
    const { loadPsnTrophies } = await import("./psn-actions");
    for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1)", "python-requests/2.31", "GPTBot/1.0", "HeadlessChrome/120", ""]) {
      userAgent = ua;
      expect(await loadPsnTrophies("g1")).toEqual({ status: "skipped" });
    }
    expect(load).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("limits each IP to 30 opens an hour", async () => {
    const { loadPsnTrophies } = await import("./psn-actions");
    for (let i = 0; i < 30; i++) expect(await loadPsnTrophies("g1")).toEqual({ status: "none" });
    expect(await loadPsnTrophies("g1")).toEqual({ status: "limited" });
    expect(load).toHaveBeenCalledTimes(30);
    ip = "203.0.113.51"; // another visitor is not affected
    expect(await loadPsnTrophies("g1")).toEqual({ status: "none" });
  });

  it("expires the game's cache only when a list was written", async () => {
    const { loadPsnTrophies } = await import("./psn-actions");
    load.mockResolvedValueOnce("failed");
    expect(await loadPsnTrophies("g1")).toEqual({ status: "failed" });
    expect(updateTag).not.toHaveBeenCalled();
    load.mockResolvedValueOnce("loaded");
    expect(await loadPsnTrophies("g1")).toEqual({ status: "loaded" });
    expect(updateTag).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed id before anything else", async () => {
    const { loadPsnTrophies } = await import("./psn-actions");
    expect(await loadPsnTrophies("../x")).toEqual({ status: "invalid" });
    expect(findUnique).not.toHaveBeenCalled();
  });
});

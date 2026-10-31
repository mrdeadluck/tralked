import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
const updateTag = vi.fn();
const toggleLike = vi.fn();
const tx = {};
const prisma = { $transaction: (fn: (t: object) => unknown) => fn(tx) };

vi.mock("@/lib/auth/session", () => ({ getSessionUser }));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  updateTag,
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("./gallery", () => ({ toggleLike }));

const { likePhoto } = await import("./actions");
const { takeLikeToggle } = await import("./limits");

beforeEach(() => {
  vi.clearAllMocks();
  toggleLike.mockResolvedValue({ status: "ok", liked: true, likeCount: 3 });
});

describe("likePhoto", () => {
  it("revalidates only the photo's own page, not every gallery listing", async () => {
    getSessionUser.mockResolvedValue({ id: "tag-user", handle: "eu" });
    expect(await likePhoto({ photoId: "p1" })).toEqual({ status: "ok", liked: true, likeCount: 3 });
    expect(updateTag.mock.calls).toEqual([["photo:p1"]]);
  });

  it("allows 30 like/unlike clicks per minute, then refuses without touching the database", async () => {
    getSessionUser.mockResolvedValue({ id: "busy-user", handle: "eu" });
    for (let i = 0; i < 30; i++) expect((await likePhoto({ photoId: "p1" })).status).toBe("ok");
    const refused = await likePhoto({ photoId: "p1" });
    expect(refused).toMatchObject({ status: "rate_limited", message: expect.stringMatching(/curtiu muitas vezes/) });
    expect(toggleLike).toHaveBeenCalledTimes(30);
  });

  it("maps a database-side like limit to rate_limited", async () => {
    getSessionUser.mockResolvedValue({ id: "db-limited", handle: "eu" });
    toggleLike.mockResolvedValue({ status: "rate_limited" });
    expect((await likePhoto({ photoId: "p1" })).status).toBe("rate_limited");
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("takeLikeToggle", () => {
  it("is a sliding one-minute window per user", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) expect(takeLikeToggle("window-user", t0 + i)).toBe(true);
    expect(takeLikeToggle("window-user", t0 + 100)).toBe(false);
    expect(takeLikeToggle("someone-else", t0 + 100)).toBe(true);
    expect(takeLikeToggle("window-user", t0 + 60_001)).toBe(true);
  });
});

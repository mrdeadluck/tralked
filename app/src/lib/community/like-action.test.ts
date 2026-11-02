import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
const updateTag = vi.fn();
const react = vi.fn();
const tx = {};
const prisma = { $transaction: (fn: (t: object) => unknown) => fn(tx) };

vi.mock("@/lib/auth/session", () => ({ getSessionUser }));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  updateTag,
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("./reactions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./reactions")>()),
  react,
}));

const { reactTo } = await import("./engagement-actions");
const { takeLikeToggle } = await import("./limits");

const OK = {
  status: "ok",
  mine: 1,
  counts: { likes: 3, dislikes: 1 },
  xp: { given: 5, received: 10 },
  levelUp: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  react.mockResolvedValue(OK);
});

describe("reactTo", () => {
  it("revalidates only a photo's own page (other targets read their counts live)", async () => {
    getSessionUser.mockResolvedValue({ id: "tag-user", handle: "eu" });
    expect(await reactTo({ targetType: "photo", targetId: "p1", value: 1 })).toEqual({
      status: "ok",
      mine: 1,
      counts: { likes: 3, dislikes: 1 },
      reward: { xpGained: 5, reason: "Curtida", skill: null, levelUp: null },
    });
    expect(react).toHaveBeenCalledWith(tx, "tag-user", "photo", "p1", 1);
    expect(updateTag.mock.calls).toEqual([["photo:p1"]]);

    updateTag.mockClear();
    for (const targetType of ["article", "comment", "guide"]) {
      expect((await reactTo({ targetType, targetId: "x1", value: -1 })).status).toBe("ok");
    }
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("hands back the XP the reactor earned, with the level up, or no reward at all", async () => {
    getSessionUser.mockResolvedValue({ id: "reward-user", handle: "eu" });
    react.mockResolvedValueOnce({ ...OK, xp: { given: 5, received: 0 }, levelUp: { from: 9, to: 10 } });
    expect(await reactTo({ targetType: "comment", targetId: "c9", value: -1 })).toMatchObject({
      reward: { xpGained: 5, reason: "Reação", levelUp: { from: 9, to: 10 } },
    });
    react.mockResolvedValueOnce({ ...OK, xp: { given: 0, received: 10 } });
    expect(await reactTo({ targetType: "comment", targetId: "c9", value: 1 })).toMatchObject({ reward: null });
  });

  it("allows 30 reaction clicks per minute, then refuses without touching the database", async () => {
    getSessionUser.mockResolvedValue({ id: "busy-user", handle: "eu" });
    for (let i = 0; i < 30; i++) {
      expect((await reactTo({ targetType: "comment", targetId: "c1", value: 1 })).status).toBe("ok");
    }
    const refused = await reactTo({ targetType: "comment", targetId: "c1", value: 1 });
    expect(refused).toMatchObject({ status: "rate_limited", message: expect.stringMatching(/reagiu muitas vezes/) });
    expect(react).toHaveBeenCalledTimes(30);
  });

  it("maps a database-side limit and a missing item", async () => {
    getSessionUser.mockResolvedValue({ id: "db-limited", handle: "eu" });
    react.mockResolvedValueOnce({ status: "rate_limited" });
    expect((await reactTo({ targetType: "photo", targetId: "p1", value: 1 })).status).toBe("rate_limited");
    react.mockResolvedValueOnce({ status: "not_found" });
    expect((await reactTo({ targetType: "photo", targetId: "p1", value: 1 })).status).toBe("not_found");
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

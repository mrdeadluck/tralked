import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
const updateTag = vi.fn();
// Any database access would throw: refused requests must stop before touching it.
const prisma = new Proxy(
  {},
  {
    get(_target, key) {
      throw new Error(`unexpected database access: prisma.${String(key)}`);
    },
  },
);

vi.mock("@/lib/auth/session", () => ({ getSessionUser }));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  updateTag,
}));
vi.mock("@/lib/db", () => ({ prisma }));

const actions = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
  getSessionUser.mockResolvedValue(null);
});

describe("community actions", () => {
  it("refuse every mutation without login", async () => {
    const calls = [
      actions.postComment({ targetType: "photo", targetId: "p1", body: "oi" }),
      actions.updateComment({ id: "c1", body: "oi" }),
      actions.removeComment({ id: "c1" }),
      actions.reportContent({ targetType: "comment", targetId: "c1", reason: "Spam ou propaganda" }),
      actions.likePhoto({ photoId: "p1" }),
      actions.startThread({ section: "geral", title: "Um título", body: "corpo" }),
      actions.replyToThread({ threadId: "t1", body: "oi" }),
      actions.markThreadSolved({ threadId: "t1", postId: "p1" }),
    ];
    for (const result of await Promise.all(calls)) {
      expect(result.status).toBe("unauthenticated");
    }
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("refuse empty or HTML bodies and malformed arguments before any database access", async () => {
    getSessionUser.mockResolvedValue({ id: "u1", handle: "eu" });
    const results = await Promise.all([
      actions.postComment({ targetType: "photo", targetId: "p1", body: "   " }),
      actions.postComment({ targetType: "photo", targetId: "p1", body: "<script>alert(1)</script>" }),
      actions.postComment({ targetType: "user", targetId: "p1", body: "oi" }),
      actions.replyToThread({ threadId: "t1", body: "<b>negrito</b>" }),
      actions.startThread({ section: "geral", title: "<i>x</i> título", body: "ok" }),
      actions.reportContent({ targetType: "comment", targetId: "c1", reason: "porque sim" }),
      actions.likePhoto("not an object"),
    ]);
    for (const result of results) expect(result.status).toBe("invalid");
    expect(results[1]).toMatchObject({ message: expect.stringMatching(/HTML/), field: "body" });
  });

  it("a muted user cannot comment, edit or post in the forum, but can still like and report", async () => {
    getSessionUser.mockResolvedValue({ id: "u1", handle: "eu", mutedUntil: new Date(Date.now() + 86_400_000) });
    const refused = await Promise.all([
      actions.postComment({ targetType: "photo", targetId: "p1", body: "oi" }),
      actions.updateComment({ id: "c1", body: "oi" }),
      actions.startThread({ section: "geral", title: "Um título", body: "corpo" }),
      actions.replyToThread({ threadId: "t1", body: "oi" }),
    ]);
    for (const result of refused) {
      expect(result).toMatchObject({ status: "forbidden", message: expect.stringMatching(/silenciado até/) });
    }
    // Not a posting action: it gets past the sanction check (and fails on validation here).
    expect((await actions.likePhoto("not an object")).status).toBe("invalid");
  });

  it("a banned user (stale session object) is refused everywhere before the database", async () => {
    getSessionUser.mockResolvedValue({ id: "u1", handle: "eu", bannedUntil: new Date(Date.now() + 86_400_000) });
    const results = await Promise.all([
      actions.postComment({ targetType: "photo", targetId: "p1", body: "oi" }),
      actions.likePhoto({ photoId: "p1" }),
      actions.reportContent({ targetType: "comment", targetId: "c1", reason: "Spam ou propaganda" }),
      actions.removeComment({ id: "c1" }),
    ]);
    for (const result of results) expect(result).toMatchObject({ status: "forbidden", message: expect.stringMatching(/suspensa/) });
  });

  it("loading more comments validates its arguments", async () => {
    expect((await actions.loadMoreComments({ targetType: "nope", targetId: "x", cursor: "c" })) as { status: string }).toMatchObject({
      status: "invalid",
    });
  });
});

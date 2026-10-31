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

  it("loading more comments validates its arguments", async () => {
    expect((await actions.loadMoreComments({ targetType: "nope", targetId: "x", cursor: "c" })) as { status: string }).toMatchObject({
      status: "invalid",
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
const updateTag = vi.fn();
const moderateComment = vi.fn();
const setDiscussionLock = vi.fn();
const moderateArticle = vi.fn();
const removeGuide = vi.fn();
const applySanction = vi.fn();
const liftSanction = vi.fn();

vi.mock("@/lib/auth/session", () => ({ getSessionUser }));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  updateTag,
}));
vi.mock("@/lib/community/xp", () => ({ recomputeQuietly: vi.fn() }));
vi.mock("./comments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./comments")>()),
  moderateComment,
  setDiscussionLock,
}));
vi.mock("./content", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./content")>()),
  moderateArticle,
  removeGuide,
}));
vi.mock("./sanctions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sanctions")>()),
  applySanction,
  liftSanction,
}));

const actions = await import("./actions");

const as = (role: string | null) => getSessionUser.mockResolvedValue(role === null ? null : { id: `id-${role}`, handle: role, role });

const inputs = {
  comment: { id: "c1", action: "remove", reason: "spam" },
  lock: { targetType: "article", targetId: "a1", locked: true },
  article: { id: "a1", op: "featured", featured: 2 },
  guide: { id: "g1", reason: "plágio" },
  sanction: { handle: "@troll", kind: "mute", until: "2026-12-01", reason: "" },
  lift: { userId: "u9", kind: "ban" },
};

beforeEach(() => {
  vi.clearAllMocks();
  moderateComment.mockResolvedValue({ ok: true, tags: ["article:x", "news"], recompute: [] });
  setDiscussionLock.mockResolvedValue({ ok: true });
  moderateArticle.mockResolvedValue({ ok: true, slug: "minha-materia" });
  removeGuide.mockResolvedValue({ ok: true, gameSlug: "hades" });
  applySanction.mockResolvedValue({ ok: true });
  liftSanction.mockResolvedValue({ ok: true });
});

const all = () =>
  Promise.all([
    actions.moderateCommentAction(inputs.comment),
    actions.lockDiscussionAction(inputs.lock),
    actions.moderateArticleAction(inputs.article),
    actions.removeGuideAction(inputs.guide),
    actions.sanctionUserAction(inputs.sanction),
    actions.liftSanctionAction(inputs.lift),
  ]);

describe("moderation Server Actions", () => {
  it.each([null, "user", "author"])("refuse %s without touching anything", async (role) => {
    as(role);
    for (const result of await all()) expect(result).toEqual({ ok: false, error: "Você não tem permissão para fazer isso." });
    for (const fn of [moderateComment, setDiscussionLock, moderateArticle, removeGuide, applySanction, liftSanction]) {
      expect(fn).not.toHaveBeenCalled();
    }
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("taking a guide off refreshes its game and the home's list of guides", async () => {
    as("moderator");
    expect(await actions.removeGuideAction(inputs.guide)).toEqual({ ok: true });
    expect(updateTag).toHaveBeenCalledWith("game:hades");
    expect(updateTag).toHaveBeenCalledWith("guides");
  });

  it("let a moderator moderate the community but not re-file articles", async () => {
    as("moderator");
    const [comment, lock, article, guide, sanction, lift] = await all();
    expect([comment, lock, guide, sanction, lift]).toEqual(Array(5).fill({ ok: true }));
    expect(article).toEqual({ ok: false, error: "Você não tem permissão para fazer isso." });
    expect(moderateArticle).not.toHaveBeenCalled();
    expect(moderateComment).toHaveBeenCalledWith({ id: "c1", action: "remove", reason: "spam" }, "id-moderator");
    expect(applySanction).toHaveBeenCalledWith(expect.objectContaining({ id: "id-moderator", role: "moderator" }), {
      handle: "troll",
      kind: "mute",
      until: "2026-12-01",
      reason: "",
    });
  });

  it.each(["editor", "admin"])("let an %s do everything and refresh the cached pages", async (role) => {
    as(role);
    expect(await all()).toEqual(Array(6).fill({ ok: true }));
    expect(updateTag.mock.calls.flat()).toEqual(expect.arrayContaining(["article:x", "news", "article:minha-materia", "game:hades"]));
  });

  it("validate the input before acting", async () => {
    as("admin");
    const results = await Promise.all([
      actions.moderateCommentAction({ id: "c1", action: "explode" }),
      actions.moderateCommentAction({ id: "c1", action: "remove", reason: "<b>x</b>" }),
      actions.lockDiscussionAction({ targetType: "user", targetId: "u1", locked: true }),
      actions.moderateArticleAction({ id: "a1", op: "category", category: "NOPE" }),
      actions.moderateArticleAction({ id: "a1", op: "featured", featured: 7 }),
      actions.sanctionUserAction({ handle: "x", kind: "exile", until: "2026-12-01" }),
      actions.sanctionUserAction({ handle: "x", kind: "ban", until: "amanhã" }),
    ]);
    for (const result of results) expect(result.ok).toBe(false);
    for (const fn of [moderateComment, setDiscussionLock, moderateArticle, applySanction]) expect(fn).not.toHaveBeenCalled();
  });

  it("pass domain errors through", async () => {
    as("moderator");
    moderateComment.mockResolvedValue({ ok: false, error: "Esse comentário não existe mais." });
    expect(await actions.moderateCommentAction(inputs.comment)).toEqual({ ok: false, error: "Esse comentário não existe mais." });
    expect(updateTag).not.toHaveBeenCalled();
  });
});

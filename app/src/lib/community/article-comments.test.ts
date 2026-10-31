import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const updateTag = vi.fn();
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  updateTag,
}));
const getSessionUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));

const { prisma } = await import("@/lib/db");
const { createComment, deleteComment, recountAllArticleComments, syncArticleComments } = await import("./comments");
const { moderateContent } = await import("@/lib/admin/moderation");
const { postComment, removeComment } = await import("./actions");

// Article.comments must follow the visible comments of the article. Fixtures use the t11-ac prefix.
const PREFIX = "t11-ac";
let article: { id: string; slug: string; comments: number };
let author: string;
let moderator: string;

const count = async () => (await prisma.article.findUniqueOrThrow({ where: { id: article.id } })).comments;
const visible = () => prisma.comment.count({ where: { targetType: "article", targetId: article.id, status: "visible" } });

async function cleanup() {
  const users = await prisma.user.findMany({ where: { handle: { startsWith: PREFIX } }, select: { id: true } });
  await prisma.comment.deleteMany({ where: { authorId: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

beforeAll(async () => {
  await cleanup();
  article = await prisma.article.findFirstOrThrow({
    where: { status: "published" },
    orderBy: { publishedAt: "desc" },
    select: { id: true, slug: true, comments: true },
  });
  await syncArticleComments(prisma, article.id);
  author = (await prisma.user.create({ data: { handle: `${PREFIX}-autor`, displayName: "Autor" } })).id;
  moderator = (await prisma.user.create({ data: { handle: `${PREFIX}-mod`, displayName: "Mod", role: "editor" } })).id;
});

afterAll(async () => {
  await cleanup();
  await syncArticleComments(prisma, article.id);
});

const comment = (body: string) =>
  createComment(prisma, author, { targetType: "article", targetId: article.id, body });

describe("Article.comments", () => {
  it("follows create, author delete and moderation (hide, restore, remove)", async () => {
    const base = await visible();
    expect(await count()).toBe(base);

    const a = await comment("Primeiro comentário t11");
    const b = await comment("Segundo comentário t11");
    expect(a).toMatchObject({ status: "ok", articleSlug: article.slug });
    expect(await count()).toBe(base + 2);
    if (a.status !== "ok" || b.status !== "ok") throw new Error("comment not created");

    expect(await deleteComment(prisma, author, a.comment.id)).toEqual({ status: "ok", articleSlug: article.slug });
    expect(await count()).toBe(base + 1);

    const hidden = await moderateContent({ targetType: "comment", targetId: b.comment.id, action: "hide" }, moderator);
    expect(hidden).toMatchObject({ ok: true, tags: expect.arrayContaining([`article:${article.slug}`, "news"]) });
    expect(await count()).toBe(base);

    await moderateContent({ targetType: "comment", targetId: b.comment.id, action: "restore" }, moderator);
    expect(await count()).toBe(base + 1);

    await moderateContent({ targetType: "comment", targetId: b.comment.id, action: "remove" }, moderator);
    expect(await count()).toBe(base);
  });

  it("the Server Actions invalidate the article and the news cards", async () => {
    getSessionUser.mockResolvedValue({ id: author, handle: `${PREFIX}-autor` });
    updateTag.mockClear();
    const posted = await postComment({ targetType: "article", targetId: article.id, body: "Pela action t11" });
    expect(posted).toMatchObject({ status: "ok" });
    expect(updateTag).toHaveBeenCalledWith(`article:${article.slug}`);
    expect(updateTag).toHaveBeenCalledWith("news");
    if (posted.status !== "ok") throw new Error("comment not created");
    updateTag.mockClear();
    expect(await removeComment({ id: posted.comment.id })).toEqual({ status: "ok" });
    expect(updateTag).toHaveBeenCalledWith(`article:${article.slug}`);
  });

  it("recountAllArticleComments repairs a drifted counter and leaves correct ones alone", async () => {
    await prisma.article.update({ where: { id: article.id }, data: { comments: 999 } });
    expect(await recountAllArticleComments(prisma)).toBeGreaterThanOrEqual(1);
    expect(await count()).toBe(await visible());
    expect(await recountAllArticleComments(prisma)).toBe(0);
  });
});

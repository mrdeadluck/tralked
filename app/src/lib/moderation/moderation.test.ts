import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideReport } from "@/lib/admin/moderation";
import { createComment, listComments } from "@/lib/community/comments";
import { prisma } from "@/lib/db";
import { moderateComment, setDiscussionLock } from "./comments";
import { moderateArticle, removeGuide } from "./content";
import { applySanction, liftSanction, listActiveSanctions } from "./sanctions";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-mod-g3` prefix and are removed.

const PREFIX = "test-mod-g3";
const NOW = new Date("2026-11-04T15:00:00Z");

let player: string;
let other: string;
let moderator: { id: string; role: string };
let editor: { id: string; role: string };
let articleId: string;
let authorRowId: string;
let gameId: string;

async function cleanup() {
  const users = await prisma.user.findMany({ where: { handle: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.moderationLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { targetUserId: { in: ids } }] } });
  await prisma.report.deleteMany({ where: { reporterId: { in: ids } } });
  await prisma.comment.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.discussionLock.deleteMany({ where: { lockedById: { in: ids } } });
  await prisma.article.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.author.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

const logOf = (targetId: string) =>
  prisma.moderationLog.findMany({ where: { targetId }, orderBy: { createdAt: "asc" }, select: { action: true, actorId: true, reason: true, details: true, targetUserId: true } });

beforeAll(async () => {
  await cleanup();
  const make = (name: string, role = "user") =>
    prisma.user.create({ data: { handle: `${PREFIX}-${name}`, displayName: name, role } }).then((u) => ({ id: u.id, role }));
  player = (await make("jogador")).id;
  other = (await make("outro")).id;
  moderator = await make("mod", "moderator");
  editor = await make("editor", "editor");
  authorRowId = (await prisma.author.create({ data: { handle: `${PREFIX}-redacao`, userId: editor.id } })).id;
  articleId = (
    await prisma.article.create({
      data: {
        slug: `${PREFIX}-materia`,
        title: "Matéria de teste",
        body: "Corpo",
        status: "published",
        category: "GAMES",
        imageLabel: "x",
        authorId: authorRowId,
      },
    })
  ).id;
  gameId = (await prisma.game.create({ data: { slug: `${PREFIX}-jogo`, name: "Jogo Teste", platforms: [], achievementCount: 0 } })).id;
});

afterAll(cleanup);

describe("comments in a discussion", () => {
  let first: string;
  let second: string;

  beforeAll(async () => {
    const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
    const mk = (authorId: string, body: string, min: number) =>
      prisma.comment.create({ data: { authorId, targetType: "article", targetId: articleId, body, createdAt: at(min) } }).then((c) => c.id);
    first = await mk(player, "primeiro", 1);
    second = await mk(other, "segundo", 2);
    await mk(player, "terceiro", 3);
  });

  it("a pinned comment comes first, marked, and only one is pinned per discussion", async () => {
    expect(await moderateComment({ id: first, action: "pin" }, moderator.id)).toMatchObject({ ok: true });
    let page = await listComments(prisma, "article", articleId);
    expect(page.comments.map((c) => [c.body, c.pinned])).toEqual([
      ["primeiro", true],
      ["terceiro", false],
      ["segundo", false],
    ]);

    await moderateComment({ id: second, action: "pin", reason: "melhor resposta" }, moderator.id);
    page = await listComments(prisma, "article", articleId);
    expect(page.comments.map((c) => c.body)).toEqual(["segundo", "terceiro", "primeiro"]);
    expect(page.comments.filter((c) => c.pinned)).toHaveLength(1);
    expect(await moderateComment({ id: second, action: "pin" }, moderator.id)).toEqual({ ok: false, error: "Este comentário já está fixado." });

    expect(await logOf(second)).toEqual([
      { action: "comment.pin", actorId: moderator.id, reason: "melhor resposta", details: { on: `article:${articleId}` }, targetUserId: other },
    ]);
  });

  it("a moderator removes any comment: the row stays as a placeholder without text or author", async () => {
    expect(await moderateComment({ id: second, action: "remove", reason: "ofensivo" }, moderator.id)).toMatchObject({ ok: true });
    const row = await prisma.comment.findUniqueOrThrow({ where: { id: second } });
    expect(row).toMatchObject({ status: "removed", pinned: false, body: "segundo" });

    const page = await listComments(prisma, "article", articleId);
    const shown = page.comments.find((c) => c.id === second);
    expect(shown).toEqual(expect.objectContaining({ removed: true, deleted: false, pinned: false, body: "", author: null }));
    expect(page.total).toBe(2);
    // The article's public counter follows the visible comments.
    expect((await prisma.article.findUniqueOrThrow({ where: { id: articleId } })).comments).toBe(2);
    expect((await logOf(second)).at(-1)).toMatchObject({ action: "comment.remove", reason: "ofensivo", targetUserId: other });
    expect(await moderateComment({ id: second, action: "pin" }, moderator.id)).toEqual({
      ok: false,
      error: "Só comentários visíveis podem ser fixados.",
    });
  });

  it("a locked discussion takes no new comments until it is unlocked", async () => {
    expect(await setDiscussionLock({ targetType: "article", targetId: articleId, locked: true, reason: "briga" }, moderator.id)).toEqual({ ok: true });
    expect(await setDiscussionLock({ targetType: "article", targetId: articleId, locked: true }, moderator.id)).toEqual({
      ok: false,
      error: "Esta discussão já está trancada.",
    });
    expect(await createComment(prisma, other, { targetType: "article", targetId: articleId, body: "posso?" })).toEqual({ status: "locked" });

    expect(await setDiscussionLock({ targetType: "article", targetId: articleId, locked: false }, moderator.id)).toEqual({ ok: true });
    expect(await createComment(prisma, other, { targetType: "article", targetId: articleId, body: "agora sim" })).toMatchObject({ status: "ok" });
    expect((await logOf(articleId)).map((l) => l.action)).toEqual(["discussion.lock", "discussion.unlock"]);
  });
});

describe("articles from their page", () => {
  it("re-files, highlights and unpublishes, logging each change with before and after", async () => {
    expect(await moderateArticle({ id: articleId, op: "category", category: "MERCADO" }, editor.id)).toEqual({ ok: true, slug: `${PREFIX}-materia` });
    expect(await moderateArticle({ id: articleId, op: "category", category: "MERCADO" }, editor.id)).toEqual({
      ok: false,
      error: "A notícia já está nessa categoria.",
    });
    expect(await moderateArticle({ id: articleId, op: "featured", featured: 2 }, editor.id)).toMatchObject({ ok: true });
    expect(await moderateArticle({ id: articleId, op: "unpublish", reason: "erro de apuração" }, editor.id)).toMatchObject({ ok: true });
    expect(await prisma.article.findUniqueOrThrow({ where: { id: articleId } })).toMatchObject({
      category: "MERCADO",
      featured: 2,
      status: "draft",
    });
    expect(await moderateArticle({ id: articleId, op: "unpublish" }, editor.id)).toEqual({ ok: false, error: "Esta notícia não está publicada." });
    const log = (await logOf(articleId)).filter((l) => l.action.startsWith("article."));
    expect(log).toEqual([
      expect.objectContaining({ action: "article.category", details: { from: "GAMES", to: "MERCADO" } }),
      expect.objectContaining({ action: "article.featured", details: { from: 0, to: 2 } }),
      expect.objectContaining({ action: "article.unpublish", reason: "erro de apuração", details: { from: "published", to: "draft" } }),
    ]);
  });
});

describe("guides", () => {
  it("taking a guide off the site sends it back to draft, resolves its reports and tells the author", async () => {
    const guide = await prisma.guide.create({
      data: {
        gameId,
        authorId: other,
        status: "published",
        version: "1.0",
        difficulty: 3,
        hoursMin: 10,
        hoursMax: 20,
        playthroughs: "1",
        missables: 0,
        online: 0,
        overview: [],
        warnings: [],
      },
    });
    await prisma.report.create({ data: { reporterId: player, targetType: "guide", targetId: guide.id, reason: "Outro motivo" } });

    expect(await removeGuide({ id: guide.id, reason: "cópia de outro site" }, moderator.id, NOW)).toEqual({ ok: true, gameSlug: `${PREFIX}-jogo` });
    expect((await prisma.guide.findUniqueOrThrow({ where: { id: guide.id } })).status).toBe("draft");
    expect(await prisma.report.findFirstOrThrow({ where: { targetId: guide.id } })).toMatchObject({ status: "resolved", resolvedById: moderator.id });
    const notice = await prisma.notification.findFirstOrThrow({ where: { userId: other, kind: "moderation" } });
    expect(notice).toMatchObject({ title: "Seu guia de Jogo Teste foi tirado do ar pela moderação", body: "Motivo: cópia de outro site" });
    expect(await removeGuide({ id: guide.id }, moderator.id)).toEqual({ ok: false, error: "Este guia não está publicado." });
    expect((await logOf(guide.id)).map((l) => l.action)).toEqual(["guide.remove"]);
  });
});

describe("reports", () => {
  it("closing a report is logged", async () => {
    const report = await prisma.report.create({ data: { reporterId: player, targetType: "user", targetId: other, reason: "Spam ou propaganda" } });
    expect(await decideReport({ reportId: report.id, decision: "dismissed" }, moderator.id, NOW)).toEqual({ ok: true });
    expect(await decideReport({ reportId: report.id, decision: "resolved" }, moderator.id, NOW)).toMatchObject({ ok: false });
    expect((await logOf(report.id)).map((l) => l.action)).toEqual(["report.dismissed"]);
  });
});

describe("mutes and bans", () => {
  it("mutes a player until the end of the chosen day, tells them and logs it", async () => {
    expect(await applySanction(moderator, { handle: `${PREFIX}-JOGADOR`, kind: "mute", until: "2026-11-09", reason: "flood" }, NOW)).toEqual({ ok: true });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: player } });
    expect(user.mutedUntil?.toISOString()).toBe("2026-11-10T02:59:59.999Z");
    expect(user.bannedUntil).toBeNull();
    expect(await prisma.notification.findFirstOrThrow({ where: { userId: player, kind: "moderation" } })).toMatchObject({
      title: "Você foi silenciado até 09/11/2026, 23:59: não pode comentar nem publicar",
      body: "Motivo: flood",
    });
    expect(await logOf(player)).toEqual([
      expect.objectContaining({ action: "user.mute", actorId: moderator.id, reason: "flood", details: { until: "2026-11-10T02:59:59.999Z" } }),
    ]);
    expect((await listActiveSanctions(NOW)).find((s) => s.id === player)).toMatchObject({ mutedUntil: user.mutedUntil, bannedUntil: null });
  });

  it("refuses past dates, unknown users, staff targets and self", async () => {
    expect(await applySanction(moderator, { handle: `${PREFIX}-outro`, kind: "ban", until: "2026-11-03" }, NOW)).toMatchObject({ ok: false, field: "until" });
    expect(await applySanction(moderator, { handle: `${PREFIX}-ninguem`, kind: "ban", until: "2026-12-01" }, NOW)).toMatchObject({ ok: false, field: "handle" });
    expect(await applySanction(moderator, { handle: `${PREFIX}-editor`, kind: "ban", until: "2026-12-01" }, NOW)).toEqual({
      ok: false,
      error: "Você não pode punir este usuário.",
    });
    expect(await applySanction(moderator, { handle: `${PREFIX}-mod`, kind: "mute", until: "2026-12-01" }, NOW)).toEqual({
      ok: false,
      error: "Você não pode punir a si mesmo.",
    });
  });

  it("bans and lifts a ban before its date", async () => {
    expect(await applySanction(editor, { handle: `${PREFIX}-outro`, kind: "ban", until: "2026-12-01" }, NOW)).toEqual({ ok: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other } })).bannedUntil).not.toBeNull();
    expect(await liftSanction(moderator, { userId: other, kind: "ban" }, NOW)).toEqual({ ok: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other } })).bannedUntil).toBeNull();
    expect(await liftSanction(moderator, { userId: other, kind: "ban" }, NOW)).toEqual({ ok: false, error: "Este usuário não está banido." });
    expect((await logOf(other)).map((l) => l.action)).toEqual(expect.arrayContaining(["user.ban", "user.unban"]));
  });
});

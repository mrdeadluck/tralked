import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { recomputeUser } from "@/lib/progression/recompute";
import { localStorage } from "@/lib/storage/local";
import { decideReport, listContent, listReports, moderateContent } from "./moderation";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-admin-m` prefix and are removed.

const PREFIX = "test-admin-m";
const NOW = new Date("2026-10-31T15:00:00Z");

let author: string;
let helper: string;
let moderator: string;
let reporter: string;

async function cleanup() {
  const users = await prisma.user.findMany({ where: { handle: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.moderationLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.report.deleteMany({ where: { OR: [{ reporterId: { in: ids } }, { targetId: { startsWith: PREFIX } }] } });
  await prisma.photo.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.comment.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.forumThread.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function totalXp(userId: string) {
  await recomputeUser(userId, NOW);
  return (await prisma.userStats.findUnique({ where: { userId } }))?.totalXp ?? 0;
}

beforeAll(async () => {
  await cleanup();
  const make = (name: string, role = "user") =>
    prisma.user.create({ data: { handle: `${PREFIX}-${name}`, displayName: name, role } }).then((u) => u.id);
  author = await make("autor");
  helper = await make("ajudante");
  moderator = await make("mod", "editor");
  reporter = await make("denunciante");
});

afterAll(cleanup);

describe("photos", () => {
  let photoId: string;

  beforeAll(async () => {
    const photo = await prisma.photo.create({ data: { authorId: author, width: 800, height: 600, caption: "Minha foto" } });
    photoId = photo.id;
    await prisma.xpLedgerEntry.create({
      data: { userId: author, source: "photo_approved", sourceKey: photoId, xp: 50, skills: [], createdAt: NOW },
    });
    await prisma.report.create({ data: { reporterId: reporter, targetType: "photo", targetId: photoId, reason: "Spam ou propaganda" } });
  });

  it("hiding keeps the XP, resolves the open reports and invalidates the photo and gallery", async () => {
    const before = await totalXp(author);
    const result = await moderateContent({ targetType: "photo", targetId: photoId, action: "hide" }, moderator, NOW);
    expect(result).toEqual({ ok: true, tags: [`photo:${photoId}`, "gallery"], recompute: [], voided: 0 });
    expect((await prisma.photo.findUniqueOrThrow({ where: { id: photoId } })).status).toBe("hidden");
    expect(await totalXp(author)).toBe(before);
    const report = await prisma.report.findFirstOrThrow({ where: { targetId: photoId } });
    expect(report).toMatchObject({ status: "resolved", resolvedById: moderator, resolvedAt: NOW });
  });

  it("a hidden photo can be restored", async () => {
    expect((await moderateContent({ targetType: "photo", targetId: photoId, action: "restore" }, moderator, NOW)).ok).toBe(true);
    expect((await prisma.photo.findUniqueOrThrow({ where: { id: photoId } })).status).toBe("visible");
  });

  it("removing voids the photo XP (kept in the ledger) and is final", async () => {
    const before = await totalXp(author);
    const result = await moderateContent({ targetType: "photo", targetId: photoId, action: "remove" }, moderator, NOW);
    expect(result).toMatchObject({ ok: true, voided: 1, recompute: [author] });
    const entry = await prisma.xpLedgerEntry.findFirstOrThrow({ where: { userId: author, sourceKey: photoId } });
    expect(entry.voidedAt).toEqual(NOW);
    expect(await totalXp(author)).toBe(before - 50);

    for (const action of ["restore", "hide", "remove"] as const) {
      expect(await moderateContent({ targetType: "photo", targetId: photoId, action }, moderator, NOW)).toMatchObject({ ok: false });
    }
  });

  it("removing deletes the stored image file; hiding keeps it (local adapter)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tralked-moderation-"));
    try {
      const storage = localStorage(root);
      const { url } = await storage.put("2026/10/moderada.webp", Buffer.from("webp"), "image/webp");
      const file = path.join(root, "public", "uploads", "2026", "10", "moderada.webp");
      const photo = await prisma.photo.create({ data: { authorId: author, width: 800, height: 600, url } });

      await moderateContent({ targetType: "photo", targetId: photo.id, action: "hide" }, moderator, NOW, storage);
      expect((await readFile(file)).toString()).toBe("webp");

      expect((await moderateContent({ targetType: "photo", targetId: photo.id, action: "remove" }, moderator, NOW, storage)).ok).toBe(true);
      await expect(readFile(file)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("forum", () => {
  let threadId: string;
  let answerId: string;

  beforeAll(async () => {
    const category = await prisma.forumCategory.findFirstOrThrow();
    const thread = await prisma.forumThread.create({
      data: {
        categoryId: category.id,
        authorId: author,
        title: "Como pego a conquista?",
        slug: "como-pego",
        posts: { create: { authorId: author, body: "Alguém sabe?" } },
      },
    });
    threadId = thread.id;
    const answer = await prisma.forumPost.create({ data: { threadId, authorId: helper, body: "Faça assim." } });
    answerId = answer.id;
    await prisma.forumThread.update({ where: { id: threadId }, data: { solvedPostId: answerId } });
    await prisma.xpLedgerEntry.create({
      data: { userId: helper, source: "forum_solved", sourceKey: answerId, xp: 40, skills: ["sabio"], skillPoints: { sabio: 40 } },
    });
  });

  it("locking and unlocking only apply to threads", async () => {
    expect((await moderateContent({ targetType: "thread", targetId: threadId, action: "lock" }, moderator, NOW)).ok).toBe(true);
    expect((await prisma.forumThread.findUniqueOrThrow({ where: { id: threadId } })).status).toBe("locked");
    expect((await moderateContent({ targetType: "thread", targetId: threadId, action: "unlock" }, moderator, NOW)).ok).toBe(true);
    expect(await moderateContent({ targetType: "post", targetId: answerId, action: "lock" }, moderator, NOW)).toMatchObject({ ok: false });
  });

  it("removing the answer that solved a thread voids its Sábio XP and frees the mark", async () => {
    const before = await totalXp(helper);
    const result = await moderateContent({ targetType: "post", targetId: answerId, action: "remove" }, moderator, NOW);
    expect(result).toEqual({ ok: true, tags: [`thread:${threadId}`, "forum"], recompute: [helper], voided: 1 });
    expect(await totalXp(helper)).toBe(before - 40);
    expect((await prisma.forumThread.findUniqueOrThrow({ where: { id: threadId } })).solvedPostId).toBeNull();
    expect((await prisma.forumPost.findUniqueOrThrow({ where: { id: answerId } })).status).toBe("removed");
  });

  it("removing a thread voids its author's thread XP and the solved answer's XP", async () => {
    const category = await prisma.forumCategory.findFirstOrThrow();
    const other = await prisma.forumThread.create({
      data: { categoryId: category.id, authorId: author, title: "Outro tópico", slug: "outro-topico", posts: { create: { authorId: author, body: "Oi" } } },
    });
    const answer = await prisma.forumPost.create({ data: { threadId: other.id, authorId: helper, body: "Resposta." } });
    await prisma.forumThread.update({ where: { id: other.id }, data: { solvedPostId: answer.id } });
    await prisma.xpLedgerEntry.createMany({
      data: [
        { userId: author, source: "forum_thread", sourceKey: other.id, xp: 10, skills: [], createdAt: NOW },
        { userId: helper, source: "forum_solved", sourceKey: answer.id, xp: 40, skills: ["sabio"], skillPoints: { sabio: 40 }, createdAt: NOW },
      ],
    });
    const result = await moderateContent({ targetType: "thread", targetId: other.id, action: "remove" }, moderator, NOW);
    expect(result).toMatchObject({ ok: true, voided: 2 });
    expect(new Set((result as { recompute: string[] }).recompute)).toEqual(new Set([author, helper]));
    const voided = await prisma.xpLedgerEntry.findMany({ where: { sourceKey: { in: [other.id, answer.id] } }, select: { voidedAt: true } });
    expect(voided.every((e) => e.voidedAt?.getTime() === NOW.getTime())).toBe(true);
  });

  it("lists content by status with its open reports", async () => {
    await prisma.report.create({ data: { reporterId: reporter, targetType: "thread", targetId: threadId, reason: "Outro motivo" } });
    const { rows } = await listContent("thread", "all", 1);
    expect(rows.find((r) => r.id === threadId)).toMatchObject({ status: "open", reports: 1, author: `${PREFIX}-autor` });
    const removed = await listContent("post", "removed", 1);
    expect(removed.rows.map((r) => r.id)).toContain(answerId);
  });
});

describe("comments and reports", () => {
  it("a comment its author deleted cannot be moderated", async () => {
    const comment = await prisma.comment.create({
      data: { authorId: author, targetType: "photo", targetId: `${PREFIX}-alvo`, body: "", status: "deleted" },
    });
    expect(await moderateContent({ targetType: "comment", targetId: comment.id, action: "hide" }, moderator, NOW)).toEqual({
      ok: false,
      error: "O autor já apagou este comentário.",
    });
  });

  it("content that no longer exists is reported as such", async () => {
    expect(await moderateContent({ targetType: "comment", targetId: `${PREFIX}-sumiu`, action: "hide" }, moderator, NOW)).toEqual({
      ok: false,
      error: "Esse conteúdo não existe mais.",
    });
  });

  it("the report queue tolerates targets that were deleted, and a report closes once", async () => {
    const report = await prisma.report.create({
      data: { reporterId: reporter, targetType: "comment", targetId: `${PREFIX}-apagado`, reason: "Ofensivo ou assédio" },
    });
    const { reports } = await listReports("open", 1);
    expect(reports.find((r) => r.id === report.id)).toMatchObject({ target: null, reporter: `${PREFIX}-denunciante` });

    expect(await decideReport({ reportId: report.id, decision: "dismissed" }, moderator, NOW)).toEqual({ ok: true });
    expect(await prisma.report.findUniqueOrThrow({ where: { id: report.id } })).toMatchObject({ status: "dismissed", resolvedById: moderator });
    expect(await decideReport({ reportId: report.id, decision: "resolved" }, moderator, NOW)).toMatchObject({ ok: false });
  });
});

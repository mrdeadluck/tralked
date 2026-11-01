import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { DELETED_STATUS, syncArticleComments } from "@/lib/community/comments";
import { articleTag, NEWS_TAG } from "@/lib/queries/news";
import { FORUM_TAG, GALLERY_TAG, photoTag, threadTag } from "@/lib/community/cached";
import { REPORT_TARGETS } from "@/lib/community/reports";
import { prisma } from "@/lib/db";
import { getStorage, type Storage } from "@/lib/storage";
import type { SocialItemKind } from "@/lib/engine/social";
import { voidItemSocialXp } from "@/lib/social/xp";

/**
 * Moderation of community content (comments, forum posts and threads, gallery photos) and the
 * report queue.
 *
 * - "Ocultar" (hide) is reversible ("Restaurar") and keeps any XP the content earned.
 * - "Remover" (remove) is final: the content never comes back, and the XP it earned is voided in
 *   the ledger (gallery photo XP, the "Resolveu" XP of a forum answer, and the likes/helpful XP of
 *   comments and posts — including those of a removed photo's comments and a removed thread's
 *   posts), then the authors are recomputed. Voided entries are kept, so the decision stays auditable. A removed photo's image
 *   file is deleted from storage too (hiding keeps it: a hidden photo can come back).
 * - Hiding or removing resolves the target's open reports.
 * - Targets that no longer exist are reported as such (reports may outlive their target).
 */

type Tx = Prisma.TransactionClient;

export const MODERATION_TARGETS = ["comment", "post", "photo", "thread"] as const;
export type ModerationTarget = (typeof MODERATION_TARGETS)[number];
export const MODERATION_ACTIONS = ["hide", "remove", "restore", "lock", "unlock"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const moderationSchema = z.strictObject({
  targetType: z.enum(MODERATION_TARGETS),
  targetId: z.string().min(1).max(64),
  action: z.enum(MODERATION_ACTIONS),
});

export type ModerationInput = z.output<typeof moderationSchema>;

export type ModerationResult =
  | {
      ok: true;
      /** Cache tags of the public pages that showed the content. */
      tags: string[];
      /** Authors whose ledger changed: recompute them. */
      recompute: string[];
      voided: number;
    }
  | { ok: false; error: string };

const NOT_FOUND = { ok: false, error: "Esse conteúdo não existe mais." } as const;
const FINAL = { ok: false, error: "Conteúdo removido não pode ser alterado." } as const;

/** Visible status of each kind (threads are "open"). */
const VISIBLE: Record<ModerationTarget, string> = { comment: "visible", post: "visible", photo: "visible", thread: "open" };

/** Voids non-voided ledger entries; returns how many. */
async function voidEntries(tx: Tx, userId: string | null, source: string, sourceKey: string, now: Date) {
  if (!userId) return 0;
  const { count } = await tx.xpLedgerEntry.updateMany({
    where: { userId, source, sourceKey, voidedAt: null },
    data: { voidedAt: now },
  });
  return count;
}

/** Next status for an action, or an error message. */
function nextStatus(type: ModerationTarget, current: string, action: ModerationAction): string | { error: string } {
  if (current === "removed") return { error: FINAL.error };
  if (current === DELETED_STATUS) return { error: "O autor já apagou este comentário." };
  const hidden = current === "hidden";
  switch (action) {
    case "hide":
      return hidden ? { error: "Já está oculto." } : "hidden";
    case "restore":
      return hidden ? VISIBLE[type] : { error: "Só conteúdo oculto pode ser restaurado." };
    case "remove":
      return "removed";
    case "lock":
      if (type !== "thread") return { error: "Só tópicos podem ser trancados." };
      return current === "open" ? "locked" : { error: "Só tópicos abertos podem ser trancados." };
    case "unlock":
      if (type !== "thread") return { error: "Só tópicos podem ser destrancados." };
      return current === "locked" ? "open" : { error: "O tópico não está trancado." };
  }
}

/** Marks the target's open reports as resolved by the moderator. */
async function resolveReportsOf(tx: Tx, targetType: string, targetId: string, moderatorId: string, now: Date) {
  await tx.report.updateMany({
    where: { targetType, targetId, status: "open" },
    data: { status: "resolved", resolvedAt: now, resolvedById: moderatorId },
  });
}

/**
 * Applies a moderation action. A removed photo's file is deleted from `storage` (default: the
 * configured adapter) after the transaction commits; that deletion is best-effort (logged).
 */
export async function moderateContent(
  input: ModerationInput,
  moderatorId: string,
  now: Date = new Date(),
  storage?: Storage,
): Promise<ModerationResult> {
  const { targetType, targetId, action } = input;
  /** Stored image of the photo this action removes. */
  let removedFile = null as string | null;
  const result = await prisma.$transaction(async (tx): Promise<ModerationResult> => {
    let photoUrl: string | null = null;
    const tags: string[] = [];
    let current: string;
    /** XP to void when the content is removed: [author, ledger source, sourceKey]. */
    let earned: [string | null, string, string] | null = null;
    /** Thread whose "Resolveu" mark goes away with the removed answer. */
    let unsolveThreadId: string | null = null;
    /** Article whose comment count follows this comment's status. */
    let articleCommentOf: string | null = null;
    /** Comments and posts whose likes/helpful XP go when the content is removed (F9). */
    let socialItems: { kind: SocialItemKind; id: string; authorId: string | null }[] = [];

    switch (targetType) {
      case "comment": {
        const comment = await tx.comment.findUnique({
          where: { id: targetId },
          select: { status: true, targetType: true, targetId: true, authorId: true },
        });
        if (!comment) return NOT_FOUND;
        current = comment.status;
        socialItems = [{ kind: "comment", id: targetId, authorId: comment.authorId }];
        if (comment.targetType === "photo") tags.push(photoTag(comment.targetId), GALLERY_TAG);
        if (comment.targetType === "thread") tags.push(threadTag(comment.targetId));
        if (comment.targetType === "article") articleCommentOf = comment.targetId;
        break;
      }
      case "photo": {
        const photo = await tx.photo.findUnique({ where: { id: targetId }, select: { status: true, authorId: true, url: true } });
        if (!photo) return NOT_FOUND;
        current = photo.status;
        photoUrl = photo.url;
        tags.push(photoTag(targetId), GALLERY_TAG);
        earned = [photo.authorId, "photo_approved", targetId];
        // Its comments leave with it.
        socialItems = (
          await tx.comment.findMany({ where: { targetType: "photo", targetId }, select: { id: true, authorId: true } })
        ).map((c) => ({ kind: "comment" as const, ...c }));
        break;
      }
      case "post": {
        const post = await tx.forumPost.findUnique({
          where: { id: targetId },
          select: { status: true, authorId: true, threadId: true, solves: { select: { id: true } } },
        });
        if (!post) return NOT_FOUND;
        current = post.status;
        tags.push(threadTag(post.threadId), FORUM_TAG);
        socialItems = [{ kind: "post", id: targetId, authorId: post.authorId }];
        if (post.solves) {
          // The answer no longer stands: its "Resolveu" XP goes and the thread author may mark another.
          earned = [post.authorId, "forum_solved", targetId];
          unsolveThreadId = post.threadId;
        }
        break;
      }
      case "thread": {
        const thread = await tx.forumThread.findUnique({
          where: { id: targetId },
          select: { status: true, solvedPost: { select: { id: true, authorId: true } } },
        });
        if (!thread) return NOT_FOUND;
        current = thread.status;
        tags.push(threadTag(targetId), FORUM_TAG);
        if (thread.solvedPost) earned = [thread.solvedPost.authorId, "forum_solved", thread.solvedPost.id];
        socialItems = (
          await tx.forumPost.findMany({ where: { threadId: targetId }, select: { id: true, authorId: true } })
        ).map((p) => ({ kind: "post" as const, ...p }));
        break;
      }
    }

    const next = nextStatus(targetType, current, action);
    if (typeof next !== "string") return { ok: false, error: next.error };
    const data = { status: next };
    switch (targetType) {
      case "comment":
        await tx.comment.update({ where: { id: targetId }, data });
        break;
      case "photo":
        await tx.photo.update({ where: { id: targetId }, data });
        break;
      case "post":
        await tx.forumPost.update({ where: { id: targetId }, data });
        break;
      case "thread":
        await tx.forumThread.update({ where: { id: targetId }, data });
        break;
    }

    // Hiding, removing or restoring an article comment changes the article's visible count.
    if (articleCommentOf) {
      const slug = await syncArticleComments(tx, articleCommentOf);
      if (slug) tags.push(articleTag(slug), NEWS_TAG);
    }

    const recompute: string[] = [];
    let voided = 0;
    if (next === "removed") {
      if (earned) {
        const [authorId, source, sourceKey] = earned;
        voided = await voidEntries(tx, authorId, source, sourceKey, now);
        if (voided > 0 && authorId) recompute.push(authorId);
      }
      for (const item of socialItems) {
        const count = await voidItemSocialXp(tx, item.kind, item.id, item.authorId, now);
        voided += count;
        if (count > 0 && item.authorId && !recompute.includes(item.authorId)) recompute.push(item.authorId);
      }
      if (unsolveThreadId) {
        await tx.forumThread.update({ where: { id: unsolveThreadId }, data: { solvedPostId: null } });
      }
      removedFile = photoUrl;
    }
    if (action === "hide" || action === "remove") await resolveReportsOf(tx, targetType, targetId, moderatorId, now);
    return { ok: true, tags, recompute, voided };
  });

  // "Remover é definitivo" covers the bytes too: the image stops being served at its URL.
  if (result.ok && removedFile) {
    try {
      await (storage ?? getStorage()).remove(removedFile);
    } catch (error) {
      console.error("Moderation: could not delete the removed photo's file", {
        photoId: targetId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

// ---------- Reports ----------

export const REPORT_STATUSES = ["open", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const reportDecisionSchema = z.strictObject({
  reportId: z.string().min(1).max(64),
  decision: z.enum(["resolved", "dismissed"]),
});

/** Closes an open report (resolved: handled; dismissed: nothing wrong). */
export async function decideReport(
  input: z.output<typeof reportDecisionSchema>,
  moderatorId: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { count } = await prisma.report.updateMany({
    where: { id: input.reportId, status: "open" },
    data: { status: input.decision, resolvedAt: now, resolvedById: moderatorId },
  });
  return count === 1 ? { ok: true } : { ok: false, error: "Esta denúncia já foi encerrada ou não existe." };
}

/** What the moderator sees of a reported target; null when it no longer exists. */
export type TargetSummary = {
  /** Plain text (never HTML): comment/post body, photo caption, title or handle. */
  text: string;
  author: string | null;
  status: string | null;
  /** Public page of the target. */
  href: string | null;
  /** Admin page to edit it (articles, guides). */
  editHref?: string;
  /** Moderation actions apply (comment, post, photo, thread). */
  moderatable: ModerationTarget | null;
};

const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));

async function targetSummaries(refs: { targetType: string; targetId: string }[]) {
  const ids = (type: string) => [...new Set(refs.filter((r) => r.targetType === type).map((r) => r.targetId))];
  const author = { select: { handle: true } } as const;
  const [comments, posts, photos, threads, articles, guides, users, messages] = await Promise.all([
    prisma.comment.findMany({ where: { id: { in: ids("comment") } }, select: { id: true, body: true, status: true, targetType: true, targetId: true, author } }),
    prisma.forumPost.findMany({ where: { id: { in: ids("post") } }, select: { id: true, body: true, status: true, threadId: true, author } }),
    prisma.photo.findMany({ where: { id: { in: ids("photo") } }, select: { id: true, caption: true, status: true, author } }),
    prisma.forumThread.findMany({ where: { id: { in: ids("thread") } }, select: { id: true, title: true, status: true, author } }),
    prisma.article.findMany({ where: { id: { in: ids("article") } }, select: { id: true, title: true, slug: true, status: true } }),
    prisma.guide.findMany({ where: { id: { in: ids("guide") } }, select: { id: true, status: true, game: { select: { name: true, slug: true } } } }),
    prisma.user.findMany({ where: { id: { in: ids("user") } }, select: { id: true, handle: true, displayName: true } }),
    // Reported private messages: the moderators see only the reported message (never the rest of
    // the conversation), to decide on its sender.
    prisma.directMessage.findMany({
      where: { id: { in: ids("message") } },
      select: { id: true, body: true, sender: { select: { handle: true } } },
    }),
  ]);
  const maps = {
    comment: byId(comments),
    post: byId(posts),
    photo: byId(photos),
    thread: byId(threads),
    article: byId(articles),
    guide: byId(guides),
    user: byId(users),
    message: byId(messages),
  };
  return (type: string, id: string): TargetSummary | null => {
    switch (type) {
      case "comment": {
        const c = maps.comment.get(id);
        if (!c) return null;
        const href =
          c.targetType === "photo" ? `/galeria/${c.targetId}` : c.targetType === "thread" ? `/forum/t/${c.targetId}` : null;
        return { text: c.body || "(apagado pelo autor)", author: c.author?.handle ?? null, status: c.status, href, moderatable: "comment" };
      }
      case "post": {
        const p = maps.post.get(id);
        return p
          ? { text: p.body, author: p.author?.handle ?? null, status: p.status, href: `/forum/t/${p.threadId}#post-${p.id}`, moderatable: "post" }
          : null;
      }
      case "photo": {
        const p = maps.photo.get(id);
        return p
          ? { text: p.caption ?? "(foto sem legenda)", author: p.author?.handle ?? null, status: p.status, href: `/galeria/${p.id}`, moderatable: "photo" }
          : null;
      }
      case "thread": {
        const t = maps.thread.get(id);
        return t
          ? { text: t.title, author: t.author?.handle ?? null, status: t.status, href: `/forum/t/${t.id}`, moderatable: "thread" }
          : null;
      }
      case "article": {
        const a = maps.article.get(id);
        return a
          ? { text: a.title, author: null, status: a.status, href: `/noticias/${a.slug}`, editHref: `/admin/noticias/${a.id}`, moderatable: null }
          : null;
      }
      case "guide": {
        const g = maps.guide.get(id);
        return g
          ? { text: `Guia de ${g.game.name}`, author: null, status: g.status, href: `/jogos/${g.game.slug}/guia`, editHref: `/admin/guias/${g.id}`, moderatable: null }
          : null;
      }
      case "user": {
        const u = maps.user.get(id);
        return u ? { text: `${u.displayName} (@${u.handle})`, author: u.handle, status: null, href: `/jogador/${u.handle}`, moderatable: null } : null;
      }
      case "message": {
        const m = maps.message.get(id);
        return m
          ? {
              text: `Mensagem privada: ${m.body}`,
              author: m.sender?.handle ?? null,
              status: null,
              href: m.sender ? `/jogador/${m.sender.handle}` : null,
              moderatable: null,
            }
          : null;
      }
      default:
        return null;
    }
  };
}

export const REPORTS_PER_PAGE = 30;

export type ReportRow = {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  reporter: string | null;
  resolvedBy: string | null;
  target: TargetSummary | null;
};

export async function listReports(status: ReportStatus, requestedPage = 1) {
  const where = { status };
  const total = await prisma.report.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / REPORTS_PER_PAGE));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const rows = await prisma.report.findMany({
    where,
    orderBy: [{ createdAt: status === "open" ? "asc" : "desc" }, { id: "asc" }],
    skip: (page - 1) * REPORTS_PER_PAGE,
    take: REPORTS_PER_PAGE,
    select: {
      id: true,
      targetType: true,
      targetId: true,
      reason: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      reporter: { select: { handle: true } },
      resolvedBy: { select: { handle: true } },
    },
  });
  const summary = await targetSummaries(rows);
  const reports: ReportRow[] = rows.map((r) => ({
    id: r.id,
    targetType: r.targetType,
    targetId: r.targetId,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    reporter: r.reporter?.handle ?? null,
    resolvedBy: r.resolvedBy?.handle ?? null,
    target: (REPORT_TARGETS as readonly string[]).includes(r.targetType) ? summary(r.targetType, r.targetId) : null,
  }));
  return { reports, total, page, pageCount };
}

// ---------- Content lists ----------

export const CONTENT_PER_PAGE = 30;

export type ContentRow = {
  id: string;
  type: ModerationTarget;
  text: string;
  author: string | null;
  status: string;
  createdAt: Date;
  href: string | null;
  /** Open reports on it. */
  reports: number;
};

/** Status filter of a content list: "all" (everything except removed and author-deleted) or one status. */
export const CONTENT_FILTERS = ["all", "visible", "hidden", "removed"] as const;
export type ContentFilter = (typeof CONTENT_FILTERS)[number];

function statusWhere(type: ModerationTarget, filter: ContentFilter) {
  const visible = VISIBLE[type];
  if (filter === "all") return type === "thread" ? { in: ["open", "locked", "hidden"] } : { in: ["visible", "hidden"] };
  if (filter === "visible") return type === "thread" ? { in: [visible, "locked"] } : visible;
  return filter;
}

async function openReportCounts(type: string, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.report.groupBy({
    by: ["targetId"],
    where: { targetType: type, targetId: { in: ids }, status: "open" },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.targetId, r._count._all]));
}

export async function listContent(type: ModerationTarget, filter: ContentFilter, requestedPage = 1) {
  const status = statusWhere(type, filter);
  const author = { select: { handle: true } } as const;
  const window = (total: number) => {
    const pageCount = Math.max(1, Math.ceil(total / CONTENT_PER_PAGE));
    const page = Math.min(Math.max(1, requestedPage), pageCount);
    return { page, pageCount, skip: (page - 1) * CONTENT_PER_PAGE, take: CONTENT_PER_PAGE };
  };
  const order = [{ createdAt: "desc" as const }, { id: "desc" as const }];
  let rows: Omit<ContentRow, "reports">[];
  let total: number;
  let page: number;
  let pageCount: number;

  switch (type) {
    case "comment": {
      total = await prisma.comment.count({ where: { status } });
      const w = window(total);
      ({ page, pageCount } = w);
      const found = await prisma.comment.findMany({
        where: { status },
        orderBy: order,
        skip: w.skip,
        take: w.take,
        select: { id: true, body: true, status: true, createdAt: true, targetType: true, targetId: true, author },
      });
      rows = found.map((c) => ({
        id: c.id,
        type,
        text: c.body,
        author: c.author?.handle ?? null,
        status: c.status,
        createdAt: c.createdAt,
        href: c.targetType === "photo" ? `/galeria/${c.targetId}` : c.targetType === "thread" ? `/forum/t/${c.targetId}` : null,
      }));
      break;
    }
    case "post": {
      total = await prisma.forumPost.count({ where: { status } });
      const w = window(total);
      ({ page, pageCount } = w);
      const found = await prisma.forumPost.findMany({
        where: { status },
        orderBy: order,
        skip: w.skip,
        take: w.take,
        select: { id: true, body: true, status: true, createdAt: true, threadId: true, author },
      });
      rows = found.map((p) => ({
        id: p.id,
        type,
        text: p.body,
        author: p.author?.handle ?? null,
        status: p.status,
        createdAt: p.createdAt,
        href: `/forum/t/${p.threadId}#post-${p.id}`,
      }));
      break;
    }
    case "photo": {
      total = await prisma.photo.count({ where: { status } });
      const w = window(total);
      ({ page, pageCount } = w);
      const found = await prisma.photo.findMany({
        where: { status },
        orderBy: order,
        skip: w.skip,
        take: w.take,
        select: { id: true, caption: true, status: true, createdAt: true, author },
      });
      rows = found.map((p) => ({
        id: p.id,
        type,
        text: p.caption ?? "(foto sem legenda)",
        author: p.author?.handle ?? null,
        status: p.status,
        createdAt: p.createdAt,
        href: `/galeria/${p.id}`,
      }));
      break;
    }
    case "thread": {
      total = await prisma.forumThread.count({ where: { status } });
      const w = window(total);
      ({ page, pageCount } = w);
      const found = await prisma.forumThread.findMany({
        where: { status },
        orderBy: order,
        skip: w.skip,
        take: w.take,
        select: { id: true, title: true, status: true, createdAt: true, author },
      });
      rows = found.map((t) => ({
        id: t.id,
        type,
        text: t.title,
        author: t.author?.handle ?? null,
        status: t.status,
        createdAt: t.createdAt,
        href: `/forum/t/${t.id}`,
      }));
      break;
    }
  }
  const counts = await openReportCounts(type, rows.map((r) => r.id));
  return { rows: rows.map((r) => ({ ...r, reports: counts.get(r.id) ?? 0 })), total, page, pageCount };
}

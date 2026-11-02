import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient;

/** One line of the moderation history (ModerationLog). */
export type LogEntry = {
  actorId: string;
  /** "<target>.<verb>": comment.remove, discussion.lock, user.ban, article.featured… */
  action: string;
  targetType: string;
  targetId: string;
  /** Owner of the target (author or sanctioned user). */
  targetUserId?: string | null;
  reason?: string | null;
  details?: Prisma.InputJsonValue;
};

/** Records a moderation step. Call it inside the transaction that made the change. */
export async function logModeration(db: Db, entry: LogEntry): Promise<void> {
  await db.moderationLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetUserId: entry.targetUserId ?? null,
      reason: entry.reason?.trim() || null,
      ...(entry.details !== undefined ? { details: entry.details } : {}),
    },
  });
}

/** pt-BR label of each logged action (the history table). Unknown actions show as stored. */
export const ACTION_LABEL: Record<string, string> = {
  "comment.hide": "Ocultou comentário",
  "comment.restore": "Restaurou comentário",
  "comment.remove": "Removeu comentário",
  "comment.pin": "Fixou comentário",
  "comment.unpin": "Desafixou comentário",
  "post.hide": "Ocultou resposta do fórum",
  "post.restore": "Restaurou resposta do fórum",
  "post.remove": "Removeu resposta do fórum",
  "thread.hide": "Ocultou tópico",
  "thread.restore": "Restaurou tópico",
  "thread.remove": "Removeu tópico",
  "thread.lock": "Trancou tópico",
  "thread.unlock": "Destrancou tópico",
  "photo.hide": "Ocultou foto",
  "photo.restore": "Restaurou foto",
  "photo.remove": "Removeu foto",
  "guide.remove": "Tirou guia do ar",
  "discussion.lock": "Trancou discussão",
  "discussion.unlock": "Destrancou discussão",
  "article.unpublish": "Despublicou notícia",
  "article.category": "Mudou a categoria da notícia",
  "article.featured": "Mudou o destaque da notícia",
  "user.mute": "Silenciou usuário",
  "user.ban": "Baniu usuário",
  "user.unmute": "Tirou o silêncio",
  "user.unban": "Tirou o banimento",
  "report.resolved": "Resolveu denúncia",
  "report.dismissed": "Descartou denúncia",
};

export const LOG_PER_PAGE = 40;

export type LogRow = {
  id: string;
  action: string;
  label: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  details: unknown;
  createdAt: Date;
  actor: string | null;
  targetUser: string | null;
};

/** The history, newest first, optionally only the steps about one user (as target owner). */
export async function listModerationLog(requestedPage = 1, targetUserId?: string | null) {
  const where = targetUserId ? { targetUserId } : {};
  const total = await prisma.moderationLog.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / LOG_PER_PAGE));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const rows = await prisma.moderationLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * LOG_PER_PAGE,
    take: LOG_PER_PAGE,
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      reason: true,
      details: true,
      createdAt: true,
      actor: { select: { handle: true } },
      targetUser: { select: { handle: true } },
    },
  });
  const entries: LogRow[] = rows.map((r) => ({
    id: r.id,
    action: r.action,
    label: ACTION_LABEL[r.action] ?? r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    reason: r.reason,
    details: r.details,
    createdAt: r.createdAt,
    actor: r.actor?.handle ?? null,
    targetUser: r.targetUser?.handle ?? null,
  }));
  return { entries, total, page, pageCount };
}

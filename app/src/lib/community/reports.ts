import { z } from "zod";
import type { Db } from "./limits";
import { containsHtml, normalizeText } from "./text";

export const REPORT_TARGETS = ["comment", "post", "photo", "thread", "article", "guide", "user", "message"] as const;
export type ReportTargetType = (typeof REPORT_TARGETS)[number];

/** Preset reasons shown in the report form (pt-BR, stored as written). */
export const REPORT_REASONS = [
  "Spam ou propaganda",
  "Ofensivo ou assédio",
  "Spoiler sem aviso",
  "Conteúdo impróprio",
  "Outro motivo",
] as const;

export const REPORT_DETAILS_MAX = 500;

export const reportSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: z.string().min(1).max(64),
  reason: z.enum(REPORT_REASONS, { error: "Escolha um motivo." }),
  details: z
    .string()
    .transform(normalizeText)
    .pipe(z.string().max(REPORT_DETAILS_MAX, `Os detalhes podem ter no máximo ${REPORT_DETAILS_MAX} caracteres.`))
    .refine((value) => !containsHtml(value), "HTML não é permitido. Escreva só o texto.")
    .optional(),
});

export type ReportInput = z.output<typeof reportSchema>;

export type ReportResult = { status: "ok" } | { status: "already_reported" } | { status: "not_found" };

async function targetExists(db: Db, type: ReportTargetType, id: string, reporterId: string): Promise<boolean> {
  const where = { where: { id }, select: { id: true } } as const;
  switch (type) {
    case "message": {
      // A private message can only be reported by its recipient (it is private to the two).
      const message = await db.directMessage.findUnique({
        where: { id },
        select: { senderId: true, conversation: { select: { userLowId: true, userHighId: true } } },
      });
      if (!message || message.senderId === reporterId) return false;
      return message.conversation.userLowId === reporterId || message.conversation.userHighId === reporterId;
    }
    case "comment":
      return (await db.comment.findUnique(where)) !== null;
    case "post":
      return (await db.forumPost.findUnique(where)) !== null;
    case "photo":
      return (await db.photo.findUnique(where)) !== null;
    case "thread":
      return (await db.forumThread.findUnique(where)) !== null;
    case "article":
      return (await db.article.findUnique(where)) !== null;
    case "guide":
      return (await db.guide.findUnique(where)) !== null;
    case "user":
      return (await db.user.findUnique(where)) !== null;
  }
}

/**
 * Files a report for the moderation queue (Report, status `open`). A user has at most one open
 * report per target: repeating it changes nothing.
 */
export async function createReport(db: Db, reporterId: string, input: ReportInput): Promise<ReportResult> {
  if (!(await targetExists(db, input.targetType, input.targetId, reporterId))) return { status: "not_found" };

  const open = await db.report.findFirst({
    where: { reporterId, targetType: input.targetType, targetId: input.targetId, status: "open" },
    select: { id: true },
  });
  if (open) return { status: "already_reported" };

  const reason = input.details ? `${input.reason}: ${input.details}` : input.reason;
  await db.report.create({
    data: { reporterId, targetType: input.targetType, targetId: input.targetId, reason },
  });
  return { status: "ok" };
}

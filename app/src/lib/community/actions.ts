"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { FORUM_TAG, photoTag, threadTag } from "./cached";
import {
  commentTargetSchema,
  createComment,
  deleteComment,
  editComment,
  editCommentSchema,
  listComments,
  newCommentSchema,
  type CommentPage,
  type CommentView,
} from "./comments";
import {
  createPost,
  createThread,
  markSolved,
  markSolvedSchema,
  newPostSchema,
  newThreadSchema,
  type PostView,
} from "./forum";
import { toggleLike } from "./gallery";
import { RATE_LIMIT_MESSAGES, takeLikeToggle } from "./limits";
import { createReport, reportSchema } from "./reports";
import { recomputeQuietly } from "./xp";
import { articleTag, NEWS_TAG } from "@/lib/queries/news";
import { socialViewerState, type SocialViewerState } from "@/lib/social/viewer-state";

/** Common failure shapes; `message` is pt-BR and ready to show. */
export type Failure =
  | { status: "unauthenticated"; message: string }
  | { status: "invalid"; message: string; field?: string }
  | { status: "not_found"; message: string }
  | { status: "forbidden"; message: string }
  | { status: "rate_limited"; message: string };

const UNAUTHENTICATED: Failure = { status: "unauthenticated", message: "Entre na sua conta para continuar." };
const NOT_FOUND: Failure = { status: "not_found", message: "Isso não existe mais ou foi removido." };
const FORBIDDEN: Failure = { status: "forbidden", message: "Você não pode fazer isso." };
const BLOCKED: Failure = { status: "forbidden", message: "Não é possível responder a essa pessoa." };

function invalid(error: z.ZodError): Failure {
  const issue = error.issues[0];
  return { status: "invalid", message: issue?.message ?? "Dados inválidos.", field: issue?.path.join(".") };
}

/** Session check + zod validation shared by every action. */
async function prepare<S extends z.ZodType>(schema: S, raw: unknown) {
  const user = await getSessionUser();
  if (!user) return { ok: false, failure: UNAUTHENTICATED } as const;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, failure: invalid(parsed.error) } as const;
  return { ok: true, user, data: parsed.data as z.output<S> } as const;
}

// ---------- Comments ----------

const moreCommentsSchema = commentTargetSchema.extend({ cursor: z.string().min(1).max(64) });

/** Next page of comments (public: no login needed), with the visitor's reactions and blocks. */
export async function loadMoreComments(raw: unknown): Promise<(CommentPage & { viewerState: SocialViewerState }) | Failure> {
  const parsed = moreCommentsSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const { targetType, targetId, cursor } = parsed.data;
  const [page, user] = await Promise.all([listComments(prisma, targetType, targetId, cursor), getSessionUser()]);
  return { ...page, viewerState: await socialViewerState(prisma, user?.id ?? null, "comment", page.comments) };
}

export async function postComment(raw: unknown): Promise<{ status: "ok"; comment: CommentView } | Failure> {
  const ready = await prepare(newCommentSchema, raw);
  if (!ready.ok) return ready.failure;
  const result = await createComment(prisma, ready.user.id, ready.data);
  if (result.status === "not_found") return NOT_FOUND;
  if (result.status === "blocked") return BLOCKED;
  if (result.status === "rate_limited") return { status: "rate_limited", message: RATE_LIMIT_MESSAGES.comment };
  if (ready.data.targetType === "photo") updateTag(photoTag(ready.data.targetId));
  if (result.articleSlug) refreshArticleCount(result.articleSlug);
  return result;
}

/** The article page and the news cards show Article.comments. */
function refreshArticleCount(slug: string) {
  updateTag(articleTag(slug));
  updateTag(NEWS_TAG);
}

export async function updateComment(raw: unknown): Promise<{ status: "ok"; comment: CommentView } | Failure> {
  const ready = await prepare(editCommentSchema, raw);
  if (!ready.ok) return ready.failure;
  const result = await editComment(prisma, ready.user.id, ready.data);
  if (result.status === "not_found") return NOT_FOUND;
  if (result.status === "forbidden") return FORBIDDEN;
  return result;
}

const idSchema = z.object({ id: z.string().min(1).max(64) });

export async function removeComment(raw: unknown): Promise<{ status: "ok" } | Failure> {
  const ready = await prepare(idSchema, raw);
  if (!ready.ok) return ready.failure;
  const result = await prisma.$transaction((tx) => deleteComment(tx, ready.user.id, ready.data.id));
  if (result.status === "not_found") return NOT_FOUND;
  if (result.status === "forbidden") return FORBIDDEN;
  if (result.xpVoided) await recomputeQuietly(ready.user.id);
  if (result.articleSlug) refreshArticleCount(result.articleSlug);
  if (result.photoId) updateTag(photoTag(result.photoId));
  return { status: "ok" };
}

// ---------- Reports ----------

export async function reportContent(raw: unknown): Promise<{ status: "ok" | "already_reported" } | Failure> {
  const ready = await prepare(reportSchema, raw);
  if (!ready.ok) return ready.failure;
  const result = await createReport(prisma, ready.user.id, ready.data);
  if (result.status === "not_found") return NOT_FOUND;
  return result;
}

// ---------- Gallery ----------

const photoIdSchema = z.object({ photoId: z.string().min(1).max(64) });

export async function likePhoto(raw: unknown): Promise<{ status: "ok"; liked: boolean; likeCount: number } | Failure> {
  const ready = await prepare(photoIdSchema, raw);
  if (!ready.ok) return ready.failure;
  if (!takeLikeToggle(ready.user.id)) return { status: "rate_limited", message: RATE_LIMIT_MESSAGES.like };
  const result = await prisma.$transaction((tx) => toggleLike(tx, ready.user.id, ready.data.photoId));
  if (result.status === "not_found") return NOT_FOUND;
  if (result.status === "rate_limited") return { status: "rate_limited", message: RATE_LIMIT_MESSAGES.like };
  // Only the photo's own page: gallery listings catch up on their short cacheLife.
  updateTag(photoTag(ready.data.photoId));
  return result;
}

// ---------- Forum ----------

export async function startThread(raw: unknown): Promise<{ status: "ok"; threadId: string } | Failure> {
  const ready = await prepare(newThreadSchema, raw);
  if (!ready.ok) return ready.failure;
  const result = await prisma.$transaction((tx) => createThread(tx, ready.user.id, ready.data));
  if (result.status === "not_found") return NOT_FOUND;
  if (result.status === "rate_limited") return { status: "rate_limited", message: RATE_LIMIT_MESSAGES.post };
  updateTag(FORUM_TAG);
  return result;
}

export async function replyToThread(raw: unknown): Promise<{ status: "ok"; post: PostView } | Failure> {
  const ready = await prepare(newPostSchema, raw);
  if (!ready.ok) return ready.failure;
  const result = await prisma.$transaction((tx) => createPost(tx, ready.user.id, ready.data));
  if (result.status === "not_found") return NOT_FOUND;
  if (result.status === "locked") return { status: "forbidden", message: "Este tópico está trancado." };
  if (result.status === "blocked") return BLOCKED;
  if (result.status === "rate_limited") return { status: "rate_limited", message: RATE_LIMIT_MESSAGES.post };
  updateTag(threadTag(ready.data.threadId));
  updateTag(FORUM_TAG);
  return result;
}

export async function markThreadSolved(raw: unknown): Promise<{ status: "ok" } | Failure> {
  const ready = await prepare(markSolvedSchema, raw);
  if (!ready.ok) return ready.failure;
  const result = await prisma.$transaction((tx) => markSolved(tx, ready.user.id, ready.data));
  switch (result.status) {
    case "not_found":
      return NOT_FOUND;
    case "forbidden":
      return { status: "forbidden", message: "Só quem abriu o tópico pode marcar a resposta que resolveu." };
    case "own_post":
      return { status: "forbidden", message: "Marque a resposta de outra pessoa." };
    case "already_solved":
      return { status: "forbidden", message: "Este tópico já tem uma resposta marcada." };
  }
  if (result.xpAwarded && result.answerAuthorId) await recomputeQuietly(result.answerAuthorId);
  updateTag(threadTag(ready.data.threadId));
  updateTag(FORUM_TAG);
  return { status: "ok" };
}

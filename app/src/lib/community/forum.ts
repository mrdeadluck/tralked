import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { authorSelect, type AuthorView } from "./comments";
import { withinRateLimit, type Db } from "./limits";
import { notify, preview } from "./notify";
import { postBodySchema, slugify, threadTitleSchema } from "./text";
import { awardForumSolvedXp, FORUM_SOLVED_XP } from "./xp";

/** Threads per listing page. */
export const THREADS_PER_PAGE = 20;
/** Threads that are listed and readable (hidden/removed ones are moderated away). */
const PUBLIC_THREAD_STATUS = { in: ["open", "locked"] };

export type ThreadRow = {
  id: string;
  title: string;
  pinned: boolean;
  locked: boolean;
  solved: boolean;
  replies: number;
  createdAt: Date;
  lastPostAt: Date;
  author: AuthorView;
  category: { slug: string; name: string } | null;
  game: { slug: string; name: string } | null;
};

const threadRowSelect = {
  id: true,
  title: true,
  pinned: true,
  status: true,
  solvedPostId: true,
  createdAt: true,
  lastPostAt: true,
  author: authorSelect,
  category: { select: { slug: true, name: true } },
  game: { select: { slug: true, name: true } },
  _count: { select: { posts: { where: { status: "visible" } } } },
} satisfies Prisma.ForumThreadSelect;

function toRow(t: Prisma.ForumThreadGetPayload<{ select: typeof threadRowSelect }>): ThreadRow {
  return {
    id: t.id,
    title: t.title,
    pinned: t.pinned,
    locked: t.status === "locked",
    solved: t.solvedPostId !== null,
    // The first post opens the thread; the rest are replies.
    replies: Math.max(0, t._count.posts - 1),
    createdAt: t.createdAt,
    lastPostAt: t.lastPostAt,
    author: t.author,
    category: t.category,
    game: t.game,
  };
}

export type CategorySummary = {
  slug: string;
  name: string;
  description: string;
  threadCount: number;
  lastPostAt: Date | null;
};

/** General sections in display order, with their thread counts. */
export async function listCategories(): Promise<CategorySummary[]> {
  const categories = await prisma.forumCategory.findMany({ orderBy: { order: "asc" } });
  const stats = await prisma.forumThread.groupBy({
    by: ["categoryId"],
    where: { status: PUBLIC_THREAD_STATUS, categoryId: { not: null } },
    _count: { _all: true },
    _max: { lastPostAt: true },
  });
  const byId = new Map(stats.map((s) => [s.categoryId, s]));
  return categories.map((c) => ({
    slug: c.slug,
    name: c.name,
    description: c.description,
    threadCount: byId.get(c.id)?._count._all ?? 0,
    lastPostAt: byId.get(c.id)?._max.lastPostAt ?? null,
  }));
}

export type GameTopic = { slug: string; name: string; threadCount: number };

/** Games that have at least one public thread, most active first. */
export async function listGameTopics(): Promise<GameTopic[]> {
  const stats = await prisma.forumThread.groupBy({
    by: ["gameId"],
    where: { status: PUBLIC_THREAD_STATUS, gameId: { not: null } },
    _count: { _all: true },
    _max: { lastPostAt: true },
  });
  const games = await prisma.game.findMany({
    where: { id: { in: stats.map((s) => s.gameId!) } },
    select: { id: true, slug: true, name: true },
  });
  const byId = new Map(games.map((g) => [g.id, g]));
  return stats
    .sort((a, b) => (b._max.lastPostAt?.getTime() ?? 0) - (a._max.lastPostAt?.getTime() ?? 0))
    .flatMap((s) => {
      const game = byId.get(s.gameId!);
      return game ? [{ slug: game.slug, name: game.name, threadCount: s._count._all }] : [];
    });
}

/** Most recently active public threads across the forum. */
export async function recentThreads(limit: number): Promise<ThreadRow[]> {
  const rows = await prisma.forumThread.findMany({
    where: { status: PUBLIC_THREAD_STATUS },
    orderBy: { lastPostAt: "desc" },
    take: limit,
    select: threadRowSelect,
  });
  return rows.map(toRow);
}

export type ForumSection =
  | { kind: "category"; id: string; slug: string; name: string; description: string }
  | { kind: "game"; id: string; slug: string; name: string; description: string };

/** A forum section by URL segment: a general category, or a game's own topic list. */
export async function findSection(segment: string): Promise<ForumSection | null> {
  const category = await prisma.forumCategory.findUnique({ where: { slug: segment } });
  if (category) {
    return { kind: "category", id: category.id, slug: category.slug, name: category.name, description: category.description };
  }
  const game = await prisma.game.findUnique({ where: { slug: segment }, select: { id: true, slug: true, name: true } });
  if (game) {
    return {
      kind: "game",
      id: game.id,
      slug: game.slug,
      name: game.name,
      description: `Dúvidas, rotas e conversa sobre ${game.name}.`,
    };
  }
  return null;
}

/** URL segments of every section, for generateStaticParams. */
export async function sectionSegments(): Promise<string[]> {
  const [categories, games] = await Promise.all([
    prisma.forumCategory.findMany({ select: { slug: true } }),
    listGameTopics(),
  ]);
  return [...categories.map((c) => c.slug), ...games.map((g) => g.slug)];
}

export type ThreadListing = { threads: ThreadRow[]; total: number; page: number; pageCount: number };

/** Public threads of a section: pinned first, then by latest activity. `page` starts at 1. */
export async function listSectionThreads(section: ForumSection, requestedPage = 1): Promise<ThreadListing> {
  const where: Prisma.ForumThreadWhereInput = {
    status: PUBLIC_THREAD_STATUS,
    ...(section.kind === "category" ? { categoryId: section.id } : { gameId: section.id }),
  };
  const total = await prisma.forumThread.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / THREADS_PER_PAGE));
  const page = Math.min(Math.max(1, Math.floor(requestedPage)), pageCount);
  const rows = await prisma.forumThread.findMany({
    where,
    orderBy: [{ pinned: "desc" }, { lastPostAt: "desc" }],
    skip: (page - 1) * THREADS_PER_PAGE,
    take: THREADS_PER_PAGE,
    select: threadRowSelect,
  });
  return { threads: rows.map(toRow), total, page, pageCount };
}

export type PostView = {
  id: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  author: AuthorView;
};

export type ThreadDetail = {
  id: string;
  title: string;
  slug: string;
  pinned: boolean;
  locked: boolean;
  solvedPostId: string | null;
  createdAt: Date;
  authorId: string | null;
  category: { slug: string; name: string } | null;
  game: { slug: string; name: string } | null;
  posts: PostView[];
};

/** A public thread with its visible posts in order; null when missing or moderated away. */
export async function getThread(id: string): Promise<ThreadDetail | null> {
  const thread = await prisma.forumThread.findFirst({
    where: { id, status: PUBLIC_THREAD_STATUS },
    select: {
      id: true,
      title: true,
      slug: true,
      pinned: true,
      status: true,
      solvedPostId: true,
      createdAt: true,
      authorId: true,
      category: { select: { slug: true, name: true } },
      game: { select: { slug: true, name: true } },
      posts: {
        where: { status: "visible" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, body: true, createdAt: true, editedAt: true, author: authorSelect },
      },
    },
  });
  if (!thread) return null;
  const { status, ...rest } = thread;
  return { ...rest, locked: status === "locked" };
}

/** Recently active thread ids, for generateStaticParams. */
export async function recentThreadIds(limit: number): Promise<string[]> {
  return (await recentThreads(limit)).map((t) => t.id);
}

// ---------- Mutations (pass a transaction) ----------

export const newThreadSchema = z.object({
  section: z.string().min(1).max(120),
  title: threadTitleSchema,
  body: postBodySchema,
});

export const newPostSchema = z.object({
  threadId: z.string().min(1).max(64),
  body: postBodySchema,
});

export const markSolvedSchema = z.object({
  threadId: z.string().min(1).max(64),
  postId: z.string().min(1).max(64),
});

export type CreateThreadResult =
  | { status: "ok"; threadId: string }
  | { status: "not_found" }
  | { status: "rate_limited" };

/** Opens a thread in a section (category or game) with its first post. */
export async function createThread(
  db: Db,
  userId: string,
  input: z.output<typeof newThreadSchema>,
  now: Date = new Date(),
): Promise<CreateThreadResult> {
  const category = await db.forumCategory.findUnique({ where: { slug: input.section }, select: { id: true } });
  const game = category
    ? null
    : await db.game.findUnique({ where: { slug: input.section }, select: { id: true } });
  if (!category && !game) return { status: "not_found" };
  if (!(await withinRateLimit(db, "post", userId, now))) return { status: "rate_limited" };

  const thread = await db.forumThread.create({
    data: {
      categoryId: category?.id ?? null,
      gameId: game?.id ?? null,
      authorId: userId,
      title: input.title,
      slug: slugify(input.title),
      createdAt: now,
      lastPostAt: now,
      posts: { create: { authorId: userId, body: input.body, createdAt: now } },
    },
    select: { id: true },
  });
  return { status: "ok", threadId: thread.id };
}

export type CreatePostResult =
  | { status: "ok"; post: PostView }
  | { status: "not_found" }
  | { status: "locked" }
  | { status: "rate_limited" };

/** Replies to an open thread and notifies its author. */
export async function createPost(
  db: Db,
  userId: string,
  input: z.output<typeof newPostSchema>,
  now: Date = new Date(),
): Promise<CreatePostResult> {
  const thread = await db.forumThread.findFirst({
    where: { id: input.threadId, status: PUBLIC_THREAD_STATUS },
    select: { status: true, authorId: true, title: true },
  });
  if (!thread) return { status: "not_found" };
  if (thread.status === "locked") return { status: "locked" };
  if (!(await withinRateLimit(db, "post", userId, now))) return { status: "rate_limited" };

  const post = await db.forumPost.create({
    data: { threadId: input.threadId, authorId: userId, body: input.body, createdAt: now },
    select: { id: true, body: true, createdAt: true, editedAt: true, author: authorSelect },
  });
  await db.forumThread.update({ where: { id: input.threadId }, data: { lastPostAt: now } });
  await notify(db, {
    userId: thread.authorId,
    actorId: userId,
    kind: "forum_reply",
    title: `@${post.author?.handle ?? "alguém"} respondeu "${preview(thread.title)}"`,
    body: preview(input.body),
    href: `/forum/t/${input.threadId}#post-${post.id}`,
  });
  return { status: "ok", post };
}

export type MarkSolvedResult =
  | { status: "ok"; answerAuthorId: string | null; xpAwarded: boolean }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "own_post" }
  | { status: "already_solved" };

/**
 * The thread author marks one reply as "Resolveu". Only the thread author may do it, only once
 * per thread, and not on their own post. The reply's author earns `forum_solved` (40 XP Sábio).
 * Run inside a transaction; the caller recomputes `answerAuthorId` when `xpAwarded`.
 */
export async function markSolved(
  db: Db,
  userId: string,
  input: z.output<typeof markSolvedSchema>,
): Promise<MarkSolvedResult> {
  const thread = await db.forumThread.findFirst({
    where: { id: input.threadId, status: PUBLIC_THREAD_STATUS },
    select: { authorId: true, title: true },
  });
  if (!thread) return { status: "not_found" };
  if (thread.authorId !== userId) return { status: "forbidden" };

  const post = await db.forumPost.findFirst({
    where: { id: input.postId, threadId: input.threadId, status: "visible" },
    select: { authorId: true },
  });
  if (!post) return { status: "not_found" };
  if (post.authorId === userId) return { status: "own_post" };

  // The guarded update makes the first marker win if two requests race.
  const claimed = await db.forumThread.updateMany({
    where: { id: input.threadId, solvedPostId: null },
    data: { solvedPostId: input.postId },
  });
  if (claimed.count === 0) return { status: "already_solved" };

  const xpAwarded = post.authorId ? await awardForumSolvedXp(db, post.authorId, input.postId) : false;
  await notify(db, {
    userId: post.authorId,
    actorId: userId,
    kind: "thread_solved",
    title: `Sua resposta resolveu "${preview(thread.title)}"`,
    body: `+${FORUM_SOLVED_XP} XP em Sábio`,
    href: `/forum/t/${input.threadId}#post-${input.postId}`,
  });
  return { status: "ok", answerAuthorId: post.authorId, xpAwarded };
}

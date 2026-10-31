import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { ARTICLE_CATEGORIES, ARTICLE_PLATFORMS } from "@/lib/api/article-schema";
import { isUniqueViolation } from "@/lib/api/write";
import { slugSchema } from "@/lib/content/guide-schema";
import { clip, contentBlocksSchema, parseStoredBlocks, plainText, type ContentBlock } from "@/lib/content/schema";
import { prisma } from "@/lib/db";

/**
 * Newsroom side of articles: the admin editor's input, the list, the review queue and saving.
 * Workflow: draft → review → published → archived (an editor may move an article back to draft).
 */

export const ARTICLE_STATUSES = ["draft", "review", "published", "archived"] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const ARTICLE_STATUS_LABEL: Record<ArticleStatus, string> = {
  draft: "Rascunho",
  review: "Em revisão",
  published: "Publicada",
  archived: "Arquivada",
};

const id = z.string().min(1).max(64);
/** Optional text: the form sends "" for an empty field. */
const optionalText = (max: number) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), plainText(max).optional());

export const articleInputSchema = z
  .strictObject({
    id: id.optional(),
    title: plainText(200),
    slug: slugSchema.min(1, "Informe o endereço (slug)"),
    subtitle: optionalText(300),
    excerpt: optionalText(300),
    category: z.enum(ARTICLE_CATEGORIES, { error: "Escolha uma categoria" }),
    platforms: z.array(z.enum(ARTICLE_PLATFORMS)).max(ARTICLE_PLATFORMS.length),
    imageLabel: optionalText(60),
    /** 0 = list, 1 = side highlight, 2 = main highlight */
    featured: z.number().int().min(0).max(2),
    status: z.enum(ARTICLE_STATUSES),
    gameIds: z.array(id).max(10, "No máximo 10 jogos relacionados"),
    blocks: contentBlocksSchema,
  })
  .superRefine((article, ctx) => {
    if (article.status !== "draft" && article.blocks.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["blocks"],
        message: "Adicione ao menos um bloco antes de enviar para revisão ou publicar",
      });
    }
  });

export type ArticleInput = z.output<typeof articleInputSchema>;

export type SaveArticleResult =
  | { ok: true; id: string; slug: string; previousSlug: string | null; gameSlugs: string[] }
  | { ok: false; error: string; field?: string };

const isLocked = (status: string) => status === "published" || status === "archived";

/** The staff member's byline (Author row linked to the user), created on first use. */
async function staffAuthorId(user: { id: string; handle: string }): Promise<string> {
  const own = await prisma.author.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (own) return own.id;
  for (const handle of [user.handle, `${user.handle}-${user.id.slice(-6)}`]) {
    try {
      return (await prisma.author.create({ data: { handle, userId: user.id }, select: { id: true } })).id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return (await prisma.author.findUniqueOrThrow({ where: { userId: user.id }, select: { id: true } })).id;
}

/**
 * Creates or updates an article from the admin editor. The slug of an article that was ever
 * published is frozen (it is its public URL). Publishing stamps `publishedAt`; publishing a bot
 * article also stamps `reviewedAt` ("Gerado por robô · revisado pela redação").
 */
export async function saveArticle(
  input: ArticleInput,
  editor: { id: string; handle: string },
  now: Date = new Date(),
): Promise<SaveArticleResult> {
  const existing = input.id
    ? await prisma.article.findUnique({
        where: { id: input.id },
        select: { id: true, slug: true, status: true, source: true, reviewedAt: true },
      })
    : null;
  if (input.id && !existing) return { ok: false, error: "Esta notícia não existe mais." };
  if (existing && isLocked(existing.status) && existing.slug !== input.slug) {
    return { ok: false, error: "O endereço de uma notícia já publicada não muda.", field: "slug" };
  }

  const clash = await prisma.article.findUnique({ where: { slug: input.slug }, select: { id: true } });
  if (clash && clash.id !== existing?.id) {
    return { ok: false, error: `Já existe uma notícia com o endereço "${input.slug}".`, field: "slug" };
  }

  const gameIds = [...new Set(input.gameIds)];
  const games = await prisma.game.findMany({ where: { id: { in: gameIds } }, select: { slug: true } });
  if (games.length !== gameIds.length) return { ok: false, error: "Um dos jogos relacionados não existe.", field: "gameIds" };
  const gameSlugs = games.map((g) => g.slug);

  const publishing = input.status === "published" && existing?.status !== "published";
  const data = {
    title: input.title,
    slug: input.slug,
    subtitle: input.subtitle ?? null,
    excerpt: input.excerpt ?? null,
    category: input.category,
    platforms: input.platforms,
    imageLabel: input.imageLabel ?? clip(input.title.toLowerCase(), 60),
    featured: input.featured,
    status: input.status,
    blocks: input.blocks as Prisma.InputJsonValue,
    // Plan 1 cards still read the single legacy game.
    gameId: gameIds[0] ?? null,
    ...(publishing ? { publishedAt: now } : {}),
    ...(publishing && existing?.source === "bot" && !existing.reviewedAt ? { reviewedAt: now } : {}),
  };

  try {
    if (existing) {
      await prisma.$transaction([
        prisma.article.update({ where: { id: existing.id }, data }),
        prisma.articleGame.deleteMany({ where: { articleId: existing.id } }),
        prisma.articleGame.createMany({ data: gameIds.map((gameId) => ({ articleId: existing.id, gameId })) }),
      ]);
      return { ok: true, id: existing.id, slug: input.slug, previousSlug: existing.slug, gameSlugs };
    }
    const authorId = await staffAuthorId(editor);
    const created = await prisma.article.create({
      data: {
        ...data,
        body: "",
        authorId,
        source: "editorial",
        humanAuthored: true,
        publishedAt: now,
        games: { create: gameIds.map((gameId) => ({ gameId })) },
      },
      select: { id: true },
    });
    return { ok: true, id: created.id, slug: input.slug, previousSlug: null, gameSlugs };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return { ok: false, error: `Já existe uma notícia com o endereço "${input.slug}".`, field: "slug" };
  }
}

export const articleStatusSchema = z.strictObject({ id, status: z.enum(ARTICLE_STATUSES) });

/**
 * Moves an article through the workflow without opening the editor (review queue buttons).
 * Same publishing rules as `saveArticle`; an article without content cannot leave draft.
 */
export async function setArticleStatus(
  input: z.output<typeof articleStatusSchema>,
  now: Date = new Date(),
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const article = await prisma.article.findUnique({
    where: { id: input.id },
    select: { slug: true, status: true, source: true, reviewedAt: true, blocks: true, body: true },
  });
  if (!article) return { ok: false, error: "Esta notícia não existe mais." };
  const hasContent = (parseStoredBlocks(article.blocks)?.length ?? 0) > 0 || article.body.trim() !== "";
  if (input.status !== "draft" && !hasContent) {
    return { ok: false, error: "A notícia não tem conteúdo. Abra o editor e adicione blocos." };
  }
  const publishing = input.status === "published" && article.status !== "published";
  await prisma.article.update({
    where: { id: input.id },
    data: {
      status: input.status,
      ...(publishing ? { publishedAt: now } : {}),
      ...(publishing && article.source === "bot" && !article.reviewedAt ? { reviewedAt: now } : {}),
    },
  });
  return { ok: true, slug: article.slug };
}

// ---------- Reading ----------

export const ARTICLES_PER_PAGE = 30;

export type AdminArticleRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  source: string | null;
  author: string;
  botKeyName: string | null;
  reviewedAt: Date | null;
  publishedAt: Date;
  updatedAt: Date;
};

const rowSelect = {
  id: true,
  slug: true,
  title: true,
  status: true,
  source: true,
  reviewedAt: true,
  publishedAt: true,
  updatedAt: true,
  author: { select: { handle: true } },
  botKey: { select: { name: true } },
} as const;

type RowShape = Prisma.ArticleGetPayload<{ select: typeof rowSelect }>;

const toRow = (a: RowShape): AdminArticleRow => ({
  id: a.id,
  slug: a.slug,
  title: a.title,
  status: a.status,
  source: a.source,
  author: a.author.handle,
  botKeyName: a.botKey?.name ?? null,
  reviewedAt: a.reviewedAt,
  publishedAt: a.publishedAt,
  updatedAt: a.updatedAt,
});

export type ArticleFilter = { status?: ArticleStatus | null; source?: "editorial" | "bot" | null; q?: string | null; page?: number };

export async function listAdminArticles(filter: ArticleFilter) {
  const where: Prisma.ArticleWhereInput = {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.source === "bot" ? { source: "bot" } : filter.source === "editorial" ? { NOT: { source: "bot" } } : {}),
    ...(filter.q ? { title: { contains: filter.q, mode: "insensitive" } } : {}),
  };
  const total = await prisma.article.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / ARTICLES_PER_PAGE));
  const page = Math.min(Math.max(1, filter.page ?? 1), pageCount);
  const rows = await prisma.article.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * ARTICLES_PER_PAGE,
    take: ARTICLES_PER_PAGE,
    select: rowSelect,
  });
  return { rows: rows.map(toRow), total, page, pageCount };
}

/** Articles waiting for an editor (status review), bot ones first, oldest first. */
export async function articlesInReview(): Promise<AdminArticleRow[]> {
  const rows = await prisma.article.findMany({
    where: { status: "review" },
    orderBy: [{ createdAt: "asc" }],
    take: 100,
    select: rowSelect,
  });
  return rows.map(toRow).sort((a, b) => Number(b.source === "bot") - Number(a.source === "bot"));
}

export type ArticleForEdit = {
  id: string;
  title: string;
  slug: string;
  subtitle: string;
  excerpt: string;
  category: string;
  platforms: string[];
  imageLabel: string;
  featured: number;
  status: ArticleStatus;
  gameIds: string[];
  blocks: ContentBlock[];
  /** The stored blocks were missing or invalid: the article still renders its legacy body. */
  legacyBody: boolean;
  source: string | null;
  botKeyName: string | null;
  author: string;
  reviewedAt: Date | null;
  publishedAt: Date;
};

export async function getArticleForEdit(articleId: string): Promise<ArticleForEdit | null> {
  const a = await prisma.article.findUnique({
    where: { id: articleId },
    include: {
      games: { select: { gameId: true } },
      author: { select: { handle: true } },
      botKey: { select: { name: true } },
    },
  });
  if (!a) return null;
  const blocks = parseStoredBlocks(a.blocks);
  const gameIds = [...new Set([...a.games.map((g) => g.gameId), ...(a.gameId ? [a.gameId] : [])])];
  return {
    id: a.id,
    title: a.title,
    slug: a.slug,
    subtitle: a.subtitle ?? "",
    excerpt: a.excerpt ?? "",
    category: a.category,
    platforms: a.platforms,
    imageLabel: a.imageLabel,
    featured: a.featured,
    status: (ARTICLE_STATUSES as readonly string[]).includes(a.status) ? (a.status as ArticleStatus) : "draft",
    gameIds,
    blocks: blocks ?? [],
    legacyBody: !blocks || (blocks.length === 0 && a.body.trim() !== ""),
    source: a.source,
    botKeyName: a.botKey?.name ?? null,
    author: a.author.handle,
    reviewedAt: a.reviewedAt,
    publishedAt: a.publishedAt,
  };
}

export type GameOption = { id: string; name: string; slug: string };

/** Every catalog game, for the related-games picker. */
export async function gameOptions(): Promise<GameOption[]> {
  return prisma.game.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } });
}

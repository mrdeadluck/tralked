import { revalidateTag } from "next/cache";
import type { Prisma } from "@/generated/prisma/client";
import { slugify } from "@/lib/community/text";
import { clip } from "@/lib/content/schema";
import { prisma } from "@/lib/db";
import { articleTag, NEWS_TAG } from "@/lib/queries/news";
import { articlePatchSchema, articlePayloadSchema } from "./article-schema";
import { articleUrl, resolveGames } from "./games";
import type { ApiKeyRecord } from "./keys";
import { parseBody } from "./parse";
import { fail, isUniqueViolation, type WriteContext, type WriteFailure, type WriteSuccess } from "./write";

/**
 * Bot articles: `source = bot`, `humanAuthored = false`, author "Robô <key name>". Without the
 * `publish` scope they enter the review queue (`status = review`); an editor publishing them sets
 * `reviewedAt`, which shows the "Gerado por robô · revisado pela redação" badge.
 */

export const botAuthorHandle = (key: Pick<ApiKeyRecord, "name">) => `Robô ${key.name}`;

const canPublish = (key: ApiKeyRecord) => key.scopes.includes("publish");

const publishForbidden = (): WriteFailure =>
  fail(
    "forbidden",
    "Publicar direto exige o escopo publish. Sem status, a notícia entra na fila de revisão.",
    [{ path: "/status", message: "Esta chave não tem o escopo publish" }],
  );

function invalidateNews(slug: string) {
  // expire 0: a page cached as "not found" before publication must not be served stale.
  revalidateTag(NEWS_TAG, { expire: 0 });
  revalidateTag(articleTag(slug), { expire: 0 });
}

/** The bot author (one per key name), created on first use. */
async function botAuthorId(key: ApiKeyRecord): Promise<string> {
  const handle = botAuthorHandle(key);
  try {
    const author = await prisma.author.upsert({ where: { handle }, create: { handle }, update: {}, select: { id: true } });
    return author.id;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return (await prisma.author.findUniqueOrThrow({ where: { handle }, select: { id: true } })).id;
  }
}

const slugTaken = (slug: string, chosen: boolean): WriteFailure =>
  fail(
    "slug_conflict",
    chosen
      ? `Já existe uma notícia com o slug "${slug}".`
      : `Já existe uma notícia com o slug "${slug}", gerado do título. Se não for a mesma notícia, envie um slug próprio.`,
    [{ path: "/slug", message: "Slug em uso" }],
  );

export async function createArticle(ctx: WriteContext): Promise<WriteSuccess | WriteFailure> {
  const parsed = parseBody(articlePayloadSchema, ctx.body);
  if (!parsed.ok) return parsed;
  const payload = parsed.data;
  if (payload.status === "published" && !canPublish(ctx.key)) return publishForbidden();
  const status = payload.status ?? (canPublish(ctx.key) ? "published" : "review");

  const { games, issues } = await resolveGames(payload.games, ["games"]);
  if (issues.length > 0) return fail("validation_failed", "Há jogos que não existem no catálogo.", issues);

  const slug = payload.slug ?? slugify(payload.title);
  if (await prisma.article.findUnique({ where: { slug }, select: { id: true } })) {
    return slugTaken(slug, payload.slug !== undefined);
  }

  const authorId = await botAuthorId(ctx.key);
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      const article = await tx.article.create({
        data: {
          slug,
          title: payload.title,
          subtitle: payload.subtitle ?? null,
          excerpt: payload.excerpt ?? null,
          body: "",
          blocks: payload.blocks as Prisma.InputJsonValue,
          status,
          category: payload.category,
          platforms: payload.platforms,
          imageLabel: clip((payload.imageLabel ?? games[0]?.name ?? payload.title).toLowerCase(), 60),
          authorId,
          source: "bot",
          botKeyId: ctx.key.id,
          humanAuthored: false,
          publishedAt: now,
          firstPublishedAt: status === "published" ? now : null,
          games: { create: games.map((g) => ({ gameId: g.id })) },
        },
        select: { id: true },
      });
      const success: WriteSuccess = {
        ok: true,
        httpStatus: 201,
        body: { id: article.id, status, url: articleUrl(slug) },
        resultId: article.id,
        logStatus: "created",
        after: status === "published" ? () => invalidateNews(slug) : undefined,
      };
      await ctx.record(tx, success);
      return success;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return slugTaken(slug, payload.slug !== undefined);
    throw error;
  }
}

/** The key's own article, or null (other keys' and editorial articles are invisible). */
function ownArticle(key: ApiKeyRecord, id: string) {
  return prisma.article.findFirst({
    where: { id, botKeyId: key.id },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      reviewedAt: true,
      publishedAt: true,
      firstPublishedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/** Another request with the same Idempotency-Key committed first (the pipeline replays it). */
export const concurrentWrite = (id?: string): WriteFailure =>
  fail("idempotency_conflict", "Outra requisição com o mesmo Idempotency-Key foi concluída antes.", [], id);

const notFound = () => fail("not_found", "Notícia não encontrada para esta chave.");

export async function updateArticle(ctx: WriteContext, id: string): Promise<WriteSuccess | WriteFailure> {
  const article = await ownArticle(ctx.key, id);
  if (!article) return notFound();

  const parsed = parseBody(articlePatchSchema, ctx.body);
  if (!parsed.ok) return { ...parsed, resultId: id };
  const patch = parsed.data;

  const live = article.status === "published" || article.status === "archived";
  if (live && !canPublish(ctx.key)) {
    return fail(
      "published_locked",
      "A notícia já foi publicada pela redação; só chaves com o escopo publish podem alterá-la.",
      [],
      id,
    );
  }
  if (patch.status === "published" && !canPublish(ctx.key)) return { ...publishForbidden(), resultId: id };

  let gameIds: string[] | undefined;
  if (patch.games) {
    const { games, issues } = await resolveGames(patch.games, ["games"]);
    if (issues.length > 0) return fail("validation_failed", "Há jogos que não existem no catálogo.", issues, id);
    gameIds = games.map((g) => g.id);
  }

  const status = patch.status ?? article.status;
  const publishing = status === "published" && article.status !== "published";

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.article.update({
        where: { id },
        data: {
          title: patch.title,
          subtitle: patch.subtitle,
          excerpt: patch.excerpt,
          blocks: patch.blocks as Prisma.InputJsonValue | undefined,
          category: patch.category,
          platforms: patch.platforms,
          imageLabel: patch.imageLabel === undefined ? undefined : clip(patch.imageLabel.toLowerCase(), 60),
          status,
          ...(publishing ? { publishedAt: new Date() } : {}),
          ...(publishing && !article.firstPublishedAt ? { firstPublishedAt: new Date() } : {}),
          ...(gameIds
            ? { games: { deleteMany: {}, create: gameIds.map((gameId) => ({ gameId })) } }
            : {}),
        },
      });
      const success: WriteSuccess = {
        ok: true,
        httpStatus: 200,
        body: { id, status, url: articleUrl(article.slug) },
        resultId: id,
        logStatus: "updated",
        after:
          status === "published" || article.status === "published"
            ? () => invalidateNews(article.slug)
            : undefined,
      };
      await ctx.record(tx, success);
      return success;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return concurrentWrite(id);
    throw error;
  }
}

/** Status of one of the key's articles (GET /api/v1/articles/{id}). */
export async function articleStatus(key: ApiKeyRecord, id: string) {
  const article = await ownArticle(key, id);
  if (!article) return null;
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    status: article.status,
    url: articleUrl(article.slug),
    reviewed: article.reviewedAt !== null,
    publishedAt: article.status === "published" ? article.publishedAt.toISOString() : null,
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
  };
}

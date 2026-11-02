import { z } from "zod";
import { ARTICLE_CATEGORIES } from "@/lib/api/article-schema";
import { prisma } from "@/lib/db";
import { logModeration } from "./log";
import { moderationReasonSchema, notifyOwner } from "./notice";

/**
 * Moderation of editorial content from its public page: unpublish an article or re-file it
 * (category, highlight), and take a guide off the site. Callers check the role first
 * (articles: canEditArticles; guides: canModerate).
 */

const id = z.string().min(1).max(64);

export const articleModerationSchema = z.discriminatedUnion("op", [
  z.strictObject({ id, op: z.literal("unpublish"), reason: moderationReasonSchema }),
  z.strictObject({ id, op: z.literal("category"), category: z.enum(ARTICLE_CATEGORIES, { error: "Categoria inválida." }) }),
  z.strictObject({ id, op: z.literal("featured"), featured: z.number().int().min(0).max(2) }),
]);

export type ArticleModerationInput = z.output<typeof articleModerationSchema>;

export async function moderateArticle(
  input: ArticleModerationInput,
  actorId: string,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  return prisma.$transaction(async (tx) => {
    const article = await tx.article.findUnique({
      where: { id: input.id },
      select: { slug: true, status: true, category: true, featured: true },
    });
    if (!article) return { ok: false, error: "Esta notícia não existe mais." } as const;

    let details: { from: string | number; to: string | number };
    switch (input.op) {
      case "unpublish":
        if (article.status !== "published") return { ok: false, error: "Esta notícia não está publicada." } as const;
        // Back to draft: the editor can fix it and publish again (the slug stays frozen).
        await tx.article.update({ where: { id: input.id }, data: { status: "draft" } });
        details = { from: "published", to: "draft" };
        break;
      case "category":
        if (article.category === input.category) return { ok: false, error: "A notícia já está nessa categoria." } as const;
        await tx.article.update({ where: { id: input.id }, data: { category: input.category } });
        details = { from: article.category, to: input.category };
        break;
      case "featured":
        if (article.featured === input.featured) return { ok: false, error: "A notícia já tem esse destaque." } as const;
        await tx.article.update({ where: { id: input.id }, data: { featured: input.featured } });
        details = { from: article.featured, to: input.featured };
        break;
    }
    await logModeration(tx, {
      actorId,
      action: `article.${input.op}`,
      targetType: "article",
      targetId: input.id,
      reason: input.op === "unpublish" ? input.reason : null,
      details,
    });
    return { ok: true, slug: article.slug } as const;
  });
}

export const guideRemovalSchema = z.strictObject({ id, reason: moderationReasonSchema });

/**
 * Takes a published guide off the site (back to draft, so the newsroom can fix and republish
 * it), resolves its open reports and tells its author.
 */
export async function removeGuide(
  input: z.output<typeof guideRemovalSchema>,
  actorId: string,
  now: Date = new Date(),
): Promise<{ ok: true; gameSlug: string } | { ok: false; error: string }> {
  return prisma.$transaction(async (tx) => {
    const guide = await tx.guide.findUnique({
      where: { id: input.id },
      select: { status: true, authorId: true, game: { select: { slug: true, name: true } } },
    });
    if (!guide) return { ok: false, error: "Este guia não existe mais." } as const;
    if (guide.status !== "published") return { ok: false, error: "Este guia não está publicado." } as const;
    await tx.guide.update({ where: { id: input.id }, data: { status: "draft" } });
    await tx.report.updateMany({
      where: { targetType: "guide", targetId: input.id, status: "open" },
      data: { status: "resolved", resolvedAt: now, resolvedById: actorId },
    });
    await logModeration(tx, {
      actorId,
      action: "guide.remove",
      targetType: "guide",
      targetId: input.id,
      targetUserId: guide.authorId,
      reason: input.reason,
    });
    await notifyOwner(tx, {
      userId: guide.authorId,
      actorId,
      title: `Seu guia de ${guide.game.name} foi tirado do ar pela moderação`,
      reason: input.reason,
      href: `/jogos/${guide.game.slug}`,
    });
    return { ok: true, gameSlug: guide.game.slug } as const;
  });
}

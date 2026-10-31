import { z } from "zod";
import { gameRefSchema, slugSchema } from "@/lib/content/guide-schema";
import { contentBlocksSchema, plainText } from "@/lib/content/schema";

/** News article payload of the bot API. Strict: unknown fields are errors, no raw HTML anywhere. */

export const ARTICLE_CATEGORIES = ["GAMES", "GUIAS", "COMUNIDADE", "MERCADO", "ENTRETENIMENTO", "TECNOLOGIA"] as const;
export const ARTICLE_PLATFORMS = ["PC", "PLAYSTATION", "XBOX", "NINTENDO"] as const;
export const ARTICLE_STATUSES = ["review", "published"] as const;

const articleFields = {
  title: plainText(200),
  subtitle: plainText(300),
  /** Card and metadata summary; defaults to the subtitle or the first paragraph. */
  excerpt: plainText(300),
  category: z.enum(ARTICLE_CATEGORIES),
  platforms: z.array(z.enum(ARTICLE_PLATFORMS)).max(ARTICLE_PLATFORMS.length),
  /** Games the article is about (each must exist in the catalog). */
  games: z.array(gameRefSchema).max(10),
  /** Short label drawn on the generated cover art when there is no image. */
  imageLabel: plainText(60),
  blocks: contentBlocksSchema.min(1, "Envie ao menos um bloco"),
  /** `published` needs the `publish` scope. Default: published with that scope, else review. */
  status: z.enum(ARTICLE_STATUSES),
};

export const articlePayloadSchema = z.strictObject({
  ...articleFields,
  /** URL slug (/noticias/<slug>). Default: generated from the title. */
  slug: slugSchema.optional(),
  subtitle: articleFields.subtitle.optional(),
  excerpt: articleFields.excerpt.optional(),
  platforms: articleFields.platforms.default([]),
  games: articleFields.games.default([]),
  imageLabel: articleFields.imageLabel.optional(),
  status: articleFields.status.optional(),
});

/** PATCH: any subset of the fields (the slug cannot change: it is the article's URL). */
export const articlePatchSchema = z
  .strictObject(articleFields)
  .partial()
  .superRefine((patch, ctx) => {
    if (Object.keys(patch).length === 0) {
      ctx.addIssue({ code: "custom", message: "Envie ao menos um campo para alterar" });
    }
  });

export type ArticlePayload = z.output<typeof articlePayloadSchema>;
export type ArticlePayloadInput = z.input<typeof articlePayloadSchema>;
export type ArticlePatch = z.output<typeof articlePatchSchema>;

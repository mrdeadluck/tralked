import { z } from "zod";
import {
  ACHIEVEMENT_PLATFORMS,
  contentBlocksSchema,
  plainText,
  stripInline,
  type ContentBlock,
} from "./schema";

/**
 * Guide payload of the bot API (and of anything else that writes a whole guide): the fact sheet,
 * overview, warnings, steps with block bodies, achievement notes with block tips, collectibles and
 * sources. Every object is strict and every text goes through the ContentBlock text rules, so raw
 * HTML and script URLs are refused here as well.
 */

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .trim()
  .max(120)
  .regex(SLUG_PATTERN, "Use letras minúsculas, números e hífens (ex.: hollow-knight)");

/** A game by exactly one of its ids: Tralked slug, Steam appid or IGDB id. */
export const gameRefSchema = z
  .strictObject({
    slug: slugSchema.optional(),
    steamAppId: z.number().int().positive().optional(),
    igdbId: z.number().int().positive().optional(),
  })
  .superRefine((ref, ctx) => {
    const given = [ref.slug, ref.steamAppId, ref.igdbId].filter((v) => v !== undefined).length;
    if (given !== 1) {
      ctx.addIssue({ code: "custom", message: "Informe exatamente um entre slug, steamAppId e igdbId" });
    }
  })
  .meta({ minProperties: 1, maxProperties: 1 });

export type GameRef = z.output<typeof gameRefSchema>;

export const describeGameRef = (ref: GameRef) =>
  ref.slug !== undefined
    ? `slug "${ref.slug}"`
    : ref.steamAppId !== undefined
      ? `steamAppId ${ref.steamAppId}`
      : `igdbId ${ref.igdbId}`;

export const GUIDE_NOTE_CATEGORIES = ["historia", "chefes", "coletaveis", "desafio", "dlc"] as const;
export const GUIDE_STATUSES = ["review", "published"] as const;

const apiNameSchema = z.string().trim().min(1).max(200).regex(/^[^<>\s]+$/, "apiName inválido");

/** A body made of ContentBlock[], with at least one block. */
const blockBody = (max: number) => contentBlocksSchema.min(1, "Envie ao menos um bloco").max(max);

export const guideFactsSchema = z
  .strictObject({
    /** 1 (trivial) to 10 (extreme). */
    difficulty: z.number().int().min(1).max(10),
    hoursMin: z.number().int().min(0).max(5000),
    hoursMax: z.number().int().min(0).max(5000),
    /** Free text: "1", "2 (Ritual e Banishment)", "3 a 4". */
    playthroughs: plainText(80),
    /** Missable achievements. */
    missables: z.number().int().min(0).max(5000),
    /** Online achievements. */
    online: z.number().int().min(0).max(5000),
  })
  .superRefine((facts, ctx) => {
    if (facts.hoursMax < facts.hoursMin) {
      ctx.addIssue({ code: "custom", path: ["hoursMax"], message: "hoursMax não pode ser menor que hoursMin" });
    }
  });

export const guideStepSchema = z.strictObject({
  title: plainText(160),
  /** Estimated time of the step: "35 a 45 h". */
  hours: plainText(40),
  body: blockBody(120),
  /** Steam apiNames unlocked in this step (they must exist on the game). */
  achievements: z.array(apiNameSchema).max(200).default([]),
});

export const guideAchievementNoteSchema = z.strictObject({
  apiName: apiNameSchema,
  platform: z.enum(ACHIEVEMENT_PLATFORMS).default("steam"),
  category: z.enum(GUIDE_NOTE_CATEGORIES),
  spoiler: z.boolean().default(false),
  tip: blockBody(40),
  /** Short checklist for the achievement. */
  steps: z.array(plainText(500)).max(30).default([]),
});

export const guideCollectibleSchema = z.strictObject({
  name: plainText(120),
  total: z.number().int().min(1).max(100_000),
  description: plainText(500).optional(),
});

export const guideSourceSchema = z.strictObject({
  title: plainText(200),
  url: z.url({ protocol: /^https?$/, error: "A fonte precisa de uma URL http(s)://" }).max(2048),
});

const versionSchema = z
  .string()
  .trim()
  .regex(/^v?\d{1,3}(?:\.\d{1,3}){0,2}$/, "Use uma versão como v1.0 ou 2.3.1");

const textList = z.array(plainText(1000)).max(20);

/** Fields a guide update may change (all of them replace the stored value). */
const guideFields = {
  status: z.enum(GUIDE_STATUSES).optional(),
  version: versionSchema.optional(),
  facts: guideFactsSchema,
  overview: textList,
  warnings: textList,
  /** Optional free-form introduction (Guide.blocks). */
  body: contentBlocksSchema.max(120),
  steps: z.array(guideStepSchema).min(1, "O guia precisa de ao menos uma etapa").max(60),
  achievementNotes: z.array(guideAchievementNoteSchema).max(1000),
  collectibles: z.array(guideCollectibleSchema).max(60),
  sources: z.array(guideSourceSchema).max(30),
};

function checkUniqueNotes(
  notes: { apiName: string; platform: string }[] | undefined,
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>();
  notes?.forEach((note, i) => {
    const key = `${note.platform}:${note.apiName}`;
    if (seen.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: ["achievementNotes", i, "apiName"],
        message: `Conquista repetida: ${note.apiName}`,
      });
    }
    seen.add(key);
  });
}

export const guidePayloadSchema = z
  .strictObject({
    game: gameRefSchema,
    ...guideFields,
    overview: guideFields.overview.default([]),
    warnings: guideFields.warnings.default([]),
    body: guideFields.body.optional(),
    achievementNotes: guideFields.achievementNotes.default([]),
    collectibles: guideFields.collectibles.default([]),
    sources: guideFields.sources.default([]),
  })
  .superRefine((guide, ctx) => checkUniqueNotes(guide.achievementNotes, ctx));

export const guidePatchSchema = z
  .strictObject(guideFields)
  .partial()
  .superRefine((patch, ctx) => {
    if (Object.keys(patch).length === 0) {
      ctx.addIssue({ code: "custom", message: "Envie ao menos um campo para alterar" });
    }
    checkUniqueNotes(patch.achievementNotes, ctx);
  });

export type GuidePayload = z.output<typeof guidePayloadSchema>;
export type GuidePayloadInput = z.input<typeof guidePayloadSchema>;
export type GuidePatch = z.output<typeof guidePatchSchema>;
export type GuideStepPayload = z.output<typeof guideStepSchema>;
export type GuideNotePayload = z.output<typeof guideAchievementNoteSchema>;

/**
 * Plain text of blocks, for the plain-text columns (GuideStep.body, GuideAchievementNote.tip)
 * that pages without a block renderer still read. Markup is stripped; media blocks are skipped.
 */
export function blocksToPlainText(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        parts.push(block.text);
        break;
      case "paragraph":
      case "callout":
        parts.push(stripInline(block.text));
        break;
      case "quote":
        parts.push(stripInline(block.text) + (block.author ? ` (${block.author})` : ""));
        break;
      case "list":
        parts.push(block.items.map((item) => stripInline(item)).join("; "));
        break;
      case "table":
        parts.push(block.rows.map((row) => row.map((cell) => stripInline(cell)).join(", ")).join("; "));
        break;
      default:
        break;
    }
  }
  return parts.join(" ").trim();
}

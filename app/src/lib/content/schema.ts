import { z } from "zod";
import { isSafeHttpUrl } from "./url";

/**
 * ContentBlock[]: the single block format for news and guides (spec Plan 2, "Formato de conteúdo
 * único em blocos"). Shared by the site renderer (`<Blocks>`), the admin editor and the bot API,
 * so every object is strict (unknown keys are errors) and no field accepts raw HTML.
 *
 * Text that allows inline markup (paragraph, list items, quote, callout, table cells) supports
 * only **bold**, *italic* and [links](https://…) with an http(s) target. Walkthroughs (guide
 * format 2) add `||spoiler||`: an inline span hidden until the reader turns spoilers on (see
 * INLINE_SPOILER and walkthrough-schema.ts); elsewhere `||` is plain text.
 */

/**
 * `||text||`: an inline spoiler of a walkthrough (a boss name, a twist, a hidden achievement's name
 * inside prose). Shared with the renderer and the page's masking so all three read spans alike.
 */
export const INLINE_SPOILER = /\|\|(?=\S)(.+?)\|\|/g;

/** `[label](target)`: the only link syntax. Shared with the renderer so both read links alike. */
export const INLINE_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/** Any HTML-looking tag or comment: `<b`, `</p`, `<!--`, `<?xml`. A bare "a < b" stays allowed. */
const HTML_TAG = /<[a-zA-Z!/?]/;
/**
 * Script schemes are refused anywhere in text. `data:` is not: "save data: ..." is ordinary text,
 * and link/image targets are already limited to http(s).
 */
const SCRIPT_SCHEME = /(?:javascript|vbscript)\s*:/i;
/** C0 control characters except tab (\u0009) and line feed (\u000A). */
const CONTROL_CHAR = /[\u0000-\u0008\u000B-\u001F]/;

export { isSafeHttpUrl };

function checkText(value: string, ctx: z.RefinementCtx, inline: boolean) {
  if (CONTROL_CHAR.test(value)) {
    ctx.addIssue({ code: "custom", message: "Caractere de controle não permitido" });
  }
  if (HTML_TAG.test(value)) {
    ctx.addIssue({ code: "custom", message: "HTML não é permitido; use texto puro" });
  }
  if (SCRIPT_SCHEME.test(value)) {
    ctx.addIssue({ code: "custom", message: "Esquema de URL não permitido (javascript:, vbscript:)" });
  }
  if (!inline) return;
  for (const match of value.matchAll(INLINE_LINK)) {
    if (!isSafeHttpUrl(match[2] ?? "")) {
      ctx.addIssue({ code: "custom", message: `Link inválido: "${match[2]}" (use http:// ou https://)` });
    }
  }
}

/** Plain text: no markup, no HTML. */
export const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "Obrigatório")
    .max(max)
    .superRefine((value, ctx) => checkText(value, ctx, false));

/** Text with restricted inline markup (**bold**, *italic*, [link](https://…)). */
export const inlineText = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "Obrigatório")
    .max(max)
    .superRefine((value, ctx) => checkText(value, ctx, true));

/** Stable key (of a step, chapter or item): lowercase letters, numbers and hyphens ("chefe-final"). */
export const STEP_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ACHIEVEMENT_PLATFORMS = ["steam", "psn", "xbox", "retro"] as const;
export const CALLOUT_TONES = ["info", "aviso", "spoiler"] as const;
export const TABLE_MAX_COLUMNS = 8;

export const headingBlockSchema = z.strictObject({
  type: z.literal("heading"),
  level: z.union([z.literal(2), z.literal(3)]),
  text: plainText(200),
});

export const paragraphBlockSchema = z.strictObject({
  type: z.literal("paragraph"),
  text: inlineText(5000),
});

export const listBlockSchema = z.strictObject({
  type: z.literal("list"),
  ordered: z.boolean(),
  items: z.array(inlineText(1000)).min(1).max(100),
});

export const quoteBlockSchema = z.strictObject({
  type: z.literal("quote"),
  text: inlineText(2000),
  author: plainText(120).optional(),
});

export const imageBlockSchema = z.strictObject({
  type: z.literal("image"),
  url: z.url({ protocol: /^https$/, error: "A imagem precisa de uma URL https://" }).max(2048),
  alt: plainText(300),
  credit: plainText(200),
});

export const videoBlockSchema = z.strictObject({
  type: z.literal("video"),
  youtubeId: z.string().regex(/^[A-Za-z0-9_-]{11}$/, "ID de vídeo do YouTube inválido"),
  /** What the video is ("Trailer de lançamento de Hades II"): the player's accessible name and caption. */
  title: plainText(200).optional(),
});

export const calloutBlockSchema = z.strictObject({
  type: z.literal("callout"),
  tone: z.enum(CALLOUT_TONES),
  text: inlineText(2000),
});

export const tableBlockSchema = z
  .strictObject({
    type: z.literal("table"),
    header: z.array(plainText(120)).min(1).max(TABLE_MAX_COLUMNS),
    rows: z.array(z.array(inlineText(500)).min(1).max(TABLE_MAX_COLUMNS)).min(1).max(100),
  })
  .superRefine((table, ctx) => {
    table.rows.forEach((row, i) => {
      if (row.length !== table.header.length) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", i],
          message: `A linha tem ${row.length} colunas; o cabeçalho tem ${table.header.length}`,
        });
      }
    });
  });

export const achievementBlockSchema = z.strictObject({
  type: z.literal("achievement"),
  // No spaces, angle brackets or control characters.
  apiName: z.string().trim().min(1).max(200).regex(/^[^<>\s\u0000-\u001F]+$/, "apiName inválido"),
  /** Platform of the achievement; apiNames are only unique per game and platform. */
  platform: z.enum(ACHIEVEMENT_PLATFORMS).default("steam"),
});

export const dividerBlockSchema = z.strictObject({ type: z.literal("divider") });

export const contentBlockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  paragraphBlockSchema,
  listBlockSchema,
  quoteBlockSchema,
  imageBlockSchema,
  videoBlockSchema,
  calloutBlockSchema,
  tableBlockSchema,
  achievementBlockSchema,
  dividerBlockSchema,
]);

export const contentBlocksSchema = z.array(contentBlockSchema).max(300);

/** A validated block (defaults applied, e.g. achievement.platform). */
export type ContentBlock = z.output<typeof contentBlockSchema>;
/** What a client (admin editor, bot) may send. */
export type ContentBlockInput = z.input<typeof contentBlockSchema>;
export type ContentBlockType = ContentBlock["type"];
export type AchievementPlatform = (typeof ACHIEVEMENT_PLATFORMS)[number];
export type CalloutTone = (typeof CALLOUT_TONES)[number];

/** Data a page resolved for an `achievement` block (keyed by `achievementKey`). */
export type AchievementCardData = {
  name: string;
  description: string | null;
  globalPct: number | null;
  gameName: string;
};

export const achievementKey = (platform: AchievementPlatform, apiName: string) =>
  `${platform}:${apiName}`;

/**
 * Validates stored blocks (Article.blocks / Guide.blocks are untyped JSON). Returns null when the
 * value is not a valid ContentBlock[], so callers can fall back to the legacy Markdown body.
 */
export function parseStoredBlocks(value: unknown): ContentBlock[] | null {
  const result = contentBlocksSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Plain-text summary of blocks for cards and metadata: the first paragraph without markup. */
export function blocksExcerpt(blocks: ContentBlock[], max = 180): string | null {
  const first = blocks.find((b) => b.type === "paragraph");
  return first ? clip(stripInline(first.text), max) : null;
}

/** Removes inline markup: `**a**` -> `a`, `[b](url)` -> `b`. */
export function stripInline(text: string): string {
  return text
    .replace(INLINE_LINK, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

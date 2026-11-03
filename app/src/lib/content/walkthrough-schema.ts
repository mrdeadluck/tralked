import { z } from "zod";
import { contentBlocksSchema, INLINE_SPOILER, inlineText, plainText, STEP_KEY_PATTERN, type ContentBlock } from "./schema";

/**
 * Walkthrough of guide format 2 (the guide robot): a cover, "read first" notes and chapters of
 * steps whose items (collectibles, achievements, missions...) readers tick off. Same text rules as
 * ContentBlock (no raw HTML, no script URLs). Dependency-light on purpose: the robot imports this
 * file for its contract test.
 *
 * Every `key` (chapter, step, item) lives in ONE namespace: readers' checkmarks hang on item keys,
 * so a repeated key anywhere would tick two things at once.
 *
 * Inline text (step paragraphs, lists, quotes, callouts and table cells, read-first notes, item
 * locations) and a chapter's `deadline` may wrap a spoiler in `||…||` (a boss name, a twist, a
 * hidden achievement's name): the page leaves it out until the reader turns spoilers on (the
 * guide's roadmap steps too). Every `||` must close. A step's headings and table headers are plain
 * text shown as is: they refuse `||` (the page would print the bars).
 *
 * `scope` (R22): "steam" (default) covers every Steam achievement; "psn" follows the PSN trophy list
 * (`psnList`) and names the Steam achievements left without a route (`steamOnly`).
 */

export const WALK_ITEM_KINDS = ["collectible", "achievement", "mission", "key_item", "boss", "other"] as const;
/** Platform seal of the guide: Steam only, or the Steam list also covers PSN / Xbox / both. */
export const GUIDE_COMPAT = ["steam_only", "psn_xbox", "psn", "xbox"] as const;
/**
 * Which list the guide covers: the whole Steam list (default), or the PSN trophy list when no source
 * covers the Steam-only achievements yet (R22). A "psn" guide names its PSN list and the Steam
 * achievements it has no route for (`steamOnly`).
 */
export const GUIDE_SCOPES = ["steam", "psn"] as const;

const keySchema = z.string().trim().min(1).max(80).regex(STEP_KEY_PATTERN, "Use letras minúsculas, números e hífens");
const apiNameSchema = z.string().trim().min(1).max(200).regex(/^[^<>\s]+$/, "apiName inválido");
const httpsUrl = z.url({ protocol: /^https$/, error: "Precisa de uma URL https://" }).max(2048);
const httpUrl = z.url({ protocol: /^https?$/, error: "Precisa de uma URL http(s)://" }).max(2048);

export const walkSourceSchema = z.strictObject({ name: plainText(120), url: httpUrl });

export const walkItemSchema = z
  .strictObject({
    key: keySchema,
    kind: z.enum(WALK_ITEM_KINDS),
    name: plainText(80),
    /** Original (English) name, when the item has one and the PT-BR name differs. */
    nameEn: plainText(80).optional(),
    /** "sino", "acessório"... what the item is counted as. */
    collectibleType: plainText(40).optional(),
    /** "2 of 22": position in its count. Both or none. */
    index: z.number().int().min(1).optional(),
    total: z.number().int().min(1).optional(),
    location: inlineText(400).optional(),
    missable: z.boolean(),
    returnLater: z.boolean(),
    spoiler: z.boolean(),
    /** Steam apiName of the achievement this item IS. */
    achievement: apiNameSchema.optional(),
    /** Steam apiNames this item counts toward. */
    countsFor: z.array(apiNameSchema).max(20),
    alsoOn: z.array(z.enum(["psn", "xbox"])).max(2),
    image: z
      .strictObject({
        url: httpsUrl,
        credit: plainText(200),
        sourceName: plainText(120),
        sourceUrl: httpUrl.optional(),
      })
      .optional(),
    sources: z.array(walkSourceSchema).min(1, "Informe ao menos uma fonte").max(10),
    /** The robot is unsure (sources disagree or only one cites it): an editor must look. */
    review: z.boolean(),
  })
  .superRefine((item, ctx) => {
    if ((item.index === undefined) !== (item.total === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: [item.index === undefined ? "index" : "total"],
        message: "index e total andam juntos",
      });
    } else if (item.index !== undefined && item.total !== undefined && item.index > item.total) {
      ctx.addIssue({ code: "custom", path: ["index"], message: "index não pode passar de total" });
    }
  });

export const walkStepSchema = z.strictObject({
  key: keySchema,
  body: contentBlocksSchema.min(1, "Envie ao menos um bloco").max(20),
  items: z.array(walkItemSchema).max(40),
});

export const walkChapterSchema = z.strictObject({
  key: keySchema,
  /** Key of the roadmap step (guide `steps[]`) this chapter belongs to. */
  phaseKey: keySchema,
  title: plainText(80),
  region: plainText(120).optional(),
  hours: plainText(40),
  sceneImage: httpsUrl.optional(),
  /** Point after which missables of this chapter are lost. */
  deadline: plainText(200).optional(),
  steps: z.array(walkStepSchema).min(1).max(80),
});

export const walkReadFirstSchema = z.strictObject({
  title: plainText(60),
  text: inlineText(400),
  tone: z.enum(["aviso", "info"]),
  spoiler: z.boolean(),
});

/** Whether `text` has a `||` that opens no closed spoiler span. */
export const unclosedSpoiler = (text: string) => text.replace(INLINE_SPOILER, "").includes("||");

/** Inline texts of a step block, with their path inside the block. */
function blockTexts(block: ContentBlock): { text: string; path: (string | number)[] }[] {
  switch (block.type) {
    case "paragraph":
    case "quote":
    case "callout":
      return [{ text: block.text, path: ["text"] }];
    case "list":
      return block.items.map((text, i) => ({ text, path: ["items", i] }));
    case "table":
      return block.rows.flatMap((row, r) => row.map((text, c) => ({ text, path: ["rows", r, c] })));
    default:
      return [];
  }
}

/** Plain texts of a step block (heading, table header): shown as is, so `||` is refused there. */
function blockPlainTexts(block: ContentBlock): { text: string; path: (string | number)[] }[] {
  switch (block.type) {
    case "heading":
      return [{ text: block.text, path: ["text"] }];
    case "table":
      return block.header.map((text, i) => ({ text, path: ["header", i] }));
    default:
      return [];
  }
}

const SPOILER_UNCLOSED = "Spoiler sem fechamento: use ||texto||";
const SPOILER_IN_PLAIN = "Este campo não aceita ||: título e cabeçalho de tabela aparecem como estão. Escreva sem o spoiler.";

type ScopeFields = {
  scope: (typeof GUIDE_SCOPES)[number];
  psnList?: { total: number; names: string[] };
  steamOnly?: string[];
};

/** psnList and steamOnly go with scope "psn" (both required there) and nowhere else. */
function scopeIssues(w: ScopeFields, ctx: z.RefinementCtx) {
  if (w.scope === "steam") {
    if (w.psnList) ctx.addIssue({ code: "custom", path: ["psnList"], message: 'psnList só vale com scope "psn"' });
    if (w.steamOnly) ctx.addIssue({ code: "custom", path: ["steamOnly"], message: 'steamOnly só vale com scope "psn"' });
    return;
  }
  if (!w.psnList) {
    ctx.addIssue({ code: "custom", path: ["psnList"], message: 'Guia com scope "psn" exige psnList (total e nomes dos troféus)' });
  } else if (w.psnList.names.length !== w.psnList.total) {
    ctx.addIssue({
      code: "custom",
      path: ["psnList", "names"],
      message: `psnList.names tem ${w.psnList.names.length} nomes, mas total é ${w.psnList.total}`,
    });
  }
  if (!w.steamOnly) {
    ctx.addIssue({ code: "custom", path: ["steamOnly"], message: 'Guia com scope "psn" exige steamOnly (pode ser vazio)' });
    return;
  }
  const seen = new Set<string>();
  w.steamOnly.forEach((apiName, i) => {
    if (seen.has(apiName)) ctx.addIssue({ code: "custom", path: ["steamOnly", i], message: `apiName repetido: ${apiName}` });
    seen.add(apiName);
  });
}

export const walkthroughSchema = z
  .strictObject({
    cover: z.strictObject({
      calls: z
        .array(z.strictObject({ value: plainText(8), label: plainText(28) }))
        .length(3, "A capa tem exatamente 3 destaques"),
      sealHours: plainText(12),
      headline: plainText(60),
      deck: plainText(90),
    }),
    extraFacts: z.strictObject({
      buggedCount: z.number().int().min(0),
      hardest: z.strictObject({ apiName: apiNameSchema }).nullable(),
      playthroughsNote: plainText(120),
      difficultyNote: plainText(160),
    }),
    compat: z.enum(GUIDE_COMPAT),
    scope: z.enum(GUIDE_SCOPES).default("steam"),
    /** Scope psn: the PSN trophy list the guide follows (platinum included), names as the source lists them. */
    psnList: z
      .strictObject({ total: z.number().int().min(1).max(1000), names: z.array(plainText(160)).min(1).max(1000) })
      .optional(),
    /** Scope psn: Steam apiNames this guide has no route for (they are not on the PSN list). */
    steamOnly: z.array(apiNameSchema).max(1000).optional(),
    readFirst: z.array(walkReadFirstSchema).min(1).max(8),
    chapters: z.array(walkChapterSchema).min(1).max(60),
    soundtrack: z
      .strictObject({
        youtubeId: z.string().regex(/^[A-Za-z0-9_-]{11}$/, "ID de vídeo do YouTube inválido").optional(),
        playlistId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "ID de playlist inválido").optional(),
        title: plainText(120),
        channel: plainText(120),
      })
      .optional(),
  })
  .superRefine((w, ctx) => {
    const seen = new Set<string>();
    const claim = (key: string, path: (string | number)[]) => {
      if (seen.has(key)) ctx.addIssue({ code: "custom", path, message: `key repetida: ${key}` });
      seen.add(key);
    };
    const spoilers = (text: string | undefined, path: (string | number)[]) => {
      if (text && unclosedSpoiler(text)) ctx.addIssue({ code: "custom", path, message: SPOILER_UNCLOSED });
    };
    scopeIssues(w, ctx);
    w.readFirst.forEach((note, n) => spoilers(note.text, ["readFirst", n, "text"]));
    w.chapters.forEach((chapter, c) => {
      claim(chapter.key, ["chapters", c, "key"]);
      spoilers(chapter.deadline, ["chapters", c, "deadline"]);
      chapter.steps.forEach((step, s) => {
        claim(step.key, ["chapters", c, "steps", s, "key"]);
        step.body.forEach((block, b) => {
          blockTexts(block).forEach(({ text, path }) => spoilers(text, ["chapters", c, "steps", s, "body", b, ...path]));
          blockPlainTexts(block).forEach(({ text, path }) => {
            if (text.includes("||")) {
              ctx.addIssue({ code: "custom", path: ["chapters", c, "steps", s, "body", b, ...path], message: SPOILER_IN_PLAIN });
            }
          });
        });
        step.items.forEach((item, i) => {
          claim(item.key, ["chapters", c, "steps", s, "items", i, "key"]);
          spoilers(item.location, ["chapters", c, "steps", s, "items", i, "location"]);
        });
      });
    });
  });

export type Walkthrough = z.output<typeof walkthroughSchema>;
export type WalkthroughInput = z.input<typeof walkthroughSchema>;
export type GuideCompat = (typeof GUIDE_COMPAT)[number];
export type GuideScope = (typeof GUIDE_SCOPES)[number];
export type WalkChapter = z.output<typeof walkChapterSchema>;
export type WalkStep = z.output<typeof walkStepSchema>;
export type WalkItem = z.output<typeof walkItemSchema>;
export type WalkItemKind = (typeof WALK_ITEM_KINDS)[number];

/** Keys of every item, in reading order (what GuideItemProgress.itemKey can hold). */
export function walkItemKeys(w: Walkthrough): string[] {
  return w.chapters.flatMap((chapter) => chapter.steps.flatMap((step) => step.items.map((item) => item.key)));
}

/** Every Steam apiName the walkthrough points at (item.achievement, countsFor, hardest), with its JSON Pointer. */
export function walkAchievementRefs(w: Walkthrough): { apiName: string; path: string }[] {
  const refs: { apiName: string; path: string }[] = [];
  w.chapters.forEach((chapter, c) =>
    chapter.steps.forEach((step, s) =>
      step.items.forEach((item, i) => {
        const base = `/chapters/${c}/steps/${s}/items/${i}`;
        if (item.achievement) refs.push({ apiName: item.achievement, path: `${base}/achievement` });
        item.countsFor.forEach((apiName, n) => refs.push({ apiName, path: `${base}/countsFor/${n}` }));
      }),
    ),
  );
  if (w.extraFacts.hardest) refs.push({ apiName: w.extraFacts.hardest.apiName, path: "/extraFacts/hardest/apiName" });
  return refs;
}

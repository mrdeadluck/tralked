import {
  contentBlockSchema,
  type AchievementPlatform,
  type CalloutTone,
  type ContentBlock,
  type ContentBlockType,
} from "@/lib/content/schema";

/**
 * The admin block editor keeps each block as plain form strings (a list is one item per line, a
 * table is cells split by " | "), so half-typed input is never lost. These pure helpers convert
 * between that draft and ContentBlock, and validate with the same schema the site and the bot API
 * use (`contentBlockSchema`).
 */

export type BlockDraft = {
  /** Stable React key (not stored). */
  key: string;
  type: ContentBlockType;
  /** heading, paragraph, quote, callout text; list items and table rows (one per line). */
  text: string;
  /** heading level 2 | 3 */
  level: 2 | 3;
  ordered: boolean;
  /** quote author, image credit */
  author: string;
  url: string;
  /** image alt text, video title */
  alt: string;
  /** YouTube id or URL */
  video: string;
  tone: CalloutTone;
  /** Table header cells, split by " | ". */
  header: string;
  apiName: string;
  platform: AchievementPlatform;
};

export const BLOCK_TYPE_LABEL: Record<ContentBlockType, string> = {
  paragraph: "Parágrafo",
  heading: "Título",
  list: "Lista",
  quote: "Citação",
  image: "Imagem",
  video: "Vídeo",
  callout: "Destaque",
  table: "Tabela",
  achievement: "Conquista",
  divider: "Divisória",
};

export const BLOCK_TYPES = Object.keys(BLOCK_TYPE_LABEL) as ContentBlockType[];

const CELL_SEPARATOR = " | ";
const splitLines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);
const splitCells = (line: string) => line.split("|").map((cell) => cell.trim());

let counter = 0;
const nextKey = () => `b${Date.now().toString(36)}${(counter++).toString(36)}`;

export function emptyDraft(type: ContentBlockType): BlockDraft {
  return {
    key: nextKey(),
    type,
    text: "",
    level: 2,
    ordered: false,
    author: "",
    url: "",
    alt: "",
    video: "",
    tone: "info",
    header: "",
    apiName: "",
    platform: "steam",
  };
}

export function draftFromBlock(block: ContentBlock): BlockDraft {
  const draft = emptyDraft(block.type);
  switch (block.type) {
    case "heading":
      return { ...draft, text: block.text, level: block.level };
    case "paragraph":
      return { ...draft, text: block.text };
    case "list":
      return { ...draft, text: block.items.join("\n"), ordered: block.ordered };
    case "quote":
      return { ...draft, text: block.text, author: block.author ?? "" };
    case "image":
      return { ...draft, url: block.url, alt: block.alt, author: block.credit };
    case "video":
      return { ...draft, video: block.youtubeId, alt: block.title ?? "" };
    case "callout":
      return { ...draft, text: block.text, tone: block.tone };
    case "table":
      return { ...draft, header: block.header.join(CELL_SEPARATOR), text: block.rows.map((r) => r.join(CELL_SEPARATOR)).join("\n") };
    case "achievement":
      return { ...draft, apiName: block.apiName, platform: block.platform };
    case "divider":
      return draft;
  }
}

/** YouTube id from an id or a youtube.com / youtu.be URL (anything else is returned as typed). */
export function youtubeIdFrom(value: string): string {
  const input = value.trim();
  const match =
    /^https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/.exec(input) ??
    /^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{11})/.exec(input);
  return match ? match[1] : input;
}

/** The block a draft describes (not validated: see `validateDrafts`). Empty optionals are left out. */
export function blockFromDraft(draft: BlockDraft): unknown {
  switch (draft.type) {
    case "heading":
      return { type: "heading", level: draft.level, text: draft.text };
    case "paragraph":
      return { type: "paragraph", text: draft.text };
    case "list":
      return { type: "list", ordered: draft.ordered, items: splitLines(draft.text) };
    case "quote":
      return { type: "quote", text: draft.text, ...(draft.author.trim() ? { author: draft.author } : {}) };
    case "image":
      return { type: "image", url: draft.url.trim(), alt: draft.alt, credit: draft.author };
    case "video":
      return { type: "video", youtubeId: youtubeIdFrom(draft.video), ...(draft.alt.trim() ? { title: draft.alt } : {}) };
    case "callout":
      return { type: "callout", tone: draft.tone, text: draft.text };
    case "table":
      return { type: "table", header: splitCells(draft.header).filter(Boolean), rows: splitLines(draft.text).map(splitCells) };
    case "achievement":
      return { type: "achievement", apiName: draft.apiName.trim(), platform: draft.platform };
    case "divider":
      return { type: "divider" };
  }
}

export type DraftCheck = {
  /** Valid blocks in order, or null when any block is invalid. */
  blocks: ContentBlock[] | null;
  /** Per block: the validated block (for the preview) or its problems (pt-BR). */
  results: ({ ok: true; block: ContentBlock } | { ok: false; issues: string[] })[];
};

const FIELD_LABEL: Record<string, string> = {
  text: "Texto",
  items: "Itens",
  url: "URL",
  alt: "Texto alternativo",
  credit: "Crédito",
  author: "Autor",
  youtubeId: "Vídeo",
  header: "Cabeçalho",
  rows: "Linhas",
  apiName: "apiName",
};

export function validateDrafts(drafts: BlockDraft[]): DraftCheck {
  const results = drafts.map((draft): DraftCheck["results"][number] => {
    const parsed = contentBlockSchema.safeParse(blockFromDraft(draft));
    if (parsed.success) return { ok: true, block: parsed.data };
    const issues = parsed.error.issues.map((issue) => {
      const field = typeof issue.path[0] === "string" ? FIELD_LABEL[issue.path[0]] : undefined;
      const row = issue.path[0] === "rows" && typeof issue.path[1] === "number" ? ` ${issue.path[1] + 1}` : "";
      return field ? `${field}${row}: ${issue.message}` : issue.message;
    });
    return { ok: false, issues: [...new Set(issues)] };
  });
  const valid = results.every((r) => r.ok);
  return { blocks: valid ? results.map((r) => (r as { block: ContentBlock }).block) : null, results };
}

export function moveDraft<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

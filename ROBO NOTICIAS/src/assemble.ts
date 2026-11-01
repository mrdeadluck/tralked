import type { Draft, DraftBlock } from "./ai/writer.js";
import {
  ARTICLE_PLATFORMS,
  type ArticleCategory,
  type ArticlePayload,
  type ArticlePlatform,
  type ContentBlock,
  type Insights,
} from "./tralked.js";
import { normalizeUrl } from "./url.js";

/**
 * Turns a writer draft into the site's article payload. Deterministic: the block order, the fixed
 * section titles and every safety rule live here, not in the model.
 */

/** The site's limits (app/src/lib/api/article-schema.ts and app/src/lib/content/schema.ts). */
const LIMITS = {
  title: 200,
  subtitle: 300,
  excerpt: 300,
  imageLabel: 60,
  heading: 200,
  paragraph: 5000,
  listItem: 1000,
  listItems: 100,
  quote: 2000,
  author: 120,
  callout: 2000,
  tableHeader: 120,
  tableCell: 500,
  tableColumns: 8,
  tableRows: 100,
  blocks: 300,
  games: 10,
} as const;

const MAX_ACHIEVEMENTS = 3;
const ACHIEVEMENT_PLATFORMS = ["steam", "psn", "xbox", "retro"] as const;
type AchievementPlatform = (typeof ACHIEVEMENT_PLATFORMS)[number];

const TZ = "America/Sao_Paulo";
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// ---------------------------------------------------------------------------------------------
// Text sanitizing
// ---------------------------------------------------------------------------------------------

/** Same as the site's INLINE_LINK. */
const INLINE_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
/** Any HTML-looking tag or comment start, as the site refuses it. */
const HTML_START = /<[a-zA-Z!/?]/;
const HTML_TAG = /<[a-zA-Z!/?][^<>]*>?/g;
const SCRIPT_SCHEME = /(javascript|vbscript)\s*:/gi;
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

const isHttps = (url: string) => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

function stripHtml(text: string): string {
  let out = text;
  for (let i = 0; i < 5 && HTML_START.test(out); i++) out = out.replace(HTML_TAG, "");
  // Whatever still looks like a tag start (e.g. "<<b"): break it so the site reads it as text.
  return out.replace(/<(?=[a-zA-Z!/?])/g, "< ");
}

/** Text with inline markup: no HTML, no script schemes, links only to https. */
function inline(text: string): string {
  const cleaned = stripHtml(text.replace(CONTROL_CHARS, ""))
    .replace(INLINE_LINK, (match, label: string, target: string) => (isHttps(target) ? match : label))
    .replace(SCRIPT_SCHEME, "$1");
  return collapse(cleaned);
}

/** Plain text: as `inline`, and links reduced to their label and bold/italic marks removed. */
function plain(text: string): string {
  return collapse(
    inline(text)
      .replace(INLINE_LINK, "$1")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2"),
  );
}

/** Spaces collapsed inside lines; line breaks kept (paragraphs may have them). */
function collapse(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cuts at a word boundary with an ellipsis, like the site's `clip`. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const inlineText = (text: string | null | undefined, max: number) => clip(inline(text ?? ""), max);
const plainText = (text: string | null | undefined, max: number) => clip(plain(text ?? ""), max);

// ---------------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------------

const heading = (text: string): ContentBlock => ({ type: "heading", level: 2, text });
const paragraph = (text: string): ContentBlock => ({ type: "paragraph", text });
const list = (items: string[]): ContentBlock => ({ type: "list", ordered: false, items });

function listItems(items: string[]): string[] {
  return items
    .map((item) => inlineText(item, LIMITS.listItem))
    .filter((item) => item.length > 0)
    .slice(0, LIMITS.listItems);
}

function bodyBlock(block: DraftBlock): ContentBlock | null {
  if ("h" in block) {
    const text = plainText(block.h, LIMITS.heading);
    return text ? heading(text) : null;
  }
  if ("p" in block) {
    const text = inlineText(block.p, LIMITS.paragraph);
    return text ? paragraph(text) : null;
  }
  if ("lista" in block) {
    const items = listItems(block.lista);
    return items.length > 0 ? list(items) : null;
  }
  if ("citacao" in block) {
    // The site draws the quote marks; drop the model's outer ones.
    const text = inlineText(block.citacao.trim().replace(/^["“”]+|["“”]+$/g, ""), LIMITS.quote);
    if (!text) return null;
    const author = plainText(block.autor, LIMITS.author);
    return author ? { type: "quote", text, author } : { type: "quote", text };
  }
  if ("tabela" in block) return table(block.tabela.cabecalho, block.tabela.linhas);
  return null;
}

function table(rawHeader: string[], rawRows: string[][]): ContentBlock | null {
  const header = rawHeader
    .slice(0, LIMITS.tableColumns)
    .map((cell) => plainText(cell, LIMITS.tableHeader) || "—");
  if (header.length === 0) return null;
  const rows = rawRows
    .filter((row) => row.some((cell) => inline(cell ?? "").length > 0))
    .slice(0, LIMITS.tableRows)
    .map((row) => header.map((_, i) => inlineText(row[i], LIMITS.tableCell) || "—"));
  return rows.length > 0 ? { type: "table", header, rows } : null;
}

const asAchievementPlatform = (platform: string): AchievementPlatform | undefined => {
  const p = platform.toLowerCase();
  return (ACHIEVEMENT_PLATFORMS as readonly string[]).includes(p) ? (p as AchievementPlatform) : undefined;
};

function noTralkedBlocks(noTralked: Draft["noTralked"], insights: Map<string, Insights>): ContentBlock[] {
  if (!noTralked) return [];
  const blocks: ContentBlock[] = [];
  const casual = inlineText(noTralked.casual, LIMITS.callout - 40);
  if (casual) blocks.push({ type: "callout", tone: "info", text: `**Pra quem joga de boa:** ${casual}` });
  const cacador = inlineText(noTralked.cacador, LIMITS.callout - 40);
  if (cacador) blocks.push({ type: "callout", tone: "info", text: `**Pra quem caça 100%:** ${cacador}` });

  // Only apiNames the site gave us: anything else would be an invented achievement.
  const rarest = new Map<string, Insights["rarest"][number]>();
  for (const data of insights.values()) for (const a of data.rarest) if (!rarest.has(a.apiName)) rarest.set(a.apiName, a);
  const seen = new Set<string>();
  for (const apiName of noTralked.conquistas) {
    const known = rarest.get(apiName.trim());
    if (!known || seen.has(known.apiName)) continue;
    seen.add(known.apiName);
    const platform = asAchievementPlatform(known.platform);
    blocks.push(platform ? { type: "achievement", apiName: known.apiName, platform } : { type: "achievement", apiName: known.apiName });
    if (seen.size >= MAX_ACHIEVEMENTS) break;
  }
  return blocks.length > 0 ? [heading("No Tralked"), ...blocks] : [];
}

function sourceBlocks(sources: { name: string; url: string }[]): ContentBlock[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const source of sources) {
    const url = source.url.trim();
    if (!isHttps(url) || /[\s()]/.test(url)) continue;
    // Reddit threads are an engagement signal (signal-only sources), never a source of the article.
    if (/^https:\/\/([a-z0-9-]+\.)?reddit\.com\//i.test(url)) continue;
    const key = normalizeUrl(url);
    if (seen.has(key)) continue;
    const name = plain(source.name).replace(/[[\]]/g, "") || new URL(url).hostname;
    const item = `[${clip(name, 200)}](${url})`;
    // Clipping would cut the link in half: a source that cannot fit is left out.
    if (item.length > LIMITS.listItem) continue;
    seen.add(key);
    items.push(item);
  }
  return items.length > 0 ? [heading("Fontes"), list(items.slice(0, LIMITS.listItems))] : [];
}

// ---------------------------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------------------------

export type AssembleStory = {
  sources: { name: string; url: string }[];
  /** Games the writer may link; without it, the games with insights. */
  candidates?: { slug: string }[];
};

export type AssembleOpts = {
  insights: Map<string, Insights>;
  updatedAt?: Date;
  /** Follow-ups: the earlier article of the case, linked before the body (https only). */
  parent?: { title: string; url: string };
};

/** `Entenda o caso: [title](url)`, or null when the link would not be a safe https link. */
function parentLink(parent: { title: string; url: string }): ContentBlock | null {
  const url = parent.url.trim();
  if (!isHttps(url) || /[\s()]/.test(url)) return null;
  const title = clip(plain(parent.title).replace(/[[\]]/g, ""), 200);
  if (!title) return null;
  return paragraph(`Entenda o caso: [${title}](${url})`);
}

/** A writer draft, or a pauta draft whose category was set in code after drafting (GUIAS included). */
export type AssembleDraft = Omit<Draft, "category"> & { category: ArticleCategory };

export function assemble(draft: AssembleDraft, story: AssembleStory, opts: AssembleOpts): ArticlePayload {
  const blocks: ContentBlock[] = [];

  if (opts.updatedAt) blocks.push(paragraph(`*Atualizado às ${timeFmt.format(opts.updatedAt)}*`));

  // The 3 points stay in the draft (the checker reads them) but are not shown: Lucas found the
  // block redundant under the deck.
  const link = opts.parent ? parentLink(opts.parent) : null;
  if (link) blocks.push(link);

  for (const block of draft.corpo) {
    const mapped = bodyBlock(block);
    if (mapped) blocks.push(mapped);
  }

  blocks.push(...noTralkedBlocks(draft.noTralked, opts.insights));

  const pergunta = plainText(draft.pergunta, LIMITS.paragraph - 2);
  if (pergunta) blocks.push(paragraph(`*${pergunta}*`));

  // Sources close the article: keep them even if the body had to be cut to the block limit.
  const fontes = sourceBlocks(story.sources);
  const body = blocks.slice(0, LIMITS.blocks - fontes.length);

  const allowed = new Set((story.candidates ?? [...opts.insights.keys()].map((slug) => ({ slug }))).map((c) => c.slug));
  const games = [...new Set(draft.games.map((g) => g.trim()))].filter((slug) => allowed.has(slug)).slice(0, LIMITS.games);
  const platforms = [...new Set(draft.platforms)].filter((p): p is ArticlePlatform =>
    (ARTICLE_PLATFORMS as readonly string[]).includes(p),
  );

  const payload: ArticlePayload = {
    title: plainText(draft.title, LIMITS.title),
    category: draft.category,
    platforms,
    games: games.map((slug) => ({ slug })),
    blocks: [...body, ...fontes],
    status: "published",
  };
  const subtitle = plainText(draft.subtitle, LIMITS.subtitle);
  if (subtitle) payload.subtitle = subtitle;
  const excerpt = plainText(draft.excerpt, LIMITS.excerpt);
  if (excerpt) payload.excerpt = excerpt;
  const imageLabel = plainText(draft.imageLabel, LIMITS.imageLabel);
  if (imageLabel) payload.imageLabel = imageLabel;
  return payload;
}

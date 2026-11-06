import type { Draft, DraftBlock } from "./ai/writer.js";
import {
  ARTICLE_PLATFORMS,
  type ArticleCategory,
  type ArticlePayload,
  type ArticlePlatform,
  type ContentBlock,
  type Insights,
} from "./tralked.js";
import type { XPost } from "./media/xposts.js";
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
  imageAlt: 300,
  imageCredit: 200,
  imageUrl: 2048,
  videoTitle: 200,
  postAuthor: 120,
  postText: 1000,
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

/** A link to X: posts are embedded by code (`post` blocks), never linked by the model. */
const X_TARGET = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\//i;
const BARE_X_URL = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/\S*/gi;

/** Text with inline markup: no HTML, no script schemes, links only to https and never to X. */
function inline(text: string): string {
  const cleaned = stripHtml(text.replace(CONTROL_CHARS, ""))
    .replace(INLINE_LINK, (match, label: string, target: string) => (isHttps(target) && !X_TARGET.test(target) ? match : label))
    .replace(BARE_X_URL, "")
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

/** An image hosted by the site, with its credit and, for outside material, a link to where it came from. */
export type MediaImage = { url: string; alt: string; credit: string; creditUrl?: string };

/**
 * Media added by code, never by the model (src/media/ picks it):
 * - `cover`: the article's main image, right after the lede; the first image block is the site's card;
 * - `video`: the story's own official video, after the cover;
 * - `bodyImage`: a second image (a catalog scene of the exact game), after the 3rd block of the body;
 * - `trailer`: the game's video from the catalog, after the body, only when there is no `video`.
 */
export type ArticleMedia = {
  video?: { youtubeId: string; title: string };
  cover?: MediaImage;
  bodyImage?: MediaImage;
  trailer?: { youtubeId: string; title: string };
  /** Official X posts of the story: each after the first body paragraph that quotes its author. */
  posts?: XPost[];
};

/** A post on X as the site takes it (app/src/lib/content/schema.ts `postBlockSchema`). */
const X_POST_URL = /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{1,25}$/;
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;

function postBlock(post: XPost): ContentBlock | null {
  const url = post.url.trim();
  if (!X_POST_URL.test(url) || !X_HANDLE.test(post.authorHandle)) return null;
  const authorName = plainText(post.authorName, LIMITS.postAuthor);
  const text = plainText(post.text, LIMITS.postText);
  if (!authorName || !text) return null;
  const postedAt = post.postedAt && Number.isFinite(Date.parse(post.postedAt)) ? new Date(post.postedAt).toISOString() : undefined;
  return { type: "post", network: "x", url, authorName, authorHandle: post.authorHandle, text, ...(postedAt ? { postedAt } : {}) };
}

/** Whether a body block quotes the post's author (by name or @handle). */
function quotes(block: ContentBlock, post: XPost): boolean {
  if (block.type !== "paragraph" && block.type !== "quote" && block.type !== "list") return false;
  const text = (block.type === "list" ? block.items.join(" ") : block.text).toLowerCase();
  return text.includes(post.authorName.toLowerCase()) || text.includes(`@${post.authorHandle.toLowerCase()}`);
}

export type AssembleOpts = {
  insights: Map<string, Insights>;
  updatedAt?: Date;
  /** Follow-ups: the earlier article of the case, linked before the body (https only). */
  parent?: { title: string; url: string };
  media?: ArticleMedia;
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/** The body image goes after this many body blocks (the lede counts). */
const BODY_IMAGE_AFTER = 3;

function videoBlock(video: { youtubeId: string; title: string } | undefined): ContentBlock[] {
  if (!video || !YOUTUBE_ID.test(video.youtubeId)) return [];
  const title = plainText(video.title, LIMITS.videoTitle);
  return [title ? { type: "video", youtubeId: video.youtubeId, title } : { type: "video", youtubeId: video.youtubeId }];
}

function imageBlock(image: MediaImage | undefined): ContentBlock[] {
  if (!image) return [];
  const url = image.url.trim();
  if (!isHttps(url) || /[\s()<>"]/.test(url) || url.length > LIMITS.imageUrl) return [];
  const alt = plainText(image.alt, LIMITS.imageAlt);
  const credit = plainText(image.credit, LIMITS.imageCredit);
  if (!alt || !credit) return [];
  const creditUrl = image.creditUrl?.trim();
  const linked = creditUrl && isHttps(creditUrl) && !/[\s<>"]/.test(creditUrl) && creditUrl.length <= LIMITS.imageUrl;
  return [linked ? { type: "image", url, alt, credit, creditUrl } : { type: "image", url, alt, credit }];
}

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

  const corpo = draft.corpo.flatMap((block) => {
    const mapped = bodyBlock(block);
    return mapped ? [mapped] : [];
  });
  const media = opts.media ?? {};
  const own = videoBlock(media.video);
  const cover = imageBlock(media.cover);
  const second = media.bodyImage && media.bodyImage.url.trim() !== media.cover?.url.trim() ? imageBlock(media.bodyImage) : [];
  const afterBody = own.length > 0 ? [] : videoBlock(media.trailer);

  // What goes after each body block: the cover and the video after the lede, the body image after the
  // 3rd block, each post after the first block that quotes its author (else with the lede's media).
  const after = new Map<number, ContentBlock[]>();
  const put = (i: number, b: ContentBlock[]) => after.set(i, [...(after.get(i) ?? []), ...b]);
  put(0, [...cover, ...own]);
  if (second.length > 0) put(Math.min(BODY_IMAGE_AFTER, corpo.length) - 1, second);
  const seenPosts = new Set<string>();
  for (const post of media.posts ?? []) {
    const block = postBlock(post);
    if (!block || seenPosts.has(post.url)) continue;
    seenPosts.add(post.url);
    put(Math.max(0, corpo.findIndex((b) => quotes(b, post))), [block]);
  }
  if (corpo.length === 0) blocks.push(...(after.get(0) ?? []));
  corpo.forEach((b, i) => blocks.push(b, ...(after.get(i) ?? [])));
  blocks.push(...afterBody);

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

import { parseHTML } from "linkedom";

/**
 * The text of a guide page, for the extraction. Unlike the news robot's `extractText` (Readability + paragraphs,
 * capped at 20,000 chars) it keeps the whole page body in document order: tables one line per row with the cells
 * joined by " | " (header row included), list items, headings and the plain div/span text blocks that guides
 * (Steam community, wikis) are made of. Site chrome is dropped: nav, header menus, footer, aside, scripts, form
 * controls, cookie banners, comments, share bars.
 *
 * `PAGE_TEXT_VERSION` is stored with each cached page: a page cached by an older extractor gets its text
 * recomputed from the stored HTML (no new fetch).
 */

export const PAGE_TEXT_VERSION = 3;
/** Upper bound of a page's text. `extractFacts` splits it into 60,000-char parts. */
export const PAGE_TEXT_MAX = 400_000;

type Doc = ReturnType<typeof parseHTML>["document"];
type El = NonNullable<ReturnType<Doc["querySelector"]>>;
type N = El["childNodes"][number];

const DROP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "IFRAME", "NAV", "FOOTER", "ASIDE", "BUTTON", "SELECT",
  "TEXTAREA", "INPUT", "OPTION", "DATALIST", "CANVAS", "VIDEO", "AUDIO", "OBJECT", "EMBED", "DIALOG", "HEAD", "LINK", "META",
]);
// <form> itself is kept: ASP.NET sites wrap the whole page in one. Only its controls (above) are dropped.

/**
 * Words of site chrome. A class name or id is chrome when its first or last word is one of these
 * ("entry-comments", "breadcrumb", "commentthread_area", "cookieConsent"); a wrapper that only mentions one in the
 * middle ("content-sidebar-wrap") is not. Never applied to <html>/<body>, whose classes describe the whole page.
 */
const NOISE_WORDS = new Set([
  "cookie", "cookies", "consent", "gdpr", "cmp", "onetrust", "sidebar", "breadcrumb", "breadcrumbs", "share",
  "sharing", "social", "related", "newsletter", "comment", "comments", "commentthread", "advert", "advertisement",
  "ads", "ad", "adsbygoogle", "popup", "navbar", "menu", "menubar", "footer", "subscribe",
]);

const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "BLOCKQUOTE", "CENTER", "DD", "DETAILS", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FORM", "LABEL",
  "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "OL", "P", "PRE", "SECTION",
  "SUMMARY", "UL", "TR", "TBODY", "THEAD", "TFOOT", "CAPTION",
]);

/** "nc_socialPanel" -> ["nc", "social", "panel"]. */
const wordsOf = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);

function chromeName(name: string): boolean {
  const w = wordsOf(name);
  return w.length > 0 && (NOISE_WORDS.has(w[0]!) || NOISE_WORDS.has(w[w.length - 1]!));
}

function isNoise(el: El): boolean {
  if (DROP_TAGS.has(el.tagName)) return true;
  if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return true;
  if (/display\s*:\s*none/i.test(el.getAttribute("style") ?? "")) return true;
  const role = el.getAttribute("role");
  if (role === "navigation" || role === "banner" || role === "contentinfo" || role === "complementary") return true;
  // A page-level <header> is site chrome; an article's own header (title, byline) is content.
  if (el.tagName === "HEADER" && !el.closest("article, main")) return true;
  if (el.tagName === "BODY" || el.tagName === "HTML") return false;
  const names = [...(el.getAttribute("class") ?? "").split(/\s+/), el.getAttribute("id") ?? ""].filter(Boolean);
  return names.some(chromeName);
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

class Lines {
  readonly out: string[] = [];
  private buf = "";
  private prefix = "";
  text(t: string) {
    this.buf += t;
  }
  /** Ends the current line; an empty line keeps the pending prefix (an <li> whose text sits in a nested <p>). */
  flush() {
    const t = clean(this.buf);
    this.buf = "";
    if (!t) return;
    this.push(this.prefix + t);
    this.prefix = "";
  }
  push(line: string) {
    if (this.out[this.out.length - 1] !== line) this.out.push(line);
  }
  setPrefix(p: string) {
    this.prefix = p;
  }
}

/** Text of an image that stands for a word (a trophy grade icon with a title, say). Smileys (":bronze:") skipped. */
function imageWord(el: El): string {
  const word = clean(el.getAttribute("title") || el.getAttribute("alt") || "");
  return /^:.*:$/.test(word) ? "" : word;
}

function cellText(cell: El): string {
  const lines = new Lines();
  walk(cell, lines);
  lines.flush();
  const text = lines.out.join(" / ");
  if (text) return text;
  return [...cell.querySelectorAll("img")].map(imageWord).filter(Boolean).join(" ");
}

const isDivRow = (el: El) =>
  el.getAttribute("role") === "row" || (el.getAttribute("class") ?? "").split(/\s+/).includes("bb_table_tr");

function tableLines(table: El): string[] {
  const rows = [...table.querySelectorAll("tr")].filter((tr) => tr.closest("table") === table);
  const out: string[] = [];
  for (const tr of rows) {
    const cells = [...tr.children].filter((c) => c.tagName === "TD" || c.tagName === "TH").map(cellText);
    if (cells.some(Boolean)) out.push(cells.join(" | "));
  }
  const caption = [...table.children].find((c) => c.tagName === "CAPTION");
  return caption && clean(caption.textContent ?? "") ? [clean(caption.textContent ?? ""), ...out] : out;
}

function walk(node: El, lines: Lines): void {
  for (const child of [...node.childNodes] as N[]) {
    if (child.nodeType === 3) {
      lines.text(child.textContent ?? "");
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as El;
    if (isNoise(el)) continue;
    const tag = el.tagName;
    if (tag === "BR") {
      lines.flush();
      continue;
    }
    if (tag === "TABLE") {
      lines.flush();
      for (const row of tableLines(el)) lines.push(row);
      continue;
    }
    if (isDivRow(el)) {
      // Tables made of divs (Steam's BBCode [table], ARIA grids): one line per row too.
      lines.flush();
      const cells = [...el.children].filter((c) => !isNoise(c)).map(cellText);
      if (cells.some(Boolean)) lines.push(cells.join(" | "));
      continue;
    }
    if (!BLOCK_TAGS.has(tag)) {
      walk(el, lines);
      continue;
    }
    lines.flush();
    const heading = /^H([1-6])$/.exec(tag) ?? /(?:^|\s)bb_h([1-6])(?:\s|$)/.exec(el.getAttribute("class") ?? "");
    if (heading) lines.setPrefix(`${"#".repeat(Number(heading[1]))} `);
    else if (tag === "LI") lines.setPrefix("- ");
    walk(el, lines);
    lines.flush();
    lines.setPrefix("");
  }
}

export type PageText = { text: string; truncated: boolean };

/** The page's text, in document order, one block per line. Empty when the HTML has no body text. */
export function pageText(html: string): PageText {
  if (!html.trim()) return { text: "", truncated: false };
  // linkedom only builds a body from a whole document: wrap a fragment.
  const { document } = parseHTML(/<html[\s>]/i.test(html) ? html : `<!DOCTYPE html><html><body>${html}</body></html>`);
  const root = (document.body ?? document.documentElement) as El | null;
  if (!root) return { text: "", truncated: false };
  const lines = new Lines();
  walk(root, lines);
  lines.flush();
  const title = clean(document.querySelector("title")?.textContent ?? "");
  const body = lines.out.join("\n");
  // The page title often carries the author's claim ("all 66 achievements", "全成就"): keep it when the body lacks it.
  const full = title && !body.includes(title) ? `# ${title}\n${body}` : body;
  if (full.length <= PAGE_TEXT_MAX) return { text: full, truncated: false };
  const cut = full.lastIndexOf("\n", PAGE_TEXT_MAX);
  return { text: full.slice(0, cut > PAGE_TEXT_MAX * 0.9 ? cut : PAGE_TEXT_MAX), truncated: true };
}

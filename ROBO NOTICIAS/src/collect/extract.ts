import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { parseDate } from "./text.js";

export const TEXT_MAX = 20_000;

type Doc = ReturnType<typeof parseHTML>["document"];

const BLOCKS = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figcaption";

function metaContent(document: Doc, selectors: string[]): string | null {
  for (const sel of selectors) {
    const v = document.querySelector(sel)?.getAttribute("content")?.trim();
    if (v) return v;
  }
  return null;
}

function findDatePublished(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findDatePublished(n);
      if (f) return f;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o["datePublished"] === "string") return o["datePublished"];
    for (const v of Object.values(o)) {
      const f = findDatePublished(v);
      if (f) return f;
    }
  }
  return null;
}

function publishedAtOf(document: Doc): Date | null {
  const meta = metaContent(document, [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[property="og:article:published_time"]',
  ]);
  const fromMeta = parseDate(meta);
  if (fromMeta) return fromMeta;

  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const found = findDatePublished(JSON.parse(script.textContent ?? ""));
      const d = parseDate(found);
      if (d) return d;
    } catch {
      // malformed JSON-LD: try the next block
    }
  }
  return parseDate(metaContent(document, ['meta[itemprop="datePublished"]', 'meta[name="date"]']));
}

function blocksToText(contentHtml: string): string {
  const { document } = parseHTML(`<div id="root">${contentHtml}</div>`);
  const root = document.querySelector("#root");
  const parts: string[] = [];
  for (const el of Array.from(root?.querySelectorAll(BLOCKS) ?? [])) {
    if (el.querySelector(BLOCKS)) continue; // its inner blocks carry the text
    const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (t) parts.push(t);
  }
  if (parts.length) return parts.join("\n\n");
  return (root?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Extracts the main article text from an HTML page using Readability over a linkedom document.
 * Returns null when no readable content is found. Text is capped at 20,000 chars.
 */
export function extractText(
  html: string,
  url: string,
): { title: string | null; text: string; publishedAt: Date | null } | null {
  if (!html.trim()) return null;
  try {
    const { document } = parseHTML(html);
    // Read metadata first: Readability mutates the document.
    const publishedAt = publishedAtOf(document);
    const ogTitle = metaContent(document, ['meta[property="og:title"]', 'meta[name="twitter:title"]']);

    Object.defineProperty(document, "documentURI", { value: url, configurable: true });
    const article = new Readability(document as unknown as Document, { keepClasses: false }).parse();
    if (!article?.content) return null;

    const text = blocksToText(article.content).slice(0, TEXT_MAX).trim();
    if (!text) return null;
    const title = (ogTitle ?? article.title ?? "").replace(/\s+/g, " ").trim() || null;
    return { title, text, publishedAt };
  } catch {
    return null;
  }
}

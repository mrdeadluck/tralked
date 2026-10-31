import { z } from "zod";

/** Comment and forum post limits (characters, after trimming). */
export const BODY_MIN = 1;
export const BODY_MAX = 2000;
export const TITLE_MIN = 5;
export const TITLE_MAX = 120;
export const CAPTION_MAX = 300;

// Anything that looks like an HTML tag, comment or doctype: `<b>`, `</p>`, `<!-- -->`, `<!doctype`.
// A lone "<" (e.g. "nível < 5", "<3") is fine.
const HTML_LIKE = /<\s*[a-z!/?][^>]*>/i;

export const HTML_MESSAGE = "HTML não é permitido. Escreva só o texto.";

/** True when the text contains markup that looks like HTML. */
export function containsHtml(text: string): boolean {
  return HTML_LIKE.test(text);
}

/** Normalizes line endings, trims, and keeps at most two consecutive blank lines. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plain user text (no HTML) between `min` and `max` characters after normalization. */
export function plainText(min: number, max: number, label: string) {
  return z
    .string()
    .transform(normalizeText)
    .pipe(
      z
        .string()
        .min(min, min <= 1 ? `${label} não pode ficar vazio.` : `${label} precisa de pelo menos ${min} caracteres.`)
        .max(max, `${label} pode ter no máximo ${max.toLocaleString("pt-BR")} caracteres.`)
        .refine((value) => !containsHtml(value), HTML_MESSAGE),
    );
}

export const commentBodySchema = plainText(BODY_MIN, BODY_MAX, "O comentário");
export const postBodySchema = plainText(BODY_MIN, BODY_MAX, "A resposta");
export const threadTitleSchema = plainText(TITLE_MIN, TITLE_MAX, "O título");
export const captionSchema = z
  .string()
  .transform(normalizeText)
  .pipe(z.string().max(CAPTION_MAX, `A legenda pode ter no máximo ${CAPTION_MAX} caracteres.`))
  .refine((value) => !containsHtml(value), HTML_MESSAGE);

export type TextSegment = { kind: "text"; text: string } | { kind: "link"; text: string; href: string };

// http(s) URLs only; trailing punctuation is left out of the link.
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/**
 * Splits plain user text into text and link segments. Only `http:`/`https:` URLs become links,
 * so `javascript:` and other schemes stay as text. The caller renders segments as React text
 * nodes and `<a>` elements: user text is never turned into HTML.
 */
export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const trailing = raw.match(TRAILING_PUNCTUATION)?.[0] ?? "";
    const candidate = raw.slice(0, raw.length - trailing.length);
    let href: string | null = null;
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") href = url.href;
    } catch {
      href = null;
    }
    if (!href) continue;
    const start = match.index;
    if (start > last) segments.push({ kind: "text", text: text.slice(last, start) });
    segments.push({ kind: "link", text: candidate, href });
    last = start + candidate.length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

/** URL slug for a thread title: "Ritual ou Banishment?" -> "ritual-ou-banishment". */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "topico";
}

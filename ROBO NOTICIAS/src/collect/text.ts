import { parseHTML } from "linkedom";

export const SUMMARY_MAX = 500;

function textOf(fragment: string): string {
  const { document } = parseHTML(`<div>${fragment}</div>`);
  return document.querySelector("div")?.textContent ?? "";
}

/** Decodes HTML entities in plain text (feed titles often carry `&#8217;` or a double-escaped `&amp;`). Tags are left alone. */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s.replace(/\s+/g, " ").trim();
  return textOf(s.replace(/</g, "&lt;")).replace(/\s+/g, " ").trim();
}

/** Turns an HTML fragment into collapsed plain text. */
export function stripHtml(html: string): string {
  const spaced = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(p|br|div|li|ul|ol|h[1-6]|tr|td|blockquote|figure|figcaption)\b[^>]*>/gi, " ");
  return textOf(spaced).replace(/\s+/g, " ").trim();
}

export function makeSummary(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = stripHtml(html);
  if (!text) return null;
  return text.slice(0, SUMMARY_MAX).trimEnd();
}

export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "…/2026/10/the-last-of-us_part-3/" -> "The last of us part 3". */
export function titleFromUrl(url: string): string {
  let segment = "";
  let host = url;
  try {
    const u = new URL(url);
    host = u.hostname;
    const parts = u.pathname.split("/").filter(Boolean);
    segment = parts[parts.length - 1] ?? "";
  } catch {
    segment = url;
  }
  try {
    segment = decodeURIComponent(segment);
  } catch {
    // keep the raw segment
  }
  const words = segment
    .replace(/\.(html?|php|aspx?|xml)$/i, "")
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return host;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Lowercase alphanumerics only, used to compare titles across sources. */
export function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function isHttpUrl(s: string): boolean {
  if (!URL.canParse(s)) return false;
  const p = new URL(s).protocol;
  return p === "http:" || p === "https:";
}

/**
 * URL guards shared by the content schema, the news queries and the client components
 * (kept free of zod so client bundles stay small).
 */

/** Absolute http(s) URL. Rejects javascript:, data:, protocol-relative ("//host") and relative URLs. */
export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Same-site path ("/noticias/x"); "//host" (protocol-relative) is not one. */
export function isSiteRelativePath(value: string): boolean {
  return /^\/(?![/\\])/.test(value);
}

/**
 * Image URL safe for an <img> (catalog covers): https, or a same-site path. Control characters,
 * spaces and backslashes are refused (browsers rewrite them), like game-profile's safeMediaUrl.
 */
export function safeImageUrl(url: string | null | undefined): string | null {
  if (!url || /[\x00-\x20\x7f\\]/.test(url)) return null;
  if (url.startsWith("/")) return url[1] === "/" ? null : url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Href safe to render: http(s) for external links, a same-site path otherwise. */
export function isSafeHref(href: string, external: boolean | undefined): boolean {
  return external ? isSafeHttpUrl(href) : isSiteRelativePath(href);
}

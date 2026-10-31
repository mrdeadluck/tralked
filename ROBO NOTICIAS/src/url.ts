import { createHash } from "node:crypto";

const TRACKING_PARAMS = new Set(["fbclid", "gclid"]);

/** Canonical form of a URL used for de-duplication. Falls back to the trimmed input if unparseable. */
export function normalizeUrl(u: string): string {
  let url: URL;
  try {
    url = new URL(u.trim());
  } catch {
    return u.trim();
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  // URL already lowercases the host.
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

/** sha256 of the lowercased text with whitespace collapsed. */
export function contentHash(text: string): string {
  const canon = text.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(canon).digest("hex");
}

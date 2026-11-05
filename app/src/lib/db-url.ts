/**
 * pg (pg-connection-string 2.x) treats sslmode prefer, require and verify-ca as verify-full, and
 * warns about it on every new process ("SECURITY WARNING: The SSL modes ... are treated as aliases
 * for 'verify-full'": 1,631 log lines in four days, 2026-11). Neon's URLs carry
 * `sslmode=require`. Spelling out the mode pg already uses keeps the behavior and drops the warning.
 * A URL that opted into libpq semantics (`uselibpqcompat`) or names no mode is left as it is.
 */
export function explicitSslMode(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const mode = parsed.searchParams.get("sslmode");
  if (!mode || !["prefer", "require", "verify-ca"].includes(mode) || parsed.searchParams.has("uselibpqcompat")) {
    return url;
  }
  parsed.searchParams.set("sslmode", "verify-full");
  return parsed.toString();
}

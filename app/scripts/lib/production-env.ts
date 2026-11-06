/**
 * CRON_SECRET and APP_URL of the production site, read from an env file (`KEY=value` lines, quotes
 * optional) for scripts that call a protected route of the live site. Values are never printed.
 * Refuses an APP_URL that is not an https address of a public host (a dev URL left in the file).
 */
export function productionTarget(text: string): { CRON_SECRET: string; APP_URL: string } {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  if (!env.CRON_SECRET) throw new Error("CRON_SECRET is missing from the production env file.");
  const appUrl = env.APP_URL || "https://tralked.com";
  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    throw new Error("APP_URL of the production env file is not a URL.");
  }
  const host = url.hostname;
  const local = host === "localhost" || host.endsWith(".local") || /^(?:127\.|10\.|192\.168\.|0\.0\.0\.0$|\[?::1\]?$)/.test(host);
  if (url.protocol !== "https:" || local) throw new Error("APP_URL of the production env file is not the production site (https, public host).");
  return { CRON_SECRET: env.CRON_SECRET, APP_URL: url.origin };
}

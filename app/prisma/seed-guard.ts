/**
 * The seed writes fictional players, articles, forum threads, photos and example.com headlines.
 * In November 2026 that data reached production (Neon) and had to be purged by hand. The seed now
 * refuses any database that is not on this machine, unless SEED_ALLOW_REMOTE=1 is set on purpose.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function seedTargetError(url: string | undefined, allowRemote: string | undefined): string | null {
  if (!url) return null; // the app falls back to the local development database (src/lib/env.ts)
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "DATABASE_URL is not a valid URL.";
  }
  if (LOCAL_HOSTS.has(host) || allowRemote === "1") return null;
  return `Refusing to seed ${host}: the seed writes fictional data and is for local databases only. Set SEED_ALLOW_REMOTE=1 to override.`;
}

const error = seedTargetError(process.env.DATABASE_URL?.trim(), process.env.SEED_ALLOW_REMOTE);
if (error) throw new Error(error);

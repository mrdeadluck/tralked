import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Progress logs of the scripts (gitignored). */
export const LOG_DIR = fileURLToPath(new URL("../.logs/", import.meta.url));

/**
 * The database a script writes to must be named explicitly: scripts never fall back to the app's
 * default URL, and never touch `gamelog` (the old local database kept as is).
 */
export function requireDatabaseUrl(): { url: string; name: string } {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("Set DATABASE_URL explicitly (e.g. postgresql://gamelog:gamelog@localhost:5433/gamelog_dev).");
    process.exit(2);
  }
  const name = new URL(url).pathname.replace(/^\//, "");
  if (name === "gamelog") {
    console.error("Refusing to write to the `gamelog` database. Use your own (gamelog_dev, gamelog_<task>).");
    process.exit(2);
  }
  return { url, name };
}

export type RunLog = {
  file: string;
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
};

/** Logs to the console and to `scripts/.logs/<name>-<timestamp>.log`. */
export function createRunLog(name: string): RunLog {
  mkdirSync(LOG_DIR, { recursive: true });
  const file = `${LOG_DIR}${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
  const write = (level: string, message: string) => {
    const line = `${new Date().toISOString()} ${level} ${message}`;
    appendFileSync(file, `${line}\n`);
    return line;
  };
  return {
    file,
    info: (message) => console.log(write("INFO", message)),
    warn: (message) => console.warn(write("WARN", message)),
    error: (message, error) => {
      const detail = error instanceof Error ? `: ${error.message}` : error ? `: ${String(error)}` : "";
      console.error(write("ERROR", `${message}${detail}`));
    },
  };
}

/** Runs `worker` over `items` with at most `limit` in flight; takes no new item once `stop()` is true. */
export async function forEachLimited<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  stop: () => boolean = () => false,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !stop()) {
        const index = next++;
        await worker(items[index], index);
      }
    }),
  );
}

export const formatDuration = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
};

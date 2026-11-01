import { randomUUID } from "node:crypto";
import { readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";

/** A lock older than this belongs to a crashed run and may be taken over. */
export const LOCK_STALE_MS = 30 * 60 * 1000;

export type Lock = { release(): void };

type Held = { pid: number; at: string; token: string };

function isStale(path: string, now: Date, staleMs: number): boolean {
  try {
    const held = JSON.parse(readFileSync(path, "utf8")) as Partial<Held>;
    const at = Date.parse(held.at ?? "");
    if (!Number.isNaN(at)) return now.getTime() - at > staleMs;
  } catch {
    // Unreadable or half-written: judge by the file's age instead.
  }
  try {
    return now.getTime() - statSync(path).mtimeMs > staleMs;
  } catch {
    return true; // gone already
  }
}

/**
 * Takes the lock file (created exclusively, holding the pid and the time) or returns null when another
 * live run holds it. A lock older than `staleMs` is removed and taken over. `release` only removes the
 * file while it is still ours.
 */
export function acquireLock(path: string, now: Date, staleMs = LOCK_STALE_MS): Lock | null {
  const token = randomUUID();
  const content = JSON.stringify({ pid: process.pid, at: now.toISOString(), token } satisfies Held);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, content, { flag: "wx" });
      return {
        release: () => {
          try {
            if ((JSON.parse(readFileSync(path, "utf8")) as Held).token === token) unlinkSync(path);
          } catch {
            // already removed or replaced
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!isStale(path, now, staleMs)) return null;
      try {
        unlinkSync(path);
      } catch {
        // someone else removed it first; retry the exclusive create
      }
    }
  }
  return null;
}

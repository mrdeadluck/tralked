import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Storage } from "./index";

const PUBLIC_PREFIX = "/uploads/";
const SAFE_KEY = /^[a-z0-9][a-z0-9/_-]*\.webp$/i;

/**
 * Development adapter: writes to `<root>/public/uploads/<key>` and serves it as `/uploads/<key>`.
 * `next dev` serves new files in `public/` right away; a production build only serves files that
 * existed at build time, so production uses the Blob adapter.
 */
export function localStorage(root: string = process.cwd()): Storage {
  const uploadsDir = path.join(root, "public", "uploads");

  function fileFor(key: string): string {
    if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error(`Unsafe storage key: ${key}`);
    return path.join(uploadsDir, ...key.split("/"));
  }

  return {
    name: "local",
    async put(key, data) {
      const file = fileFor(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data, { flag: "wx" });
      return { url: `${PUBLIC_PREFIX}${key}` };
    },
    async remove(url) {
      if (!url.startsWith(PUBLIC_PREFIX)) return;
      await rm(fileFor(url.slice(PUBLIC_PREFIX.length)), { force: true });
    },
  };
}

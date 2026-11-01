import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** True when the module at `metaUrl` is the script being run (not imported, e.g. by a test). */
export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const norm = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  return norm(fileURLToPath(metaUrl)) === norm(entry);
}

/** Runs `main` when the module is the entry script; a failure prints the error and sets the exit code. */
export function runIfMain(metaUrl: string, main: () => Promise<void>): void {
  if (!isMain(metaUrl)) return;
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

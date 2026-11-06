/**
 * Read-only report of catalog games that may be one game stored twice (lib/catalog/duplicates.ts).
 *
 *   DATABASE_URL=postgresql://... pnpm games:duplicates [--out <dir>]
 *
 * Writes `duplicados-<date>.json` and `duplicados-<date>.md` to `docs/relatorios/` at the
 * repository root (or `--out`). The database session is opened read-only and checked
 * (SHOW default_transaction_read_only) before any query; nothing is written to the database.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertReadOnly, readOnlyUrl } from "./lib/read-only";
import { createRunLog, formatDuration, requireDatabaseUrl } from "./lib/run";

const db = requireDatabaseUrl();
process.env.DATABASE_URL = readOnlyUrl(db.url);
const log = createRunLog("games-duplicates");

// Imported after the URL is made read-only: the Prisma client reads it on import.
const { prisma } = await import("@/lib/db");
const { findDuplicateCandidates, renderMarkdown } = await import("@/lib/catalog/duplicates");

const outFlag = process.argv.indexOf("--out");
const outDir = outFlag >= 0 && process.argv[outFlag + 1]
  ? resolve(process.argv[outFlag + 1])
  : fileURLToPath(new URL("../../docs/relatorios/", import.meta.url));

const started = Date.now();
let exitCode = 0;
try {
  await assertReadOnly(async () => {
    const rows = await prisma.$queryRaw<{ default_transaction_read_only: string }[]>`SHOW default_transaction_read_only`;
    return rows[0]?.default_transaction_read_only;
  });
  log.info(`Database session is read-only (default_transaction_read_only = on). Database "${db.name}". Log: ${log.file}`);

  const groups = await findDuplicateCandidates();
  const date = new Date().toISOString().slice(0, 10);
  const summary: Record<string, number> = {};
  for (const g of groups) summary[g.verdict] = (summary[g.verdict] ?? 0) + 1;

  mkdirSync(outDir, { recursive: true });
  const jsonFile = join(outDir, `duplicados-${date}.json`);
  const mdFile = join(outDir, `duplicados-${date}.md`);
  // One group per line: the file is large and a line-based diff stays readable.
  const lines = groups.map((g) => JSON.stringify(g)).join(",\n");
  writeFileSync(jsonFile, `{"date":${JSON.stringify(date)},"summary":${JSON.stringify(summary)},"groups":[\n${lines}\n]}\n`);
  writeFileSync(mdFile, renderMarkdown(groups, date));
  log.info(`${groups.length} candidate groups: ${JSON.stringify(summary)}`);
  log.info(`Wrote ${jsonFile} and ${mdFile}. Nothing written to the database. Done in ${formatDuration(Date.now() - started)}.`);
} catch (error) {
  log.error("The duplicates report stopped", error);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);

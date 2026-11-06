/**
 * Read-only report of catalog games that may be one game stored twice (lib/catalog/duplicates.ts).
 *
 *   DATABASE_URL=postgresql://... pnpm games:duplicates [--out <dir>]
 *
 * Writes `duplicados-<date>.json` (the groups that move something) and `duplicados-<date>.md` to
 * `docs/relatorios/` at the repository root (or `--out`), and the full `duplicados-<date>-completo.json`
 * to ~/tralked-backups (or `--out`, or `--full-out`). The database session is opened read-only and checked
 * (SHOW default_transaction_read_only) before any query; nothing is written to the database.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertReadOnly, readOnlyUrl } from "./lib/read-only";
import { createRunLog, formatDuration, requireDatabaseUrl } from "./lib/run";

const db = requireDatabaseUrl();
process.env.DATABASE_URL = readOnlyUrl(db.url);
const log = createRunLog("games-duplicates");

// Imported after the URL is made read-only: the Prisma client reads it on import.
const { prisma } = await import("@/lib/db");
const { findDuplicateCandidates, hasContent, renderMarkdown } = await import("@/lib/catalog/duplicates");

const outFlag = process.argv.indexOf("--out");
const outDir = outFlag >= 0 && process.argv[outFlag + 1]
  ? resolve(process.argv[outFlag + 1])
  : fileURLToPath(new URL("../../docs/relatorios/", import.meta.url));

// The full JSON is big: it goes outside the repository (the backups folder) unless --out is given.
const fullFlag = process.argv.indexOf("--full-out");
const fullDir = fullFlag >= 0 && process.argv[fullFlag + 1]
  ? resolve(process.argv[fullFlag + 1])
  : outFlag >= 0 ? outDir : join(homedir(), "tralked-backups");

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
  mkdirSync(fullDir, { recursive: true });
  const jsonFile = join(outDir, `duplicados-${date}.json`);
  const mdFile = join(outDir, `duplicados-${date}.md`);
  const fullFile = join(fullDir, `duplicados-${date}-completo.json`);
  // One group per line: the files are large and a line-based diff stays readable.
  const write = (file: string, list: typeof groups, extra: Record<string, unknown>) => {
    const lines = list.map((g) => JSON.stringify(g)).join(",\n");
    writeFileSync(file, `{"date":${JSON.stringify(date)},"summary":${JSON.stringify(summary)},${Object.entries(extra).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)},`).join("")}"groups":[
${lines}
]}
`);
  };
  // The repository gets the groups that move something and every other-edition group; the .md lists the rest.
  const heavy = groups.filter((g) => hasContent(g) || g.verdict === "outra-edicao");
  write(fullFile, groups, { slice: "completo" });
  write(jsonFile, heavy, { slice: "grupos com conteúdo para mover e todos os de outra edição", omitted: groups.length - heavy.length });
  writeFileSync(mdFile, renderMarkdown(groups, date));
  const multiDrop = groups.filter((g) => g.dropGroups > 1).length;
  const chains = groups.filter((g) => g.keepIsDropIn > 0).length;
  log.info(`groups whose drop is in 2+ groups: ${multiDrop}; groups whose keep is a drop elsewhere: ${chains}`);
  log.info(`${groups.length} candidate groups: ${JSON.stringify(summary)}`);
  log.info(`Wrote ${jsonFile} (${heavy.length} groups), ${mdFile} and the full ${fullFile}. Nothing written to the database. Done in ${formatDuration(Date.now() - started)}.`);
} catch (error) {
  log.error("The duplicates report stopped", error);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);

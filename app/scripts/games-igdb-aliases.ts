/**
 * Writes the IGDB aliases (GameIgdbAlias) of the duplicates joined on 2026-11-06, before
 * mergeGames kept them: each drop's IGDB id leads to the game that stayed, so the IGDB imports
 * (igdb-catalog, releases) never create the dropped game again (lib/catalog/igdb-aliases.ts).
 *
 *   DATABASE_URL=... pnpm games:igdb-aliases --dry-run
 *   DATABASE_URL=... pnpm games:igdb-aliases
 *
 * Inputs (defaults in brackets):
 *   --approved  the approved joins [docs/relatorios/duplicados-2026-11-06-aprovado.json]
 *   --report    the duplicates report the approval came from, the one file with the drops'
 *               IGDB ids [docs/relatorios/duplicados-2026-11-06.json]
 *   --record    the record of the production run: only joins that ran are taken
 *               [C:\Users\luck_\tralked-backups\merge-prod-20261106\games-merge-2026-11-06T08-10-24-201Z.json];
 *               `--record none` takes every approved join.
 * Approved joins missing from the report or the record are printed and left out.
 *
 * `--dry-run` only reads: the session is opened read-only (default_transaction_read_only=on,
 * checked before anything), and it also runs before the GameIgdbAlias migration is deployed.
 * Idempotent: an alias already there is counted, never written twice; an IGDB id another game
 * holds is printed as a conflict and left alone.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { assertReadOnly, readOnlyUrl } from "./lib/read-only";
import { createRunLog, formatDuration, requireDatabaseUrl } from "./lib/run";

const REPORTS = fileURLToPath(new URL("../../docs/relatorios/", import.meta.url));
const PROD_RECORD = "C:\\Users\\luck_\\tralked-backups\\merge-prod-20261106\\games-merge-2026-11-06T08-10-24-201Z.json";

const { values } = parseArgs({
  options: {
    approved: { type: "string", default: `${REPORTS}duplicados-2026-11-06-aprovado.json` },
    report: { type: "string", default: `${REPORTS}duplicados-2026-11-06.json` },
    record: { type: "string", default: PROD_RECORD },
    "dry-run": { type: "boolean", default: false },
  },
});
const dryRun = values["dry-run"];
const db = requireDatabaseUrl();
// Every connection of the dry run is read-only (the app's client reads DATABASE_URL on import).
if (dryRun) process.env.DATABASE_URL = readOnlyUrl(db.url);
const log = createRunLog("games-igdb-aliases");

const { prisma } = await import("@/lib/db");
const { backfillIgdbAliases, joinsFromFiles } = await import("@/lib/catalog/igdb-aliases");

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

const started = Date.now();
let exitCode = 0;
try {
  if (dryRun) {
    await assertReadOnly(async () => {
      const rows = await prisma.$queryRaw<{ default_transaction_read_only: string }[]>`SHOW default_transaction_read_only`;
      return rows[0]?.default_transaction_read_only;
    });
    log.info(`Dry run: the database session is read-only (default_transaction_read_only = on). Database "${db.name}". Log: ${log.file}`);
  } else {
    log.info(`Writing the IGDB aliases of the joined duplicates in database "${db.name}". Log: ${log.file}`);
  }
  const record = values.record === "none" ? undefined : existsSync(values.record) ? readJson(values.record) : undefined;
  if (values.record !== "none" && !record) throw new Error(`Record not found: ${values.record} (pass --record none to take every approved join).`);
  const { joins, problems } = joinsFromFiles(readJson(values.approved), readJson(values.report), record);
  log.info(`${joins.length} joins taken from ${values.approved}${record ? " (that ran, per the record)" : ""}.`);
  for (const p of problems) log.warn(p);

  const result = await backfillIgdbAliases(joins, { dryRun });
  for (const a of result.added) log.info(`${dryRun ? "would add" : "added"} igdb ${a.igdbId} -> ${a.gameSlug} (was ${a.dropSlug})`);
  for (const c of result.conflicts) log.warn(`conflict: igdb ${c.igdbId} (of ${c.dropSlug}) is held by ${c.heldBy}: left alone`);
  for (const m of result.missingKeep) log.warn(`the game that stayed is gone: ${m}`);
  log.info(
    `${dryRun ? "Dry run, nothing written" : "Done"}: ${result.joins} joins; ${result.added.length} aliases ${dryRun ? "to add" : "added"}, ` +
      `${result.alreadyAlias} already there, ${result.keepsOwn} kept as the game's own id, ${result.withoutIgdbId} drops without an IGDB id, ` +
      `${result.conflicts.length} conflicts, ${result.missingKeep.length} games gone. ${formatDuration(Date.now() - started)}.`,
  );
  if (problems.length > 0 || result.conflicts.length > 0 || result.missingKeep.length > 0) exitCode = 1;
} catch (error) {
  log.error("games:igdb-aliases stopped", error);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);

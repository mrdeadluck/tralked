/**
 * Trophy lists, phase a, last step (after the deploy and `trophy-lists:backfill`): reads every
 * active PSN and Xbox account again in full (without the cron's 50 s budget: up to 30 min a pass,
 * up to 10 passes, holding the import lease so the cron and the import worker leave the accounts
 * alone), moves guide notes off the old list-less rows, deletes those rows where it is safe,
 * rebuilds every user's list XP and prints the per-user numbers before and after
 * (lib/trophies/finish.ts). Anything kept is listed as "kept: <game slug> <platform> <reason>".
 *
 * Production: use the direct URL (DATABASE_URL_UNPOOLED), not the pooled one. Take a pg_dump and
 * a `trophy-lists:snapshot` first.
 *
 *   DATABASE_URL=$DATABASE_URL_UNPOOLED pnpm trophy-lists:finish --dry-run   # read-only
 *   DATABASE_URL=$DATABASE_URL_UNPOOLED pnpm trophy-lists:finish             # resync + writes
 *
 * PSN_NPSSO and XBOX_OPENXBL_KEY come from the env or from C:\projetos\Nova pasta\.env.chaves
 * (values are never printed). A platform without its key is not resynced (never on the offline
 * fixtures, which would write made-up trophies) and its list-less rows with unlocks stay; without
 * either key only --dry-run runs. Set IGDB_CLIENT_ID/IGDB_CLIENT_SECRET too, or games new to the catalog are
 * created without IGDB data. The report also goes to C:\Users\luck_\tralked-backups\.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadKeysIntoEnv } from "./lib/keys";
import { createRunLog, formatDuration, requireDatabaseUrl } from "./lib/run";

const BACKUPS = "C:\\Users\\luck_\\tralked-backups";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    "pass-minutes": { type: "string", default: "30" },
    "max-passes": { type: "string", default: "10" },
  },
});
const dryRun = values["dry-run"];
const passMinutes = Number(values["pass-minutes"]);
const maxPasses = Number(values["max-passes"]);
if (!(passMinutes > 0) || !Number.isInteger(maxPasses) || maxPasses < 1) {
  console.error("--pass-minutes must be positive and --max-passes a positive integer.");
  process.exit(2);
}

const db = requireDatabaseUrl();
const log = createRunLog("trophy-lists-finish");
// Before the app modules load: lib/env reads process.env once.
const loaded = loadKeysIntoEnv(["PSN_NPSSO", "XBOX_OPENXBL_KEY"]);
if (loaded.length > 0) log.info(`Keys from .env.chaves: ${loaded.join(", ")}`);

const { prisma } = await import("@/lib/db");
const { platformCredential } = await import("@/lib/integrations/availability");
const { igdbConfigured } = await import("@/lib/integrations/igdb");
const { finishTrophyLists } = await import("@/lib/trophies/finish");

// Never the offline fixtures: they would write made-up trophies. A platform without its key here
// is not resynced (its list-less rows with unlocks are kept and listed).
const platforms = (["psn", "xbox"] as const).filter((p) => platformCredential(p));
const missing = (["psn", "xbox"] as const).filter((p) => !platformCredential(p));
if (!dryRun && platforms.length === 0) {
  log.error("No PSN_NPSSO nor XBOX_OPENXBL_KEY: refusing to resync on fixtures. Use --dry-run or set the keys.");
  await prisma.$disconnect();
  process.exit(2);
}
if (!dryRun && missing.length > 0) {
  log.warn(`No credential for ${missing.join(", ")}: those accounts are not resynced and their list-less rows stay.`);
}
if (!dryRun && !igdbConfigured()) log.warn("IGDB is not configured: games new to the catalog are created without IGDB data.");

const pair = (x: number, y: number) => (x === y ? `${x}` : `${x} -> ${y}`);
const started = Date.now();
try {
  log.info(`${dryRun ? "Dry run (read-only) on" : "Finishing the trophy lists in"} ${db.name}…`);
  const report = await finishTrophyLists({
    dryRun,
    platforms,
    passBudgetMs: passMinutes * 60_000,
    maxPasses,
    log: (message) => log.info(message),
  });

  for (const a of report.accounts) {
    const line =
      `${a.platform} ${a.handle}: ${a.outcome}, ${a.passes} pass(es), ${a.newUnlocks} new unlocks` +
      (a.failedTitles.length ? `, unread: ${a.failedTitles.join(", ")}` : "") +
      (a.error ? ` (${a.error})` : "");
    if (a.outcome === "done" && a.failedTitles.length === 0) log.info(line);
    else log.warn(line);
  }
  if (dryRun) {
    for (const g of report.games) {
      log.info(
        `would delete (once every holder's resync completes): ${g.slug} ${g.platform} ${g.rows} rows, ` +
          `${g.unlocks} unlocks [${g.holders.join(", ")}], ${g.notes} notes`,
      );
    }
  }
  const count = (action: string) => report.games.filter((g) => g.action === action).length;
  log.info(
    `Games with list-less rows: ${report.games.length} (${count("deleted")} deleted, ${count("kept")} kept, ` +
      `${count("would-delete")} would delete). Rows deleted: ${report.deleted.achievements}, unlocks: ${report.deleted.unlocks}.`,
  );
  log.info(
    `Guide notes: ${report.notes.moved} ${dryRun ? "would move" : "moved"}, ${report.notes.replacedByExisting} replaced by an ` +
      `existing note, ${report.notes.withoutTarget} without a list row${dryRun ? " yet (the resync writes the lists' rows)" : ""}.`,
  );
  for (const k of report.kept) log.warn(k);
  for (const r of report.rebuilt) log.info(`XP rebuilt for ${r.handle}: ${r.paid} paid, ${r.voided} voided`);

  log.info("Per user (before -> after):");
  for (const b of report.before) {
    const a = report.after.find((x) => x.userId === b.userId) ?? b;
    log.info(
      `${b.handle}: psn ${pair(b.psnUnlocks, a.psnUnlocks)}, xbox ${pair(b.xboxUnlocks, a.xboxUnlocks)}, ` +
        `retro ${pair(b.retroUnlocks, a.retroUnlocks)}, steam ${pair(b.steamUnlocks, a.steamUnlocks)}; ` +
        `platinums ${pair(b.platinums, a.platinums)}, regional extras ${pair(b.regionalExtras, a.regionalExtras)}, ` +
        `XP ${pair(b.totalXp, a.totalXp)}, level ${pair(b.level, a.level)}, Steam XP ${pair(b.steamXp, a.steamXp)}`,
    );
    if (a.steamUnlocks !== b.steamUnlocks || a.steamXp !== b.steamXp) {
      log.error(`STEAM CHANGED for ${b.handle}: investigate before anything else.`);
      process.exitCode = 1;
    }
  }

  mkdirSync(BACKUPS, { recursive: true });
  const file = join(BACKUPS, `finish-${dryRun ? "dry-run-" : ""}${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  log.info(`Report: ${file}. Took ${formatDuration(Date.now() - started)}.${dryRun ? " Dry run: nothing was written." : ""}`);
} catch (error) {
  log.error("Trophy lists finish failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

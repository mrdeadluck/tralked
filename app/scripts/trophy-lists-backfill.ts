/**
 * Trophy lists, phase a: creates a TrophyList for every platform/game that has achievement rows,
 * links the rows in place for single-list games and copies the per-list progress from UserGame.
 * Multi-list PSN/Xbox games keep their lists empty and list-less rows (the finish resync fills
 * them). Idempotent; every statement commits on its own (batches of 2,000), and a final
 * VACUUM (ANALYZE) "Achievement" reclaims the dead tuples of the update.
 *
 * Production: use the direct URL (DATABASE_URL_UNPOOLED), not the pooled one.
 *
 *   DATABASE_URL=$DATABASE_URL_UNPOOLED pnpm trophy-lists:backfill --dry-run   # SELECTs only
 *   DATABASE_URL=$DATABASE_URL_UNPOOLED pnpm trophy-lists:backfill             # writes
 *
 * Exits 1 when Steam rows are still without a list (the NOT NULL of phase d would fail).
 */
import { parseArgs } from "node:util";
import { createRunLog, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const dryRun = values["dry-run"];

const db = requireDatabaseUrl();
const log = createRunLog("trophy-lists-backfill");

const { prisma } = await import("@/lib/db");
const { backfillTrophyLists } = await import("@/lib/trophies/backfill");

try {
  log.info(`${dryRun ? "Dry run (read-only) on" : "Backfilling trophy lists in"} ${db.name}…`);
  const report = await backfillTrophyLists({ dryRun });
  for (const [platform, c] of Object.entries(report.perPlatform)) {
    log.info(
      `${platform}: ${c.listsCreated} lists, ${c.achievementsLinked} rows linked, ${c.userListsCreated} user lists, ${c.achievementsLeftForResync} rows left for the resync`,
    );
  }
  log.info(
    `Total: ${report.listsCreated} lists created (${report.listsWithoutRows} without rows), ${report.achievementsLinked} rows linked, ` +
      `${report.achievementsLeftForResync} rows left for the resync (${report.multiListGames} multi-list games), ` +
      `${report.userListsCreated} user lists created, ${report.steamWithoutAppId} Steam games without appid.`,
  );
  if (report.steamLeftover > 0) {
    log.warn(`WARNING: ${report.steamLeftover} Steam rows are still without a list. Phase d (NOT NULL) would fail. Investigate first.`);
    process.exitCode = 1;
  }
  if (dryRun) log.info("Dry run: nothing was written.");
  else {
    log.info('VACUUM (ANALYZE) "Achievement"…');
    await prisma.$executeRawUnsafe('VACUUM (ANALYZE) "Achievement"');
  }
} catch (error) {
  log.error("Trophy lists backfill failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

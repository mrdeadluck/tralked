/**
 * Fills in Steam store details (summary, studio, dates, art, achievements) of the catalog for hours
 * on end, straight against the database: the queue the `steam-catalog` cron job drains ~10 games at
 * a time. Games players need (opened, owned, wished), then SteamSpy's most owned; the long tail
 * waits until someone opens its page (database size). Several games are in flight at once, while
 * one polite fetch keeps the store at one request every 1.5 s.
 * While it works it holds a lease, so the cron job leaves details to it (no game is done twice).
 * Stops when the time is up, the queue is empty, or a whole batch fails (Steam refusing us).
 *
 *   DATABASE_URL=postgresql://... STEAM_API_KEY=... pnpm steam:details [--hours 5.5] [--concurrency 4]
 *
 * Run every 6 h by .github/workflows/steam-details.yml. Progress goes to the console and to
 * scripts/.logs/.
 */
import { parseArgs } from "node:util";
import { createRunLog, formatDuration, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({
  options: {
    hours: { type: "string", default: "5.5" },
    concurrency: { type: "string", default: "4" },
    batch: { type: "string", default: "50" },
  },
});
const hours = Number(values.hours);
const concurrency = Number(values.concurrency);
const batch = Number(values.batch);
if (!(hours > 0) || !(concurrency >= 1) || !(batch >= 1)) {
  console.error("--hours, --concurrency and --batch must be positive numbers.");
  process.exit(2);
}

const db = requireDatabaseUrl();
const log = createRunLog("steam-details");

// Imported after the DATABASE_URL check: the Prisma client reads it on import.
const { prisma } = await import("@/lib/db");
const { steamMode } = await import("@/lib/integrations/steam");
const { createSteamCatalogDeps, holdDetailsWorkerLease, releaseDetailsWorkerLease, syncCatalogDetails } = await import(
  "@/lib/sync/steam-catalog"
);

if (steamMode() !== "api") {
  log.error("Set STEAM_API_KEY: without it the achievement schemas would be skipped and the games marked done.");
  process.exit(2);
}

const waiting = { steamAppId: { not: null }, detailsSyncedAt: null } as const;
const counts = async () => ({
  requested: await prisma.game.count({ where: { ...waiting, detailsRequestedAt: { not: null } } }),
  popular: await prisma.game.count({ where: { ...waiting, popularity: { gt: 0 } } }),
});

const deps = createSteamCatalogDeps();
const started = Date.now();
const stopAt = started + hours * 3_600_000;
let processed = 0;
let failed = 0;
let exitCode = 0;

const before = await counts();
log.info(
  `Steam details for "${db.name}": ${before.requested} requested by players and ${before.popular} popular games waiting. ` +
    `${concurrency} at a time, batches of ${batch}, up to ${hours} h. Log: ${log.file}`,
);

try {
  while (Date.now() < stopAt) {
    await holdDetailsWorkerLease();
    const result = await syncCatalogDetails(stopAt, deps, batch, concurrency);
    processed += result.processed;
    failed += result.failed;
    const left = await counts();
    const elapsed = Date.now() - started;
    const perHour = Math.round((processed / Math.max(elapsed, 1)) * 3_600_000);
    log.info(
      `+${result.processed} ok, ${result.failed} failed · ${processed} done in ${formatDuration(elapsed)} ` +
        `(~${perHour}/h) · waiting: ${left.requested} requested, ${left.popular} popular`,
    );
    if (result.processed === 0 && result.failed === 0) {
      log.info("Queue empty: nothing left to fill in.");
      break;
    }
    if (result.processed === 0) {
      log.warn("A whole batch failed (Steam may be refusing us): stopping until the next run.");
      exitCode = 1;
      break;
    }
  }
} finally {
  await releaseDetailsWorkerLease().catch((error) => log.error("Could not release the worker lease", error));
  log.info(`Done: ${processed} games filled in, ${failed} failed, in ${formatDuration(Date.now() - started)}.`);
  await prisma.$disconnect();
}
process.exit(exitCode);

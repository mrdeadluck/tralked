/**
 * Fills in Steam store details (summary, studio, dates, art, achievements) of the catalog straight
 * against the database: the queue the `steam-catalog` cron job drains ~10 games at a time. Games
 * players need (opened, owned, wished), then SteamSpy's most owned; the long tail waits until
 * someone opens its page (database size). A few games are in flight at once, while one polite
 * fetch keeps the store at one request every 1.5 s.
 * While it works it holds a lease, so the cron job leaves details to it (no game is done twice).
 * Stops when the time is up, the queue is empty, or a whole batch fails (Steam refusing us). When
 * the database connection drops it waits for it and carries on (lib/worker/db-retry.ts); it gives
 * up after a few failed attempts in a row.
 *
 *   DATABASE_URL=postgresql://... STEAM_API_KEY=... pnpm steam:details [--hours 0.6] [--concurrency 3]
 *
 * Run every 6 h by .github/workflows/steam-details.yml, in a short window: the free Neon plan has
 * 100 CU-hours a month and every minute of work keeps the compute awake (app/README.md, "Workers").
 * Progress goes to the console and to scripts/.logs/.
 */
import { parseArgs } from "node:util";
import { createRunLog, exitAfterWindow, formatDuration, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({
  options: {
    hours: { type: "string", default: "0.6" },
    concurrency: { type: "string", default: "3" },
    batch: { type: "string", default: "40" },
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
const { createDbRetry } = await import("@/lib/worker/db-retry");
const { repairLibraryArt } = await import("@/lib/sync/library-art");

if (steamMode() !== "api") {
  log.error("Set STEAM_API_KEY: without it the achievement schemas would be skipped and the games marked done.");
  process.exit(2);
}

const waiting = { steamAppId: { not: null }, detailsSyncedAt: null } as const;
// Counted at the start and the end only: two counts over the whole catalog per batch add up.
const counts = async () => ({
  requested: await prisma.game.count({ where: { ...waiting, detailsRequestedAt: { not: null } } }),
  popular: await prisma.game.count({ where: { ...waiting, popularity: { gt: 0 } } }),
});

const deps = createSteamCatalogDeps();
const withDb = createDbRetry({ log });
const started = Date.now();
const stopAt = started + hours * 3_600_000;
exitAfterWindow(stopAt, log);
let processed = 0;
let failed = 0;
let exitCode = 0;

try {
  const before = await withDb("counting the queue", counts);
  log.info(
    `Steam details for "${db.name}": ${before.requested} requested by players and ${before.popular} popular games waiting. ` +
      `${concurrency} at a time, batches of ${batch}, up to ${hours} h. Log: ${log.file}`,
  );
  // Library art filled in before the store's asset service was read (hashed paths): the real
  // portrait and hero, 100 games per request (lib/sync/library-art.ts).
  if (deps.politeFetch) {
    const fetcher = deps.politeFetch;
    const art = await withDb("library art", () => repairLibraryArt(fetcher, { limit: 3000, deadline: stopAt }));
    log.info(`Library art: ${art.checked} checked, ${art.covers} portraits and ${art.heroes} heroes written, ${art.failed} failed.`);
  }
  while (Date.now() < stopAt) {
    // One batch is the unit a lost connection repeats: the games it did not write stay queued.
    const result = await withDb("details batch", async () => {
      await holdDetailsWorkerLease();
      return syncCatalogDetails(stopAt, deps, batch, concurrency);
    });
    processed += result.processed;
    failed += result.failed;
    const elapsed = Date.now() - started;
    const perHour = Math.round((processed / Math.max(elapsed, 1)) * 3_600_000);
    log.info(
      `+${result.processed} ok, ${result.failed} failed · ${processed} done in ${formatDuration(elapsed)} (~${perHour}/h)`,
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
  const left = await withDb("counting the queue", counts);
  log.info(`Still waiting: ${left.requested} requested, ${left.popular} popular.`);
} catch (error) {
  log.error("The details worker stopped", error);
  exitCode = 1;
} finally {
  await releaseDetailsWorkerLease().catch((error) => log.error("Could not release the worker lease", error));
  log.info(`Done: ${processed} games filled in, ${failed} failed, in ${formatDuration(Date.now() - started)}.`);
  await prisma.$disconnect();
}
process.exit(exitCode);

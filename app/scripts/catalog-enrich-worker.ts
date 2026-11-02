/**
 * Enriches the catalog straight against the database (lib/sync/enrich.ts): official media (IGDB
 * trailers, screenshots, artworks; SteamGridDB art) of the games still without it, and the Steam
 * user review totals, both most popular first, in parallel. When the database connection drops it
 * waits for it and carries on with the next batch (lib/worker/db-retry.ts); it gives up after a few
 * failed attempts in a row.
 *
 *   DATABASE_URL=postgresql://... IGDB_CLIENT_ID=... IGDB_CLIENT_SECRET=... pnpm catalog:enrich [--hours 0.6]
 *
 * Run daily by .github/workflows/catalog-enrich.yml, in a short window (free Neon plan: 100 CU-hours
 * a month, app/README.md "Workers"). Progress goes to the console and to scripts/.logs/.
 */
import { parseArgs } from "node:util";
import { createRunLog, exitAfterWindow, formatDuration, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({ options: { hours: { type: "string", default: "0.6" } } });
const hours = Number(values.hours);
if (!(hours > 0)) {
  console.error("--hours must be a positive number.");
  process.exit(2);
}

const db = requireDatabaseUrl();
const log = createRunLog("catalog-enrich");

// Imported after the DATABASE_URL check: the Prisma client reads it on import.
const { prisma } = await import("@/lib/db");
const { hasKey } = await import("@/lib/env");
const { createPoliteFetch } = await import("@/lib/integrations/steam/polite-fetch");
const { enrichMedia, enrichReviews } = await import("@/lib/sync/enrich");
const { createDbRetry } = await import("@/lib/worker/db-retry");

const started = Date.now();
const stopAt = started + hours * 3_600_000;
exitAfterWindow(stopAt, log);
const withDb = createDbRetry({ log });
let exitCode = 0;
log.info(`Catalog enrichment of "${db.name}", up to ${hours} h. Log: ${log.file}`);
try {
  const politeFetch = createPoliteFetch({ hostIntervalsMs: { "store.steampowered.com": 1_500 } });
  const [media, reviews] = await Promise.all([
    hasKey("IGDB_CLIENT_ID")
      ? enrichMedia(stopAt, log, undefined, Date.now, withDb)
      : (log.info("Media skipped: no IGDB_CLIENT_ID."), Promise.resolve({ done: 0, failed: 0 })),
    enrichReviews(stopAt, politeFetch, log, Date.now, withDb),
  ]);
  log.info(`Media: ${media.done} done, ${media.failed} failed. Reviews: ${reviews.done} read, ${reviews.failed} failed.`);
} catch (error) {
  log.error("The enrichment worker stopped", error);
  exitCode = 1;
} finally {
  log.info(`Done in ${formatDuration(Date.now() - started)}.`);
  await prisma.$disconnect();
}
process.exit(exitCode);

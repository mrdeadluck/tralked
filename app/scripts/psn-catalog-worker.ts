/**
 * Indexes the Sony trophy lists (lib/sync/psn-catalog.ts): walks the npCommunicationIds
 * NPWR00001_00, NPWR00002_00, … asking `trophyGroups` of each (one request every 3 s), stores name,
 * console and trophy counts in the light PsnCatalogList table, then (without --no-match) links the
 * lists whose name is that of exactly one PlayStation catalog game. Trophies are never read here.
 *
 *   DATABASE_URL=postgresql://... PSN_NPSSO=... pnpm psn:catalog [--minutes N] [--no-match]
 *
 * Without --minutes the window comes from the start time (psnSliceMinutes: 50 min, cut 2 min before
 * the next job of the timetable; a late start with under 5 min left, or inside platform-import's
 * window, exits 0).
 * While the scan's own pause holds (`psn-scan-cooldown`: a slice Sony throttled, or refused with 403
 * on 3 different ids, writes it for 4 h) the run skips its slot and exits 0. The page opens' 1 h
 * pause (`psn-open-cooldown`) does not skip a slot. 400s on 3 different new ids end the slice as
 * "rejected" and the run exits 1 (Sony's API may have changed).
 * The scan holds its rows in memory and writes once at the end (Neon sleeps meanwhile); SIGINT/SIGTERM
 * (a GitHub cancel) ends the scan early and that write still happens.
 * Run by .github/workflows/psn-catalog.yml (matching only when the repository variable
 * PSN_CATALOG_MATCH is "true"). A lap ends after 2,000 ids with no list in a row past the highest
 * NPWR id a TrophyList holds; the next lap starts 30 days later. Progress goes to the console and to
 * scripts/.logs/.
 */
import { parseArgs } from "node:util";
import { loadKeysIntoEnv } from "./lib/keys";
import { createRunLog, exitAfterWindow, formatDuration, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({
  options: {
    minutes: { type: "string" },
    "no-match": { type: "boolean", default: false },
  },
});
const explicitMinutes = values.minutes === undefined ? null : Number(values.minutes);
if (explicitMinutes !== null && !(explicitMinutes > 0)) {
  console.error("--minutes must be a positive number.");
  process.exit(2);
}

const db = requireDatabaseUrl();
const log = createRunLog("psn-catalog");
// On a developer machine the key lives outside the repos; in Actions it is already in the env.
loadKeysIntoEnv(["PSN_NPSSO"]);

// Imported after the DATABASE_URL check: the Prisma client reads it on import.
const { prisma } = await import("@/lib/db");
const { hasKey } = await import("@/lib/env");
const { getPsn } = await import("@/lib/integrations");
const { matchPsnCatalog, psnSliceMinutes, readCursor, scanPsnIds } = await import("@/lib/sync/psn-catalog");
const { PSN_SCAN_COOLDOWN_KEY, psnCooldownUntil } = await import("@/lib/sync/psn-catalog-trophies");

if (!hasKey("PSN_NPSSO")) {
  log.error("Set PSN_NPSSO: without the service account there is no Sony catalog to read.");
  process.exit(2);
}

const LAP_PAUSE_MS = 30 * 24 * 3_600_000;
const started = Date.now();
const minutes = explicitMinutes ?? psnSliceMinutes(new Date(started));
if (minutes === 0) {
  log.info("Started too close to the next job of the timetable: nothing to scan.");
  process.exit(0);
}
const stopAt = started + minutes * 60_000;
// The grace outlasts the final write of the scan (one transaction, retried once).
exitAfterWindow(stopAt, log, 5 * 60_000);
let stopRequested = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log.warn(`${signal}: ending the scan, the rows read so far are still written.`);
    stopRequested = true;
  });
}
let exitCode = 0;
log.info(`PSN catalog of "${db.name}", up to ${minutes} min${values["no-match"] ? ", no matching" : ""}. Log: ${log.file}`);
try {
  const pausedUntil = await psnCooldownUntil(new Date(), prisma, [PSN_SCAN_COOLDOWN_KEY]);
  if (pausedUntil !== null) {
    // Sony throttled the scan lately: no scan and no matching in this slot.
    log.info(`The scan is paused until ${new Date(pausedUntil).toISOString()} (psn-scan-cooldown): slot skipped.`);
  } else {
    const cursor = await readCursor();
    const doneAt = cursor.completedAt;
    if (doneAt && Date.now() - Date.parse(doneAt) < LAP_PAUSE_MS) {
      log.info(`The last lap ended on ${doneAt}: the next one starts 30 days after.`);
    } else {
      // Matching needs its share of the window; the scan spends the rest.
      const scanDeadline = values["no-match"] ? stopAt : started + minutes * 60_000 * 0.9;
      const scan = await scanPsnIds({ api: getPsn(), count: Number.MAX_SAFE_INTEGER, deadline: scanDeadline, cursor, shouldStop: () => stopRequested, log });
      log.info(`Scanned ${scan.scanned} ids, ${scan.hits} lists; stopped: ${scan.stopped}; next id ${scan.next}; ${scan.misses} misses in a row.`);
      if (scan.cooldownUntil !== null) {
        log.warn(`Sony throttled the scan or refused a burst of ids: every Sony call pauses until ${new Date(scan.cooldownUntil).toISOString()}.`);
      }
      if (scan.stopped === "forbidden" || scan.stopped === "rejected") exitCode = 1;
    }
    if (!values["no-match"] && !stopRequested) {
      const match = await matchPsnCatalog({ stopAt });
      log.info(
        `Linked ${match.linked} lists to catalog games; ${match.ambiguous} ambiguous names, ` +
          `${match.unmatched} without a PlayStation game, ${match.existing} already held by a player.`,
      );
    }
  }
} catch (error) {
  log.error("The PSN catalog worker stopped", error);
  exitCode = 1;
} finally {
  log.info(`Done in ${formatDuration(Date.now() - started)}.`);
  await prisma.$disconnect();
}
process.exit(exitCode);

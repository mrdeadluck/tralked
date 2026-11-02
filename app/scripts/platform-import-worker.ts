/**
 * Finishes the platform imports the cron cannot: new or unfinished PSN, Xbox and RetroAchievements
 * connections (their sync never reached the end of the list) and Steam libraries whose last sync
 * ran out of time, straight against the database and without the 50 s ceiling of a Vercel
 * invocation. One lane per platform; each account gets 5-minute slices in turn
 * (lib/sync/first-import.ts). While it works it holds a lease naming the accounts it took, so the
 * cron leaves those to it. Stops when the time is up or no lane has work left. When the database
 * connection drops it waits for it and carries on (lib/worker/db-retry.ts); it gives up after a
 * few failed attempts in a row.
 *
 *   DATABASE_URL=postgresql://... STEAM_API_KEY=... PSN_NPSSO=... pnpm platforms:import [--hours 0.8]
 *
 * Platforms without their credential here are skipped (the cron still syncs them from Vercel).
 * Run every 2 h by .github/workflows/platform-import.yml (app/README.md, "Workers"). Progress goes to
 * the console and to scripts/.logs/.
 */
import { parseArgs } from "node:util";
import { createRunLog, exitAfterWindow, formatDuration, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({
  options: {
    hours: { type: "string", default: "0.8" },
    "slice-minutes": { type: "string", default: "5" },
  },
});
const hours = Number(values.hours);
const sliceMinutes = Number(values["slice-minutes"]);
if (!(hours > 0) || !(sliceMinutes > 0)) {
  console.error("--hours and --slice-minutes must be positive numbers.");
  process.exit(2);
}

const db = requireDatabaseUrl();
const log = createRunLog("platform-import");

// Imported after the DATABASE_URL check: the Prisma client reads it on import.
const { prisma } = await import("@/lib/db");
const { importCandidates, importLanes, runFirstImports } = await import("@/lib/sync/first-import");
const { createDbRetry } = await import("@/lib/worker/db-retry");

const lanes = importLanes();
if (lanes.length === 0) {
  log.error("No platform credential here (STEAM_API_KEY, PSN_NPSSO, XBOX_OPENXBL_KEY, RA_API_KEY): nothing to import.");
  process.exit(2);
}

const started = Date.now();
const stopAt = started + hours * 3_600_000;
exitAfterWindow(stopAt, log);
const withDb = createDbRetry({ log });
let exitCode = 0;
try {
  const waiting = await withDb("counting the queues", () =>
    Promise.all(lanes.map(async (lane) => `${lane} ${(await importCandidates(lane)).length}`)),
  );
  log.info(
    `First imports on "${db.name}", up to ${hours} h in slices of ${sliceMinutes} min. Waiting: ${waiting.join(", ")}. ` +
      `Log: ${log.file}`,
  );
  const stats = await runFirstImports({ stopAt, sliceMs: sliceMinutes * 60_000, lanes, log, withDb });
  for (const [lane, s] of Object.entries(stats)) {
    log.info(`${lane}: ${s.finished} finished, ${s.stopped} left for later, ${s.failed} failed, ${s.slices} slices`);
    if (s.failed > 0 && s.finished === 0 && s.slices === s.failed) exitCode = 1;
  }
} catch (error) {
  log.error("The import worker stopped", error);
  exitCode = 1;
} finally {
  log.info(`Done in ${formatDuration(Date.now() - started)}.`);
  await prisma.$disconnect();
}
process.exit(exitCode);

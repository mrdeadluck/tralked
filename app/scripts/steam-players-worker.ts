/**
 * Samples the Steam concurrent players of the catalog's most popular Steam games (item 14,
 * lib/sync/steam-players.ts) and writes them in one statement: current count, today's peak and the
 * highest peak Tralked measured, one row per game, no history. Keyless Steam endpoint; a few
 * minutes per run.
 *
 *   DATABASE_URL=postgresql://... pnpm steam:players [--limit 2000] [--concurrency 16]
 *
 * Run hourly by .github/workflows/steam-players.yml. Progress goes to the console and to scripts/.logs/.
 */
import { parseArgs } from "node:util";
import { createRunLog, formatDuration, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({
  options: {
    limit: { type: "string", default: "2000" },
    concurrency: { type: "string", default: "16" },
  },
});
const limit = Number(values.limit);
const concurrency = Number(values.concurrency);
if (!(limit >= 1) || !(concurrency >= 1)) {
  console.error("--limit and --concurrency must be positive numbers.");
  process.exit(2);
}

const db = requireDatabaseUrl();
const log = createRunLog("steam-players");

// Imported after the DATABASE_URL check: the Prisma client reads it on import.
const { prisma } = await import("@/lib/db");
const { recordPlayerCounts, samplePlayers, topSteamGames } = await import("@/lib/sync/steam-players");

const started = Date.now();
let exitCode = 0;
try {
  const games = await topSteamGames(limit);
  log.info(`Steam players for "${db.name}": ${games.length} games, ${concurrency} at a time. Log: ${log.file}`);
  const result = await samplePlayers(games, { concurrency });
  const written = await recordPlayerCounts(result.samples, new Date());
  log.info(
    `${written} written, ${result.missing} without a count, ${result.failed} failed in ${formatDuration(Date.now() - started)}.`,
  );
  if (result.throttled) {
    log.warn("Steam kept refusing requests: stopped early, the next run continues.");
    exitCode = result.samples.length === 0 ? 1 : 0;
  }
} catch (error) {
  log.error("The players worker stopped", error);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);

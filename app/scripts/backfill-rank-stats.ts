/**
 * Plano 4, F6: fills the highscores totals (`UserRankStats`) of every user on a database from
 * before the highscores tables, and optionally takes today's rank snapshot (`--snapshot`, what
 * the daily `highscores` cron does). Idempotent: the totals are recomputed from the library and
 * the valid unlocks and simply rewritten; nothing else (XP, missions, attributes) is touched.
 *
 *   DATABASE_URL=postgresql://... pnpm highscores:backfill --dry-run   # lists what would be written
 *   DATABASE_URL=postgresql://... pnpm highscores:backfill --snapshot  # writes, then snapshots today
 */
import { parseArgs } from "node:util";
import { createRunLog, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    snapshot: { type: "boolean", default: false },
  },
});
const dryRun = values["dry-run"];

const db = requireDatabaseUrl();
const log = createRunLog("backfill-rank-stats");

const { prisma } = await import("@/lib/db");
const { refreshRankStats } = await import("@/lib/highscores/write");
const { takeRankSnapshots } = await import("@/lib/highscores/snapshot");

try {
  log.info(`${dryRun ? "Dry run on" : "Backfilling highscores totals in"} ${db.name}…`);
  const users = await prisma.user.findMany({ select: { id: true, handle: true }, orderBy: { handle: "asc" } });
  for (const user of users) {
    const all = await refreshRankStats(user.id, { dryRun });
    log.info(
      `${dryRun ? "would write" : "wrote"} @${user.handle}: ${Math.floor(all.playtimeMin / 60)} h, ` +
        `${all.achievements} unlocks (${all.rareAchievements} rare), ${all.perfectGames} platinas, ` +
        `${all.gamesOwned} games (${all.gamesPlayed} played)`,
    );
  }
  log.info(`${users.length} user(s) ${dryRun ? "checked" : "written"}.`);
  if (values.snapshot) {
    if (dryRun) log.info("would take today's rank snapshot");
    else {
      const result = await takeRankSnapshots();
      log.info(`snapshot: ${result.rows} row(s) over ${result.processed} board(s), ${result.pruned} pruned`);
    }
  }
  log.info(`Log: ${log.file}`);
} catch (error) {
  log.error("Backfill failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

/**
 * One-off: records the Steam achievements earned on an unknown date (Steam answers achieved=1 with
 * unlocktime 0 for old ones, e.g. 97 of diguzz's Team Fortress 2) that syncs before 2026-11-09
 * dropped. For each user with a Steam account, asks Steam for the achievements of every Steam game
 * not complete in Tralked, re-reads only the games where Steam has more earned than Tralked, records
 * them through the sync's path (lib/sync/steam-dateless.ts) and recomputes the user.
 *
 *   DATABASE_URL=... STEAM_API_KEY=... pnpm steam:dateless [--user <handle>] [--dry-run]
 *
 * --dry-run  only prints, per user: games, achievements to add, XP before -> after. Writes nothing.
 * Production: the direct URL (DATABASE_URL_UNPOOLED). The Steam key comes from STEAM_API_KEY, as
 * for the other Steam scripts; it is never printed.
 */
import { parseArgs } from "node:util";
import { createRunLog, formatDuration, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({
  options: {
    user: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
const dryRun = values["dry-run"];

const db = requireDatabaseUrl();
const log = createRunLog("steam-dateless");

const { prisma } = await import("@/lib/db");
const { steamMode } = await import("@/lib/integrations/steam");
const { applyDateless, planDateless } = await import("@/lib/sync/steam-dateless");

if (steamMode() !== "api") {
  log.error("Set STEAM_API_KEY: the re-read needs the Steam Web API (GetPlayerAchievements).");
  process.exit(2);
}

const started = Date.now();
log.info(`steam:dateless on database "${db.name}"${dryRun ? " (dry run: nothing is written)" : ""}. Log: ${log.file}`);

const signed = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
let exitCode = 0;
try {
  const users = await prisma.user.findMany({
    where: { steamId: { not: null }, ...(values.user ? { handle: values.user } : {}) },
    select: { id: true, handle: true },
    orderBy: { handle: "asc" },
  });
  if (values.user && users.length === 0) {
    log.error(`No user @${values.user} with a Steam account.`);
    exitCode = 1;
  }
  let usersWithGap = 0;
  let toAdd = 0;
  for (const user of users) {
    try {
      const plan = await planDateless(user.id);
      if (plan.status === "private") {
        log.info(`@${user.handle}: Steam game details are private, skipped.`);
        continue;
      }
      if (plan.games.length === 0) continue;
      usersWithGap++;
      const missing = plan.games.reduce((sum, g) => sum + g.missing, 0);
      const undated = plan.games.reduce((sum, g) => sum + g.undated, 0);
      toAdd += missing;
      log.info(
        `@${user.handle}: ${plan.games.length} game(s), ${signed(missing)} achievements (${undated} undated), ` +
          `XP ${plan.xpBefore} -> ${plan.xpAfter} (${signed(plan.xpAfter - plan.xpBefore)})`,
      );
      for (const g of plan.games) {
        log.info(
          `    ${g.name} (${g.appId}): Steam ${g.steamEarned}, Tralked ${g.tralkedEarned}, ` +
            `${signed(g.missing)} (${g.undated} undated), ${signed(g.xp)} XP`,
        );
      }
      if (dryRun) continue;
      const result = await applyDateless(user.id, plan);
      log.info(
        `@${user.handle}: recorded ${result.recorded}, XP now ${result.xpAfter}` +
          (result.failed.length > 0 ? `; not recorded (retry later): ${result.failed.join(", ")}` : ""),
      );
      if (result.failed.length > 0) exitCode = 1;
    } catch (error) {
      log.error(`@${user.handle}: failed`, error);
      exitCode = 1;
    }
  }
  log.info(
    `${users.length} Steam user(s) read, ${usersWithGap} with achievements to add (${toAdd} in all)` +
      `${dryRun ? ", nothing written" : ""}. Done in ${formatDuration(Date.now() - started)}.`,
  );
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);

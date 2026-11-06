/**
 * One-off: records the Steam achievements earned on an unknown date (Steam answers achieved=1 with
 * unlocktime 0 for old ones, e.g. 97 of diguzz's Team Fortress 2) that syncs before this change
 * dropped. For each user with a Steam account, asks Steam for the achievements of every Steam game
 * not complete in Tralked, re-reads only the games where Steam has more earned than Tralked, records
 * them through the sync's path (lib/sync/steam-dateless.ts) and recomputes the user.
 *
 *   DATABASE_URL=... pnpm steam:dateless [--user <handle>] [--dry-run]
 *
 * --dry-run  only prints, per user: games, achievements to add, games that become 100% (with the
 *            platinum bonus), games Steam did not answer for, XP before -> after. The database
 *            session is opened read-only and checked (SHOW default_transaction_read_only) first.
 * Production: the direct URL (DATABASE_URL_UNPOOLED). STEAM_API_KEY comes from the keys file
 * (C:\projetos\Nova pasta\.env.chaves, scripts/lib/keys.ts), else from
 * C:\projetos\Nova pasta\app\.env.production.local; never from the environment. Both are only
 * read, and the value is never printed.
 */
import { parseArgs } from "node:util";
import { KEYS_FILE, keyFromFiles } from "./lib/keys";
import { assertReadOnly, readOnlyUrl } from "./lib/read-only";
import { createRunLog, formatDuration, requireDatabaseUrl } from "./lib/run";

/** The production env file of the main checkout (STEAM_API_KEY fallback only). */
const PRODUCTION_ENV_FILE = "C:/projetos/Nova pasta/app/.env.production.local";

const { values } = parseArgs({
  options: {
    user: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
const dryRun = values["dry-run"];

// Before any app module reads the env: the keys file first, then the production env file (Lucas
// allowed it as a fallback), or none at all. Read-only; the value is never printed.
const KEY_FILES = [KEYS_FILE, PRODUCTION_ENV_FILE];
const steamKey = keyFromFiles("STEAM_API_KEY", KEY_FILES);
if (steamKey) process.env.STEAM_API_KEY = steamKey.value;
else delete process.env.STEAM_API_KEY;

const db = requireDatabaseUrl();
if (dryRun) process.env.DATABASE_URL = readOnlyUrl(db.url);
const log = createRunLog("steam-dateless");

const { prisma } = await import("@/lib/db");
const { steamMode } = await import("@/lib/integrations/steam");
const { applyDateless, planDateless } = await import("@/lib/sync/steam-dateless");

const stop = async (message: string): Promise<never> => {
  log.error(message);
  await prisma.$disconnect();
  process.exit(2);
};

if (dryRun) {
  try {
    await assertReadOnly(async () => {
      const rows = await prisma.$queryRaw<{ default_transaction_read_only: string }[]>`SHOW default_transaction_read_only`;
      return rows[0]?.default_transaction_read_only;
    });
  } catch (error) {
    await stop(`Refusing the dry run: ${error instanceof Error ? error.message : String(error)}`);
  }
  log.info("Database session is read-only (default_transaction_read_only = on).");
}
if (steamKey) log.info(`STEAM_API_KEY read from ${steamKey.file}.`);
else await stop(`STEAM_API_KEY is in neither ${KEY_FILES.join(" nor ")}: add it to ${KEYS_FILE}.`);
if (steamMode() !== "api") await stop("The Steam Web API client is not active: check STEAM_API_KEY in the keys file.");

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
      for (const g of plan.notRead) log.warn(`@${user.handle}: not read: ${g.name} (${g.appId}): ${g.error}`);
      if (plan.notRead.length > 0) exitCode = 1;
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
      const completed = plan.games.filter((g) => g.completes);
      if (completed.length > 0) {
        log.info(`  @${user.handle}: becomes 100%:`);
        for (const g of completed) {
          log.info(`    ${g.name} (${g.appId}): ${signed(g.missing)} unlocks, platinum bonus ${signed(g.platinumBonus)} XP`);
        }
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

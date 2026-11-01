/**
 * Gives Steam games still named with a placeholder (`Steam App <appid>`, from the old catalog sync,
 * or `Jogo <appid> da Steam`) their real name and slug, and queues them for store details (cover,
 * art). Names come from the owners' Steam libraries (needs STEAM_API_KEY; one request per owner),
 * then from the store (appdetails `filters=basic`, one request every 1.5 s). A game with no name
 * found becomes a stub (unlisted) until a later sync or the details job names it. Never touches
 * games with a real name; running it again changes nothing.
 *
 *   DATABASE_URL=postgresql://... pnpm games:repair-placeholders [--dry-run]
 *
 * Progress goes to the console and to scripts/.logs/.
 */
import { parseArgs } from "node:util";
import { createRunLog, formatDuration, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const dryRun = values["dry-run"];

const db = requireDatabaseUrl();
const log = createRunLog("repair-placeholder-games");

// Imported after the DATABASE_URL check: the Prisma client reads it on import.
const { prisma } = await import("@/lib/db");
const { getSteam } = await import("@/lib/integrations");
const { steamMode } = await import("@/lib/integrations/steam");
const { createPoliteFetch } = await import("@/lib/integrations/steam/polite-fetch");
const { repairPlaceholderGames } = await import("@/lib/sync/repair-placeholders");

const started = Date.now();
const mode = steamMode();
log.info(`Repairing placeholder game names in "${db.name}" (Steam mode: ${mode}${dryRun ? ", dry run" : ""}). Log: ${log.file}`);
if (mode !== "api") log.warn("Without STEAM_API_KEY the owners' libraries cannot be read: names come from the store only.");

const result = await repairPlaceholderGames({
  dryRun,
  deps: {
    steam: getSteam(),
    politeFetch:
      mode === "fixture"
        ? null
        : createPoliteFetch({
            hostIntervalsMs: { "store.steampowered.com": 1_500 },
            onRetry: ({ url, attempt, waitMs, reason }) =>
              log.warn(`retry ${attempt} in ${Math.round(waitMs / 1000)}s after ${reason}: ${url}`),
          }),
    log: (message) => log.info(message),
    now: () => new Date(),
  },
});

log.info(
  `Done in ${formatDuration(Date.now() - started)}: ${result.found} placeholder games; renamed ${result.renamed} ` +
    `(library ${result.fromLibrary}, store ${result.fromStore}), made stub ${result.stubbed}, failed ${result.failed}` +
    `${dryRun ? " (dry run: nothing written)" : ""}.`,
);
await prisma.$disconnect();

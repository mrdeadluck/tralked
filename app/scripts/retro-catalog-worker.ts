/**
 * Imports the RetroAchievements catalog (item 15, lib/sync/retro-catalog.ts): every console's games
 * with achievements into the light RetroCatalogGame table, then links each new RA game to its
 * catalog game by name, or creates a name-only stub for it (`--no-stubs`: link only). Achievement
 * lists are not read here: the game page reads them on demand.
 *
 *   DATABASE_URL=postgresql://... RA_API_KEY=... [RA_USERNAME=...] pnpm retro:catalog [--minutes 30] [--no-stubs]
 *
 * Run weekly by .github/workflows/retro-catalog.yml. Progress goes to the console and to scripts/.logs/.
 */
import { parseArgs } from "node:util";
import { createRunLog, formatDuration, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({
  options: {
    minutes: { type: "string", default: "30" },
    "no-stubs": { type: "boolean", default: false },
  },
});
const minutes = Number(values.minutes);
if (!(minutes > 0)) {
  console.error("--minutes must be a positive number.");
  process.exit(2);
}

const db = requireDatabaseUrl();
const log = createRunLog("retro-catalog");

// Imported after the DATABASE_URL check: the Prisma client reads it on import.
const { prisma } = await import("@/lib/db");
const { hasKey } = await import("@/lib/env");
const { getRetroCatalog } = await import("@/lib/integrations/retro/catalog");
const { importRetroCatalog, linkRetroCatalog } = await import("@/lib/sync/retro-catalog");

if (!hasKey("RA_API_KEY")) {
  log.error("Set RA_API_KEY: without it there is no RetroAchievements catalog to read.");
  process.exit(2);
}

const started = Date.now();
const stopAt = started + minutes * 60_000;
let exitCode = 0;
log.info(`RetroAchievements catalog of "${db.name}", up to ${minutes} min. Log: ${log.file}`);
try {
  const imported = await importRetroCatalog(getRetroCatalog(), log);
  log.info(
    `Read ${imported.games} games with achievements on ${imported.consoles} consoles` +
      ` (${imported.failedConsoles} consoles failed); ${imported.written} rows new or changed.`,
  );
  if (imported.consoles > 0 && imported.failedConsoles === imported.consoles) exitCode = 1;
  const linked = await linkRetroCatalog({ stopAt, create: !values["no-stubs"] });
  log.info(
    `Linked ${linked.linked} to catalog games, created ${linked.created} stubs, ` +
      `${linked.ambiguous} ambiguous names and ${linked.skipped} hacks/subsets left in the RA table.`,
  );
  if (Date.now() >= stopAt) log.warn("Time is up: the next run links the rest.");
} catch (error) {
  log.error("The RetroAchievements catalog worker stopped", error);
  exitCode = 1;
} finally {
  log.info(`Done in ${formatDuration(Date.now() - started)}.`);
  await prisma.$disconnect();
}
process.exit(exitCode);

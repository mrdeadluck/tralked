/**
 * Repairs the Steam library art stored before the store's asset service was read (newer apps keep
 * their 600×900 portrait and hero in a hashed folder, where the plain path 404s): blank or wide
 * stand-in covers get the portrait, blank heroes the hero (lib/sync/library-art.ts). 100 games per
 * store request; idempotent. The details worker and the releases job run the same repair.
 *
 *   DATABASE_URL=postgresql://... pnpm steam:library-art [--limit 3000]
 */
import { parseArgs } from "node:util";
import { createRunLog, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({ options: { limit: { type: "string", default: "3000" } } });
const limit = Number(values.limit);
if (!(limit >= 1)) {
  console.error("--limit must be a positive number.");
  process.exit(2);
}

const db = requireDatabaseUrl();
const log = createRunLog("steam-library-art");

const { prisma } = await import("@/lib/db");
const { createPoliteFetch } = await import("@/lib/integrations/steam/polite-fetch");
const { repairLibraryArt } = await import("@/lib/sync/library-art");

let exitCode = 0;
try {
  log.info(`Library art on "${db.name}", up to ${limit} games…`);
  const art = await repairLibraryArt(createPoliteFetch({}), { limit });
  log.info(`${art.checked} checked: ${art.covers} portraits and ${art.heroes} heroes written, ${art.failed} failed.`);
} catch (error) {
  log.error("Library art repair stopped", error);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);

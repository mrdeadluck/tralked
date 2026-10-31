/**
 * Renames the fictional people of the development data (seeded players and news bylines) to the
 * invented NPC names of `prisma/seed-data/sample-names.ts`, on a database seeded before Plano 4.
 * Idempotent; only the seed's own rows are touched (see scripts/lib/rename-sample-users.ts): real
 * accounts (lucas, mrdead, diguzz, anyone who signed up) are never renamed.
 *
 *   DATABASE_URL=postgresql://... pnpm sample:rename --dry-run   # lists what would change
 *   DATABASE_URL=postgresql://... pnpm sample:rename             # applies it
 */
import { parseArgs } from "node:util";
import { createRunLog, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const dryRun = values["dry-run"];

const db = requireDatabaseUrl();
const log = createRunLog("rename-sample-users");

const { prisma } = await import("@/lib/db");
const { SAMPLE_NAMES, seedPlayerSteamId } = await import("../prisma/seed-data/sample-names");
const { renameSampleUsers } = await import("./lib/rename-sample-users");

try {
  log.info(`${dryRun ? "Dry run on" : "Renaming sample users in"} ${db.name}…`);
  const { changes, skipped } = await renameSampleUsers(prisma, SAMPLE_NAMES, { dryRun, steamIdOf: seedPlayerSteamId });
  for (const c of changes) log.info(`${dryRun ? "would set" : "set"} ${c.model}.${c.field} ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)} (${c.id})`);
  for (const s of skipped) log.warn(`skipped: ${s}`);
  log.info(`${changes.length} change(s) ${dryRun ? "planned" : "applied"}, ${skipped.length} skipped. Log: ${log.file}`);
} catch (error) {
  log.error("Rename failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

/**
 * Repairs PSN trophy lists stored with definitions that are not Sony's (found by
 * `pnpm trophy-lists:audit-psn`): reads each list's definitions again (validated like the sync),
 * fixes its Achievement rows by apiName, removes those Sony does not have (stops when one is in
 * use), creates the missing ones, sets trophyCount, and recomputes the holders' progress and XP
 * (a row whose XP value changes gets a new row: its old ledger entry is voided and the new key
 * paid). `--dry-run` runs it all in a transaction that is rolled back and prints before -> after.
 * Idempotent.
 *
 *   DATABASE_URL=... pnpm trophy-lists:repair-psn --list NPWR09510_00[,NPWR...] [--dry-run]
 *
 * PSN_NPSSO is read from C:\projetos\Nova pasta\.env.chaves (never printed).
 */
import { parseArgs } from "node:util";
import { readKeys } from "./lib/keys";
import { createRunLog, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({ options: { list: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
const dryRun = values["dry-run"];
const ids = (values.list ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (ids.length === 0) {
  console.error("Usage: pnpm trophy-lists:repair-psn --list NPWR09510_00[,NPWR...] [--dry-run]");
  process.exit(2);
}

const db = requireDatabaseUrl();
const npsso = readKeys().get("PSN_NPSSO");
if (!npsso) {
  console.error("No PSN_NPSSO in C:\projetos\Nova pasta\.env.chaves.");
  process.exit(2);
}
const log = createRunLog("trophy-lists-repair-psn");

const { prisma } = await import("@/lib/db");
const { createPsnClient } = await import("@/lib/integrations/psn/client");
const { repairPsnLists } = await import("@/lib/trophies/psn-repair");

const arrow = ([before, after]: [number | boolean, number | boolean]) => (before === after ? `${before}` : `${before} -> ${after}`);

try {
  log.info(`${dryRun ? "Dry run (rolled back) on" : "Repairing PSN trophy lists in"} ${db.name}: ${ids.join(", ")}`);
  const reports = await repairPsnLists(createPsnClient({ npsso }), ids, { dryRun });
  for (const r of reports) {
    log.info(`${r.externalId} ${r.gameSlug ?? ""}: ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
    if (r.status !== "repaired" && r.status !== "would-repair") continue;
    log.info(
      `  rows: ${r.rows.updated} fixed in place, ${r.rows.replaced} replaced (XP value changed), ${r.rows.created} created, ` +
        `${r.rows.removed} removed; trophyCount ${arrow(r.trophyCount)}`,
    );
    for (const u of r.users) {
      log.info(
        `  ${u.handle}: unlocks ${arrow(u.unlocked)}, platinums ${arrow(u.platinums)}, XP ${arrow(u.xp)}, completed ${arrow(u.completed)}`,
      );
    }
    for (const w of r.warnings) log.warn(`  ${w}`);
  }
  if (reports.some((r) => r.status === "blocked" || r.status === "unreadable" || r.status === "not-found")) process.exitCode = 1;
  if (dryRun) log.info("Dry run: nothing was written.");
} catch (error) {
  log.error("PSN trophy-list repair failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

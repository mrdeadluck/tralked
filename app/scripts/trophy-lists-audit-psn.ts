/**
 * Read-only audit of the PSN trophy lists: for each active PSN connection (or `--user`), Sony's
 * title list (`definedTrophies` per tier, one paginated request per account) against each stored
 * TrophyList of those titles (trophyCount and the list's Achievement rows per tier), plus the
 * checks that need no Sony on every other PSN list (icons naming another list, trophyCount against
 * the rows). Prints the lists that differ and exits 1 when there is any (or an account could not
 * be read). Writes nothing.
 *
 * Production: use the direct URL (DATABASE_URL_UNPOOLED), not the pooled one.
 *
 *   DATABASE_URL=$DATABASE_URL_UNPOOLED pnpm trophy-lists:audit-psn [--user diguzz]
 *
 * PSN_NPSSO is read from C:\projetos\Nova pasta\.env.chaves (never printed).
 */
import { parseArgs } from "node:util";
import { readKeys } from "./lib/keys";
import { requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({ options: { user: { type: "string" } } });

const db = requireDatabaseUrl();
const npsso = readKeys().get("PSN_NPSSO");
if (!npsso) {
  console.error("No PSN_NPSSO in C:\projetos\Nova pasta\.env.chaves.");
  process.exit(2);
}

// Imported after the DATABASE_URL check: the Prisma client reads it on import.
const { prisma } = await import("@/lib/db");
const { createPsnClient } = await import("@/lib/integrations/psn/client");
const { auditPsnLists, listProblems } = await import("@/lib/trophies/psn-audit");
const { describeCounts } = await import("@/lib/trophies/psn-definitions");

try {
  console.log(`Auditing the PSN trophy lists of ${db.name}${values.user ? ` (${values.user})` : ""} (read-only)…`);
  const report = await auditPsnLists(createPsnClient({ npsso }), { handle: values.user });
  for (const a of report.accounts) {
    console.log(`  ${a.handle}: ${a.status === "ok" ? `${a.titles} Sony titles` : a.status}${a.error ? ` (${a.error})` : ""}`);
  }
  if (report.accounts.length === 0) console.log(values.user ? `  No active PSN connection for ${values.user}.` : "  No active PSN connection.");
  console.log(`\n${report.checked} lists checked, ${report.mismatches.length} differ.`);
  for (const m of report.mismatches) {
    console.log(`\n${m.externalId}  ${m.gameSlug ?? "?"}  ${m.console ?? "?"}`);
    console.log(`  Tralked: trophyCount ${m.trophyCount}, ${describeCounts(m.stored)}`);
    console.log(`  Sony:    ${m.sony ? describeCounts(m.sony) : "not in the audited accounts' titles"}`);
    console.log(`  why:     ${listProblems(m).join("; ")}`);
  }
  if (report.mismatches.length > 0) {
    console.log(`\nRepair: pnpm trophy-lists:repair-psn --list ${report.mismatches.map((m) => m.externalId).join(",")} --dry-run`);
  }
  if (report.mismatches.length > 0 || report.accounts.some((a) => a.status === "failed")) process.exitCode = 1;
} catch (error) {
  console.error("PSN trophy-list audit failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

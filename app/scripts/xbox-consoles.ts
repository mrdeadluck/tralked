/**
 * Fills `console` (360 | ONE | PC) of the Xbox trophy lists that have none (those the trophy-list
 * backfill created had no device data), from the title history of the linked Xbox accounts: one
 * OpenXBL request per account, the accounts holding the most of those lists first, none once every
 * list is known; nothing at all when no list is missing its console. A stored console is never
 * rewritten. `--dry-run` reads and prints, writes nothing.
 *
 * Production: use the direct URL (DATABASE_URL_UNPOOLED), not the pooled one.
 *
 *   DATABASE_URL=$DATABASE_URL_UNPOOLED pnpm xbox:consoles [--dry-run]
 *
 * XBOX_OPENXBL_KEY is read from C:\projetos\Nova pasta\.env.chaves (never printed).
 */
import { parseArgs } from "node:util";
import { readKeys } from "./lib/keys";
import { requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const dryRun = values["dry-run"] === true;

const db = requireDatabaseUrl();
const apiKey = readKeys().get("XBOX_OPENXBL_KEY");
if (!apiKey) {
  console.error("No XBOX_OPENXBL_KEY in C:\\projetos\\Nova pasta\\.env.chaves.");
  process.exit(2);
}

// Imported after the DATABASE_URL check: the Prisma client reads it on import.
const { prisma } = await import("@/lib/db");
const { createXboxClient } = await import("@/lib/integrations/xbox/client");
const { fillXboxConsoles } = await import("@/lib/trophies/xbox-consoles");

try {
  console.log(`Xbox list consoles of ${db.name}${dryRun ? " (dry run, nothing written)" : ""}…`);
  const report = await fillXboxConsoles(createXboxClient({ apiKey }), { dryRun });
  console.log(`  ${report.missing} Xbox list(s) without a console.`);
  for (const a of report.accounts) {
    console.log(`  ${a.handle}: ${a.status === "ok" ? `${a.titles} titles in the history` : a.status}${a.error ? ` (${a.error})` : ""}`);
  }
  console.log(`  OpenXBL requests: ${report.accounts.length}`);
  const filled = Object.entries(report.filled);
  console.log(
    `  ${dryRun ? "Would fill" : "Filled"}: ${filled.length ? filled.map(([c, n]) => `${c} ${n}`).join(", ") : "none"}` +
      ` (${filled.reduce((sum, [, n]) => sum + n, 0)} lists)`,
  );
  if (report.unresolved.length > 0) {
    console.log(`  Still without a console (${report.unresolved.length}): ${report.unresolved.join(", ")}`);
  }
  if (report.accounts.some((a) => a.status === "failed")) process.exitCode = 1;
} catch (error) {
  console.error("Xbox list consoles failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

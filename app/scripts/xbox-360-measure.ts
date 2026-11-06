/**
 * Read-only: what a sync would import of a player's Xbox 360 titles (their lists through the
 * client's two 360 routes, the earned ones, those with a date, and how many the burst rule would
 * flag together with the player's stored Xbox unlocks). Writes nothing, to the database or OpenXBL.
 * The database session is opened read-only and checked (SHOW default_transaction_read_only) first.
 * Requests: 1 (title history) + 2 per 360 title, at most `--max-titles` titles (default 24, so 49
 * requests; OpenXBL's quota of 150 an hour is shared with production).
 *
 *   DATABASE_URL=$DATABASE_URL_UNPOOLED pnpm xbox:360-measure --user diguzz [--max-titles 24]
 *
 * XBOX_OPENXBL_KEY is read from C:\projetos\Nova pasta\.env.chaves (never printed).
 */
import { parseArgs } from "node:util";
import { readKeys } from "./lib/keys";
import { assertReadOnly, readOnlyUrl } from "./lib/read-only";
import { requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({ options: { user: { type: "string" }, "max-titles": { type: "string", default: "24" } } });
const maxTitles = Number(values["max-titles"]);
if (!values.user || !Number.isInteger(maxTitles) || maxTitles < 0) {
  console.error("Usage: pnpm xbox:360-measure --user <handle> [--max-titles 24]");
  process.exit(2);
}

const db = requireDatabaseUrl();
// Read-only: every session opens read-only, checked before any query.
process.env.DATABASE_URL = readOnlyUrl(db.url);
const apiKey = readKeys().get("XBOX_OPENXBL_KEY");
if (!apiKey) {
  console.error("No XBOX_OPENXBL_KEY in C:\\projetos\\Nova pasta\\.env.chaves.");
  process.exit(2);
}

const { prisma } = await import("@/lib/db");
const { createXboxClient } = await import("@/lib/integrations/xbox/client");
const { measureX360 } = await import("@/lib/trophies/xbox-360");

// Counts the requests and keeps OpenXBL's quota headers (no key, no body is printed).
let requests = 0;
let quota = "";
const countingFetch: typeof fetch = async (input, init) => {
  requests++;
  const res = await fetch(input, init);
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (remaining !== null) quota = `${remaining} of ${res.headers.get("x-ratelimit-limit") ?? "?"} left this hour`;
  return res;
};

const readOnly = async () => {
  try {
    await assertReadOnly(async () => {
      const rows = await prisma.$queryRaw<{ default_transaction_read_only: string }[]>`SHOW default_transaction_read_only`;
      return rows[0]?.default_transaction_read_only;
    });
  } catch (error) {
    console.error(`Refusing to run: ${error instanceof Error ? error.message : String(error)}`);
    await prisma.$disconnect();
    process.exit(2);
  }
  console.log("Database session is read-only (default_transaction_read_only = on).");
};
await readOnly();

try {
  const account = await prisma.linkedAccount.findFirst({
    where: { platform: "xbox", linkedAt: { not: null }, user: { handle: values.user } },
    select: { userId: true, externalId: true, handle: true },
  });
  if (!account) {
    console.error(`No linked Xbox account for ${values.user} in ${db.name}.`);
    process.exit(2);
  }
  const stored = await prisma.userAchievement.findMany({
    where: { userId: account.userId, achievement: { platform: "xbox" } },
    select: { achievementId: true, unlockedAt: true },
  });
  // Undated unlocks (phase c, Steam only today) cannot take part in the burst rule; Xbox always stores a date.
  const others = stored.flatMap((u) => (u.unlockedAt ? [{ achievementId: u.achievementId, unlockedAt: u.unlockedAt }] : []));
  console.log(`Xbox 360 of ${values.user} (${account.handle}), ${db.name}: read-only, ${others.length} Xbox unlocks stored.`);
  const measure = await measureX360(createXboxClient({ apiKey, fetch: countingFetch }), account.externalId, { maxTitles, others });
  if (measure === "private") {
    console.log("  Xbox refused the history (private).");
  } else {
    for (const t of measure.titles) {
      const what = t.status === "ok" ? `${t.earned}/${t.achievements} earned (${t.dated} dated)` : `FAILED: ${t.error}`;
      console.log(`  ${t.titleId.padEnd(11)} ${t.name.slice(0, 40).padEnd(40)} ${what}; history ${t.history.earned}/${t.history.total}`);
    }
    const { totals } = measure;
    console.log(`\n  360 titles with an unlock: ${measure.found}; read ${measure.titles.length}, failed ${measure.titles.length - totals.titles}, left for the budget ${measure.skipped}`);
    console.log(`  Would import: ${totals.titles} lists, ${totals.achievements} achievements, ${totals.earned} earned (${totals.dated} dated)`);
    console.log(`  Sample icon: ${measure.sampleIcon ?? "none"}`);
    console.log(`  Burst rule on those dates (with the stored Xbox unlocks): ${measure.bursts} flagged`);
  }
  console.log(`  OpenXBL requests: ${requests}${quota ? ` (${quota})` : ""}`);
} catch (error) {
  console.error("Xbox 360 measure failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

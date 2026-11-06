/**
 * Every regional list pays XP: settles the PSN games with more than one list in a version for
 * every player holding unlocks on them (only the missing per-list entries are added, and the
 * regional copies' own-id entries the old once-per-version rule voided under the current link are
 * restored; nothing already paid is voided or paid twice), in batches, then recomputes each
 * player. Prints per player: new and restored entries (restored ones by the hour they were voided),
 * voided (expected 0), XP, level and platinums before -> after. Idempotent. The real run writes
 * what it did to C:\Users\luck_\tralked-backups\regional-xp-<timestamp>.json as each player
 * finishes (a crash midway leaves the record of the players done): per player, the created keys,
 * the restored entry ids with their old voidedAt, and the voided ids (expected none). Afterwards
 * run `pnpm highscores:backfill`: the "Platinas e 100%" board of the players not recomputed here
 * still holds the old meaning.
 *
 * `--dry-run` only reads: the session is opened read-only (default_transaction_read_only=on,
 * checked before anything) and nothing is written. Production: the direct URL.
 *
 *   DATABASE_URL=$DATABASE_URL_UNPOOLED pnpm trophy-lists:regional-xp --dry-run [--user <handle>]
 *   DATABASE_URL=$DATABASE_URL_UNPOOLED pnpm trophy-lists:regional-xp [--user <handle>]
 *
 * Run with the scheduled workflows paused (it takes no import lease).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createRunLog, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false }, user: { type: "string" } },
});
const dryRun = values["dry-run"];
const BACKUPS = "C:\\Users\\luck_\\tralked-backups";

const db = requireDatabaseUrl();
if (dryRun) {
  // Every connection of the dry run is read-only (the app's client reads DATABASE_URL on import).
  const url = new URL(db.url);
  url.searchParams.set("options", "-c default_transaction_read_only=on");
  process.env.DATABASE_URL = url.toString();
}
const log = createRunLog("trophy-lists-regional-xp");

const { prisma } = await import("@/lib/db");
const { regionalListXp } = await import("@/lib/trophies/regional-xp");

try {
  if (dryRun) {
    const [row] = await prisma.$queryRaw<{ default_transaction_read_only: string }[]>`SHOW default_transaction_read_only`;
    if (row?.default_transaction_read_only !== "on") {
      log.error(`The session is not read-only (default_transaction_read_only = ${row?.default_transaction_read_only}): stopping.`);
      process.exit(2);
    }
    log.info(`Dry run (read-only session, default_transaction_read_only = on) on ${db.name}…`);
  } else {
    log.info(`Paying every regional list in ${db.name}…`);
  }
  const file = join(BACKUPS, `regional-xp-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const startedAt = new Date().toISOString();
  /** The real run's record, rewritten as each player finishes. */
  const save = (done: Awaited<ReturnType<typeof regionalListXp>>) => {
    mkdirSync(BACKUPS, { recursive: true });
    const users = done.map((r) => ({ userId: r.userId, handle: r.handle, ...r.entries }));
    writeFileSync(file, `${JSON.stringify({ database: db.name, startedAt, users }, null, 2)}\n`);
  };
  const reports = await regionalListXp({
    dryRun,
    handle: values.user,
    log: (line) => log.info(line),
    onReport: dryRun ? undefined : save,
  });
  const total = reports.reduce(
    (acc, r) => ({
      created: acc.created + r.created.trophies + r.created.platinums,
      restored: acc.restored + r.restored,
      voided: acc.voided + r.voided,
      xp: acc.xp + r.xp[1] - r.xp[0],
    }),
    { created: 0, restored: 0, voided: 0, xp: 0 },
  );
  log.info(
    `${reports.length} players: ${total.created} new entries, ${total.restored} restored, ${total.voided} voided, ` +
      `XP ${total.xp >= 0 ? "+" : ""}${total.xp.toLocaleString("pt-BR")}.`,
  );
  if (!dryRun) {
    save(reports);
    log.info(`Plans written to ${file}.`);
  }
  if (total.voided > 0) log.warn("WARNING: entries were voided; the rule should only add. Investigate.");
  for (const r of reports) {
    if (r.paid.trophies[0] !== r.paid.trophies[1] || r.paid.platinums[0] !== r.paid.platinums[1]) {
      log.warn(`${r.handle}: entries and unlocks / complete lists differ after the run (list-less rows, or a gap): check.`);
    }
  }
  if (dryRun) log.info("Dry run: nothing was written (XP after = the ledger plus the new entries; missions not simulated).");
  log.info(
    'Next: run `pnpm highscores:backfill` (same DATABASE_URL) so every player\'s "Platinas e 100%" board counts platinas per list.',
  );
} catch (error) {
  log.error("Regional lists XP failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

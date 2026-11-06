/**
 * Read-only accuracy check of the PSN catalog matcher (matchPsnCatalog in lib/sync/psn-catalog.ts),
 * the gate before PSN_CATALOG_MATCH turns matching on in .github/workflows/psn-catalog.yml: runs
 * the matcher's pick (candidatesByName + one game of the PlayStation family) over the names of the
 * PSN TrophyLists some player holds (a UserTrophyList: linked to their game by the sync; lists the
 * matcher made are left out) and compares it with the game each list belongs to.
 *
 *   DATABASE_URL=postgresql://... pnpm psn-catalog:match-check
 *
 * Prints: lists checked; matched-correct (the pick is the stored game); matched-wrong (another
 * game, every one listed); no-match (no PlayStation game of that name, or several: ambiguous).
 * The database session is opened read-only and checked (SHOW default_transaction_read_only) first;
 * nothing is written. No Sony call.
 */
import { assertReadOnly, readOnlyUrl } from "./lib/read-only";
import { createRunLog, formatDuration, requireDatabaseUrl } from "./lib/run";

const db = requireDatabaseUrl();
process.env.DATABASE_URL = readOnlyUrl(db.url);
const log = createRunLog("psn-catalog-match-check");

// Imported after the URL is made read-only: the Prisma client reads it on import.
const { prisma } = await import("@/lib/db");
const { checkPsnMatcher, psnListsForCheck } = await import("@/lib/sync/psn-catalog");

const pct = (n: number, of: number) => (of > 0 ? `${((n / of) * 100).toFixed(1)}%` : "-");
const started = Date.now();
let exitCode = 0;
try {
  await assertReadOnly(async () => {
    const rows = await prisma.$queryRaw<{ default_transaction_read_only: string }[]>`SHOW default_transaction_read_only`;
    return rows[0]?.default_transaction_read_only;
  });
  log.info(`Database session is read-only (default_transaction_read_only = on). Database "${db.name}". Log: ${log.file}`);

  const lists = await psnListsForCheck();
  const result = await checkPsnMatcher(lists);
  const matched = result.correct + result.wrong.length;
  log.info(`${result.checked} PSN lists held by players checked.`);
  log.info(`matched-correct: ${result.correct} (${pct(result.correct, result.checked)}; ${pct(result.correct, matched)} of the matched)`);
  log.info(`matched-wrong:   ${result.wrong.length} (${pct(result.wrong.length, result.checked)}; ${pct(result.wrong.length, matched)} of the matched)`);
  log.info(`no-match:        ${result.noMatch} (${pct(result.noMatch, result.checked)}), ${result.ambiguous} of them ambiguous`);
  if (result.wrong.length > 0) {
    const ids = [...new Set(result.wrong.flatMap((w) => [w.gameId, w.matchedGameId]))];
    const games = new Map(
      (await prisma.game.findMany({ where: { id: { in: ids } }, select: { id: true, slug: true } })).map((g) => [g.id, g.slug]),
    );
    log.info("matched-wrong lists (list: stored game -> matcher's game):");
    for (const w of result.wrong) {
      log.info(`  ${w.externalId} "${w.name}": ${games.get(w.gameId) ?? w.gameId} -> ${games.get(w.matchedGameId) ?? w.matchedGameId}`);
    }
  }
  log.info(`Nothing written. Done in ${formatDuration(Date.now() - started)}.`);
} catch (error) {
  log.error("The match check stopped", error);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);

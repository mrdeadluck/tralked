/**
 * Per-console platforms (Game.consoles, IGDB platform slugs), backfill of the games already in the
 * catalog:
 *  1. games whose `platforms` hold console labels a platform sync wrote ("PS4") become the family
 *     ("PLAYSTATION") plus the console ("ps4");
 *  2. every game with an IGDB id gets the consoles IGDB lists for it (500 ids per request), added to
 *     the ones it already has.
 * Idempotent. Needs the IGDB credentials (IGDB_CLIENT_ID and IGDB_CLIENT_SECRET, from the
 * environment or C:\projetos\Nova pasta\.env.chaves, never printed): without them it stops before
 * touching the database.
 *
 * Production: use the direct URL (DATABASE_URL_UNPOOLED), not the pooled one.
 *
 *   DATABASE_URL=$DATABASE_URL_UNPOOLED pnpm igdb:consoles --dry-run   # reads only, counts changes
 *   DATABASE_URL=$DATABASE_URL_UNPOOLED pnpm igdb:consoles             # writes
 */
import { parseArgs } from "node:util";
import { loadKeysIntoEnv } from "./lib/keys";
import { createRunLog, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const dryRun = values["dry-run"];

const db = requireDatabaseUrl();
loadKeysIntoEnv(["IGDB_CLIENT_ID", "IGDB_CLIENT_SECRET"]);
if (!process.env.IGDB_CLIENT_ID?.trim() || !process.env.IGDB_CLIENT_SECRET?.trim()) {
  console.error("IGDB_CLIENT_ID and IGDB_CLIENT_SECRET are not set (environment or .env.chaves). Nothing was read or written.");
  process.exit(2);
}

const BATCH = 500;
const log = createRunLog("igdb-consoles-backfill");

// Imported after the checks: the Prisma client reads DATABASE_URL on import.
const { Prisma } = await import("@/generated/prisma/client");
const { prisma } = await import("@/lib/db");
const { createIgdbClient } = await import("@/lib/integrations/igdb/client");
const { consolesOf, normalizeConsoleLabels } = await import("@/lib/releases/platforms");

const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])].sort();

/** Step 1: console labels in `platforms`. */
async function normalizeLabels(): Promise<number> {
  const games = await prisma.game.findMany({ select: { id: true, platforms: true, consoles: true } });
  const changes = games.flatMap((g) => {
    const normalized = normalizeConsoleLabels(g.platforms);
    return normalized ? [{ id: g.id, platforms: normalized.platforms, consoles: union(g.consoles, normalized.consoles) }] : [];
  });
  if (!dryRun) {
    for (let i = 0; i < changes.length; i += BATCH) {
      const values = Prisma.join(changes.slice(i, i + BATCH).map((c) => Prisma.sql`(${c.id}, ${c.platforms}::text[], ${c.consoles}::text[])`));
      await prisma.$executeRaw`
        UPDATE "Game" AS g SET platforms = v.plats, consoles = v.cons
        FROM (VALUES ${values}) AS v(id, plats, cons) WHERE g.id = v.id`;
    }
  }
  return changes.length;
}

/** Step 2: the consoles IGDB lists for each game with an IGDB id. */
async function fillFromIgdb(): Promise<{ games: number; updated: number; unknown: number }> {
  const igdb = createIgdbClient({ clientId: process.env.IGDB_CLIENT_ID!, clientSecret: process.env.IGDB_CLIENT_SECRET! });
  let after = 0;
  const total = { games: 0, updated: 0, unknown: 0 };
  for (;;) {
    const batch = await prisma.game.findMany({
      where: { igdbId: { gt: after } },
      select: { id: true, igdbId: true, consoles: true },
      orderBy: { igdbId: "asc" },
      take: BATCH,
    });
    if (batch.length === 0) return total;
    after = batch[batch.length - 1].igdbId!;
    // Several catalog games may carry one IGDB id: the platforms are asked once per id.
    const platforms = await igdb.getGamePlatforms([...new Set(batch.map((g) => g.igdbId!))]);
    const changes = batch.flatMap((g) => {
      const ids = platforms.get(g.igdbId!);
      if (!ids) {
        total.unknown++;
        return [];
      }
      const next = union(g.consoles, consolesOf(ids));
      return next.length === g.consoles.length ? [] : [{ id: g.id, consoles: next }];
    });
    total.games += batch.length;
    total.updated += changes.length;
    if (!dryRun && changes.length > 0) {
      const values = Prisma.join(changes.map((c) => Prisma.sql`(${c.id}, ${c.consoles}::text[])`));
      await prisma.$executeRaw`
        UPDATE "Game" AS g SET consoles = v.cons FROM (VALUES ${values}) AS v(id, cons) WHERE g.id = v.id`;
    }
    log.info(`IGDB ids up to ${after}: ${total.games} games read, ${total.updated} ${dryRun ? "would change" : "updated"}, ${total.unknown} unknown to IGDB`);
  }
}

try {
  log.info(`${dryRun ? "Dry run (nothing is written) on" : "Backfilling Game.consoles in"} ${db.name}…`);
  const labels = await normalizeLabels();
  log.info(`Console labels in platforms: ${labels} games ${dryRun ? "would be" : "were"} normalized.`);
  const igdb = await fillFromIgdb();
  log.info(`IGDB: ${igdb.games} games read, ${igdb.updated} ${dryRun ? "would change" : "updated"}, ${igdb.unknown} unknown to IGDB.`);
  if (dryRun) log.info("Dry run: nothing was written.");
} catch (error) {
  log.error("Consoles backfill failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

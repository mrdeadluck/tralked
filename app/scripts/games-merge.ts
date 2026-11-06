/**
 * Joins the approved duplicate games (lib/catalog/merge-games.ts) and links the approved other
 * editions (lib/catalog/editions.ts), from a file like docs/relatorios/duplicados-2026-11-06-aprovado.json:
 *
 *   { "merges": [{ "keep": { "id", "slug" }, "drop": { "id", "slug" } }, ...],
 *     "editions": [{ "a": { "id", "slug" }, "b": { "id", "slug" } }, ...] }
 *
 *   DATABASE_URL=... pnpm games:merge --file <aprovado.json> --dry-run
 *   DATABASE_URL=... pnpm games:merge --file <aprovado.json> [--skip-revalidate]
 *
 * `--dry-run` only reads: the session is opened read-only (default_transaction_read_only=on,
 * checked before anything) and the plan is printed, pair by pair, with what would move.
 * The real run joins one game per transaction, in an order that resolves chains (A→B before
 * B→C), skips a pair joined by an earlier run (its old slug already redirects), logs a refused
 * pair and goes on, then links the editions (pairs that became one game are skipped). It writes
 * what it did to C:\Users\luck_\tralked-backups\games-merge-<timestamp>.json (or `--out <dir>`) as it goes,
 * with the players still to recompute (`pendingRecompute`, written as each join commits). Each
 * player is recomputed once, after the last join (not once per join), together with the players an
 * earlier run of the same folder left pending (a run that stopped midway); those records are then
 * marked done. A pair skipped as already joined still has its old, kept and redirect-target slugs
 * expired. At the end it asks the live site to expire the cache of every slug involved (old, kept, repointed, edition
 * pages) through /api/revalidate-games, with CRON_SECRET and APP_URL read from the production env
 * file before the first join (never printed; a missing secret or an APP_URL that is not the https
 * production site stops the run before it writes anything). The rehearsal
 * on a copy of the database passes `--skip-revalidate`. Run with the scheduled workflows paused.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { productionTarget } from "./lib/production-env";
import { assertReadOnly, readOnlyUrl } from "./lib/read-only";
import { createRunLog, formatDuration, requireDatabaseUrl } from "./lib/run";

const BACKUPS = "C:\\Users\\luck_\\tralked-backups";
const PRODUCTION_ENV = "C:\\projetos\\Nova pasta\\app\\.env.production.local";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "skip-revalidate": { type: "boolean", default: false },
    out: { type: "string" },
  },
});
if (!values.file) {
  console.error("Usage: pnpm games:merge --file <aprovado.json> [--dry-run] [--skip-revalidate] [--out <dir>]");
  process.exit(2);
}
const dryRun = values["dry-run"];
const db = requireDatabaseUrl();
// Every connection of the dry run is read-only (the app's client reads DATABASE_URL on import).
if (dryRun) process.env.DATABASE_URL = readOnlyUrl(db.url);
const log = createRunLog("games-merge");

const { prisma } = await import("@/lib/db");
const { mergeGames, MergeRefused, mergeOrder } = await import("@/lib/catalog/merge-games");
const { linkEditions } = await import("@/lib/catalog/editions");
const { movesCell } = await import("@/lib/catalog/duplicates");
const { revalidateGames } = await import("@/lib/catalog/revalidate-games");
const { recomputeUser } = await import("@/lib/progression/recompute");

const ref = z.object({ id: z.string().min(1), slug: z.string().min(1) });
const approvedFile = z.object({
  merges: z.array(z.object({ keep: ref, drop: ref })),
  editions: z.array(z.object({ a: ref, b: ref })).default([]),
});

const started = Date.now();
const now = new Date();
let exitCode = 0;
try {
  if (dryRun) {
    await assertReadOnly(async () => {
      const rows = await prisma.$queryRaw<{ default_transaction_read_only: string }[]>`SHOW default_transaction_read_only`;
      return rows[0]?.default_transaction_read_only;
    });
    log.info(`Dry run: the database session is read-only (default_transaction_read_only = on). Database "${db.name}". Log: ${log.file}`);
  } else {
    log.info(`Joining the approved duplicates in database "${db.name}". Log: ${log.file}`);
  }
  const approved = approvedFile.parse(JSON.parse(readFileSync(resolve(values.file), "utf8")));
  // Read (and checked) before anything is written: a missing secret or a dev APP_URL stops the run here.
  const site = dryRun || values["skip-revalidate"] ? null : productionTarget(readFileSync(PRODUCTION_ENV, "utf8"));
  const order = mergeOrder(approved.merges.map((m) => ({ keep: m.keep.id, drop: m.drop.id, keepSlug: m.keep.slug, dropSlug: m.drop.slug })));
  // The game that finally keeps each dropped one (a chain collapses onto its last keep).
  const keepOf = new Map(order.map((p) => [p.drop, p.keep]));
  const finalOf = (id: string) => {
    let at = id;
    while (keepOf.has(at)) at = keepOf.get(at)!;
    return at;
  };

  const recordDir = values.out ? resolve(values.out) : BACKUPS;
  const recordFile = join(recordDir, `games-merge-${now.toISOString().replace(/[:.]/g, "-")}.json`);
  // Players an earlier run joined but did not get to recompute (it stopped midway).
  const pending = new Set<string>();
  const earlier: string[] = [];
  if (!dryRun && existsSync(recordDir)) {
    for (const name of readdirSync(recordDir).filter((f) => /^games-merge-.*\.json$/.test(f) && f !== basename(recordFile))) {
      const left = (JSON.parse(readFileSync(join(recordDir, name), "utf8")) as { pendingRecompute?: unknown }).pendingRecompute;
      if (!Array.isArray(left) || left.length === 0) continue;
      for (const userId of left) if (typeof userId === "string") pending.add(userId);
      earlier.push(name);
    }
    if (earlier.length > 0) log.info(`${pending.size} player(s) left to recompute by ${earlier.join(", ")}: recomputed at the end.`);
  }
  const record = {
    database: db.name,
    startedAt: now.toISOString(),
    dryRun,
    merges: [] as unknown[],
    editions: [] as unknown[],
    pendingRecompute: [...pending],
    recomputed: [] as string[],
    slugs: [] as string[],
  };
  const save = () => {
    if (dryRun) return;
    mkdirSync(recordDir, { recursive: true });
    writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);
  };
  const slugs = new Set<string>();
  const tally = { joined: 0, skipped: 0, refused: 0, linked: 0, sameGame: 0 };

  log.info(`${order.length} joins (chains first), then ${approved.editions.length} edition pairs.`);
  for (const [i, pair] of order.entries()) {
    const label = `[${i + 1}/${order.length}] ${pair.dropSlug} -> ${pair.keepSlug}`;
    const [drop, keep] = await Promise.all([
      prisma.game.findUnique({ where: { id: pair.drop }, select: { slug: true } }),
      prisma.game.findUnique({ where: { id: pair.keep }, select: { slug: true } }),
    ]);
    if (!drop) {
      // Joined by an earlier run: its old slug already leads somewhere.
      const redirect = await prisma.gameSlugRedirect.findUnique({ where: { fromSlug: pair.dropSlug }, select: { game: { select: { slug: true } } } });
      if (!redirect) throw new Error(`${label}: the dropped game is gone and its slug has no redirect.`);
      log.info(`${label}: already joined (redirects to ${redirect.game.slug}), skipped.`);
      // A run that stopped before revalidating: these pages are expired now.
      for (const slug of [pair.dropSlug, pair.keepSlug, redirect.game.slug]) slugs.add(slug);
      tally.skipped++;
      continue;
    }
    if (drop.slug !== pair.dropSlug || keep?.slug !== pair.keepSlug) {
      throw new Error(`${label}: the ids of the file name other games (slugs ${drop.slug} / ${keep?.slug ?? "missing"}).`);
    }
    try {
      const report = await mergeGames(pair.keep, pair.drop, { dryRun, now, recompute: false });
      const collisions = report.moved.platinumCollisions
        ? `; ${report.moved.platinumCollisions} platinum collision(s)${report.likelyRefused ? " (likely refused)" : ""}`
        : "";
      log.info(
        `${label}: ${dryRun ? "would move" : "moved"} ${movesCell(report.moved)}; ${report.usersRecomputed.length} player(s) to recompute; ` +
          `redirects to ${report.keepSlug}: ${report.redirects.join(", ")}${collisions}`,
      );
      for (const slug of [report.keepSlug, ...report.redirects]) slugs.add(slug);
      if (!dryRun) for (const userId of report.usersRecomputed) pending.add(userId);
      record.pendingRecompute = [...pending].sort();
      record.merges.push({ keep: pair.keepSlug, drop: pair.dropSlug, ...report });
      tally.joined++;
      save();
    } catch (error) {
      if (!(error instanceof MergeRefused)) throw error;
      keepOf.delete(pair.drop); // it stays a game of its own (its editions are linked to it)
      log.warn(`${label}: refused (${error.reason}).`);
      record.merges.push({ keep: pair.keepSlug, drop: pair.dropSlug, refused: error.reason });
      tally.refused++;
      save();
    }
  }

  const ids = [...new Set(approved.editions.flatMap((e) => [finalOf(e.a.id), finalOf(e.b.id)]))];
  const slugOf = new Map((await prisma.game.findMany({ where: { id: { in: ids } }, select: { id: true, slug: true } })).map((g) => [g.id, g.slug]));
  for (const { a, b } of approved.editions) {
    const [x, y] = [finalOf(a.id), finalOf(b.id)];
    const label = `edition ${a.slug} / ${b.slug}`;
    if (x === y) {
      log.info(`${label}: one game after the joins, skipped.`);
      tally.sameGame++;
      continue;
    }
    // In a dry run the joins did not happen: a dropped game still exists, so look up the final ids.
    const [sx, sy] = [slugOf.get(x), slugOf.get(y)];
    if (!sx || !sy) {
      log.warn(`${label}: ${!sx ? a.slug : b.slug} does not exist, skipped.`);
      continue;
    }
    if (!dryRun) await linkEditions(x, y);
    slugs.add(sx).add(sy);
    record.editions.push({ a: sx, b: sy });
    tally.linked++;
  }
  record.slugs = [...slugs].sort();
  save();

  if (dryRun) {
    const players = new Set(record.merges.flatMap((m) => (m as { usersRecomputed?: string[] }).usersRecomputed ?? []));
    log.info(`The real run would recompute ${players.size} player(s) once, after the last join.`);
  } else {
    const users = new Set((await prisma.user.findMany({ where: { id: { in: [...pending] } }, select: { id: true } })).map((u) => u.id));
    for (const userId of [...pending].sort()) {
      if (users.has(userId)) {
        await recomputeUser(userId, now);
        record.recomputed.push(userId);
      }
      pending.delete(userId);
      record.pendingRecompute = [...pending].sort();
      save();
    }
    log.info(`Recomputed ${record.recomputed.length} player(s) once each.`);
    for (const name of earlier) {
      const file = join(recordDir, name);
      const done = { ...JSON.parse(readFileSync(file, "utf8")), pendingRecompute: [], recomputedBy: basename(recordFile) };
      writeFileSync(file, `${JSON.stringify(done, null, 2)}\n`);
    }
  }
  log.info(
    `${dryRun ? "Dry run, nothing written" : "Done"}: ${tally.joined} ${dryRun ? "joins possible" : "joined"}, ${tally.skipped} already joined, ` +
      `${tally.refused} refused; ${tally.linked} edition pairs ${dryRun ? "to link" : "linked"}, ${tally.sameGame} became one game. ` +
      `${formatDuration(Date.now() - started)}.`,
  );

  if (!site) {
    log.info(
      dryRun
        ? `The real run would expire the cache of ${slugs.size} slugs on the live site.`
        : `--skip-revalidate: the cache of ${slugs.size} slugs was not expired. Record: ${recordFile}`,
    );
  } else {
    await revalidateGames([...slugs], site);
    log.info(`Expired the cache of ${slugs.size} slugs on the live site (game pages, forum, gallery). Record: ${recordFile}`);
  }
} catch (error) {
  log.error("games:merge stopped", error);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * IGDB aliases (GameIgdbAlias): the IGDB ids of duplicates joined into a game. A join keeps only
 * one Game.igdbId, so without them the IGDB imports (igdb-catalog, releases → resolveIgdbGames)
 * would meet the dropped game's IGDB id again, find no game with it and create the duplicate anew,
 * often on its old slug, which would shadow the redirect to the game that stayed.
 */

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * The catalog game of each IGDB id: an alias first (a join decided that this id is that game; a
 * game still carrying the id can only be a stub created again before the alias existed), then a
 * game with that Game.igdbId (listed games first, then the oldest).
 */
export async function gamesByIgdbIds(igdbIds: number[], db: Db = prisma): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const ids = [...new Set(igdbIds)];
  if (ids.length === 0) return out;
  for (const a of await db.gameIgdbAlias.findMany({ where: { igdbId: { in: ids } }, select: { igdbId: true, gameId: true } })) {
    out.set(a.igdbId, a.gameId);
  }
  const rest = ids.filter((id) => !out.has(id));
  if (rest.length === 0) return out;
  const own = await db.game.findMany({
    where: { igdbId: { in: rest } },
    select: { id: true, igdbId: true },
    orderBy: [{ stub: "asc" }, { createdAt: "asc" }],
  });
  for (const g of own) if (g.igdbId !== null && !out.has(g.igdbId)) out.set(g.igdbId, g.id);
  return out;
}

/**
 * mergeGames, while it moves rows: the drop's aliases become the keep's (one that is the keep's
 * own IGDB id goes: the keep already answers to it).
 */
export async function moveIgdbAliases(
  tx: Prisma.TransactionClient,
  keep: { id: string; igdbId: number | null },
  drop: { id: string },
): Promise<void> {
  if (keep.igdbId !== null) await tx.gameIgdbAlias.deleteMany({ where: { gameId: drop.id, igdbId: keep.igdbId } });
  await tx.gameIgdbAlias.updateMany({ where: { gameId: drop.id }, data: { gameId: keep.id } });
}

/**
 * mergeGames, once the keep inherited what it lacked: the drop's own IGDB id becomes an alias of
 * the keep, unless the keep carries it (`keep.igdbId`: its id after the join, the drop's when it
 * had none).
 */
export async function aliasDroppedIgdbId(
  tx: Prisma.TransactionClient,
  keep: { id: string; igdbId: number | null },
  dropIgdbId: number | null,
): Promise<void> {
  if (dropIgdbId === null || dropIgdbId === keep.igdbId) return;
  await tx.gameIgdbAlias.upsert({
    where: { igdbId: dropIgdbId },
    create: { igdbId: dropIgdbId, gameId: keep.id },
    update: { gameId: keep.id },
  });
}

/** One join already made, as the backfill needs it. */
export type AliasJoin = { keepId: string; keepSlug: string; dropSlug: string; dropIgdbId: number | null };

type ApprovedFile = { merges: { keep: { id: string; slug: string }; drop: { id: string; slug: string } }[] };
type ReportFile = { groups: { keep: { id: string }; drop: { id: string; slug: string; igdbId?: number | null } }[] };
type RecordFile = { merges: { keep: string; drop: string }[] };

/**
 * The joins of an approved file (docs/relatorios/duplicados-*-aprovado.json), with the drop's IGDB
 * id read from the duplicates report the approval came from (neither the approved file nor the
 * run's record carries IGDB ids). With the run's record (games-merge-*.json), only joins that ran
 * are taken. `problems`: approved joins missing from the report or from the record.
 */
export function joinsFromFiles(
  approved: ApprovedFile,
  report: ReportFile,
  record?: RecordFile,
): { joins: AliasJoin[]; problems: string[] } {
  const joins: AliasJoin[] = [];
  const problems: string[] = [];
  const ran = record ? new Set(record.merges.map((m) => `${m.keep} <- ${m.drop}`)) : null;
  for (const m of approved.merges) {
    const label = `${m.keep.slug} <- ${m.drop.slug}`;
    const group = report.groups.find((g) => g.keep.id === m.keep.id && g.drop.id === m.drop.id);
    const didRun = ran === null || ran.has(label);
    if (!group) problems.push(`${label}: not in the duplicates report (its IGDB id is unknown)`);
    if (!didRun) problems.push(`${label}: not in the record of the run (it did not run)`);
    if (!group || !didRun) continue;
    joins.push({ keepId: m.keep.id, keepSlug: m.keep.slug, dropSlug: m.drop.slug, dropIgdbId: group.drop.igdbId ?? null });
  }
  return { joins, problems };
}

export type AliasBackfillResult = {
  joins: number;
  /** Drops that had no IGDB id. */
  withoutIgdbId: number;
  /** The game that stayed carries the drop's id (it inherited it in the join). */
  keepsOwn: number;
  /** Already an alias of the game that stayed. */
  alreadyAlias: number;
  /** Aliases written (a dry run: that would be written). */
  added: { igdbId: number; gameSlug: string; dropSlug: string }[];
  /** Ids another game already holds (as its own igdbId or as an alias): left alone, to look at. */
  conflicts: { igdbId: number; dropSlug: string; heldBy: string }[];
  /** Joins whose game that stayed is found neither by id nor through a redirect of its slug. */
  missingKeep: string[];
};

/**
 * Writes the IGDB aliases of joins made before mergeGames kept them (`pnpm games:igdb-aliases`).
 * The game that stayed is found by id or, when it was joined again later, through the redirect of
 * its slug. Idempotent; `dryRun` only reads, and also runs on a database that does not have the
 * GameIgdbAlias table yet (production before the migration): no alias exists there.
 */
export async function backfillIgdbAliases(joins: AliasJoin[], { dryRun }: { dryRun: boolean }): Promise<AliasBackfillResult> {
  const result: AliasBackfillResult = {
    joins: joins.length,
    withoutIgdbId: 0,
    keepsOwn: 0,
    alreadyAlias: 0,
    added: [],
    conflicts: [],
    missingKeep: [],
  };
  const [{ present }] = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT to_regclass('"GameIgdbAlias"') IS NOT NULL AS present`;
  if (!present && !dryRun) throw new Error('The GameIgdbAlias table does not exist: deploy the migration first.');
  const aliasOf = async (igdbId: number) =>
    present ? prisma.gameIgdbAlias.findUnique({ where: { igdbId }, select: { game: { select: { id: true, slug: true } } } }) : null;
  const planned = new Map<number, string>();
  for (const join of joins) {
    const igdbId = join.dropIgdbId;
    if (igdbId === null) {
      result.withoutIgdbId++;
      continue;
    }
    const select = { id: true, slug: true, igdbId: true } as const;
    const keep =
      (await prisma.game.findUnique({ where: { id: join.keepId }, select })) ??
      (await prisma.gameSlugRedirect.findUnique({ where: { fromSlug: join.keepSlug }, select: { game: { select } } }))?.game;
    if (!keep) {
      result.missingKeep.push(`${join.keepSlug} <- ${join.dropSlug}`);
      continue;
    }
    if (keep.igdbId === igdbId) {
      result.keepsOwn++;
      continue;
    }
    const alias = await aliasOf(igdbId);
    if (alias?.game.id === keep.id || planned.get(igdbId) === keep.id) {
      result.alreadyAlias++;
      continue;
    }
    const holder = alias?.game ?? (await prisma.game.findFirst({ where: { igdbId }, select: { slug: true } }));
    if (holder || planned.has(igdbId)) {
      result.conflicts.push({ igdbId, dropSlug: join.dropSlug, heldBy: holder?.slug ?? "(another join of this run)" });
      continue;
    }
    planned.set(igdbId, keep.id);
    if (!dryRun) await prisma.gameIgdbAlias.create({ data: { igdbId, gameId: keep.id } });
    result.added.push({ igdbId, gameSlug: keep.slug, dropSlug: join.dropSlug });
  }
  return result;
}

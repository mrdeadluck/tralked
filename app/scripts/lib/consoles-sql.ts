import { Prisma, type PrismaClient } from "@/generated/prisma/client";

type Db = Pick<PrismaClient, "$executeRaw">;

/** Step 1 of the consoles backfill: `platforms` rewritten, guarded by the value that was read. */
export type LabelChange = { id: string; oldPlatforms: string[]; platforms: string[]; consoles: string[] };

/**
 * Writes the normalized labels. Each row is only touched while `platforms` still holds the value
 * the change was computed from (a sync that wrote in between wins), and `consoles` is merged in SQL.
 */
export async function writeLabelChanges(db: Db, changes: LabelChange[]): Promise<void> {
  if (changes.length === 0) return;
  const values = Prisma.join(changes.map((c) => Prisma.sql`(${c.id}, ${c.oldPlatforms}::text[], ${c.platforms}::text[], ${c.consoles}::text[])`));
  await db.$executeRaw`
    UPDATE "Game" AS g
    SET platforms = v.plats, consoles = ARRAY(SELECT DISTINCT c FROM unnest(g.consoles || v.cons) c ORDER BY c)
    FROM (VALUES ${values}) AS v(id, old, plats, cons)
    WHERE g.id = v.id AND g.platforms = v.old`;
}

/** Step 2: adds the consoles to the ones the rows hold now (merged in SQL, as enrich does). */
export async function mergeConsoles(db: Db, changes: { id: string; consoles: string[] }[]): Promise<void> {
  if (changes.length === 0) return;
  const values = Prisma.join(changes.map((c) => Prisma.sql`(${c.id}, ${c.consoles}::text[])`));
  await db.$executeRaw`
    UPDATE "Game" AS g
    SET consoles = ARRAY(SELECT DISTINCT c FROM unnest(g.consoles || v.cons) c ORDER BY c)
    FROM (VALUES ${values}) AS v(id, cons) WHERE g.id = v.id`;
}

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getPsn } from "@/lib/integrations";
import { platformCredential } from "@/lib/integrations/availability";
import { PsnAuthError, PsnHttpError } from "@/lib/integrations/psn/client";
import type { PsnApi, PsnServiceName } from "@/lib/integrations/psn/types";
import { definitionsProblem, type TierCounts } from "@/lib/trophies/psn-definitions";

/**
 * PSN trophies of lists nobody on Tralked owns, read when the game page is opened (front e of the
 * trophy unification), the way RetroAchievements sets are (lib/sync/retro-achievements.ts). The
 * psn-catalog worker only keeps a light PsnCatalogList row per Sony list and matchPsnCatalog turns
 * it into a TrophyList without trophies; storing every list's trophies (~1.5 M rows) would not fit
 * the 1 GB of the free Neon plan, so a list's definitions are read once, on its first open.
 *
 * The page open is public, so the traffic to Sony (the service account is the scan's) is bounded:
 * - one list and one Sony request per call;
 * - a list is claimed first (`trophiesSyncedAt`), so concurrent opens cost one request; a claim
 *   with no rows after PSN_CLAIM_MS is a crashed instance's and is due again, counted as a failed
 *   attempt (the backoff below applies to it);
 * - a failed list waits PSN_RETRY_MS[attempts - 1] before it is due again, and lists never tried
 *   go first, so one failing list does not hold back the game's other lists;
 * - a site-wide budget (`psn-open-budget`): at most PSN_OPEN_PER_MINUTE reads a minute and
 *   PSN_OPEN_PER_DAY a day (the day cap also bounds the growth of the database, ~1.4 MB a day);
 * - no read at all once the database passes PSN_DB_SIZE_LIMIT_BYTES (the free Neon plan has 1 GB),
 *   a size each instance reads at most once every PSN_DB_SIZE_CHECK_MS;
 * - a 429, 5xx, 403 or authentication error from Sony stops every open for PSN_COOLDOWN_MS
 *   (`psn-open-cooldown`); opens also wait while the psn-catalog scan's own 4 h pause holds
 *   (`psn-scan-cooldown`, written when Sony throttles the scan). The scan skips its slots on its
 *   own key only, so one refused page open never costs a 50-minute scan slot.
 * A Sony failure is "try later": nothing is written and the call never throws.
 */

export type PsnTrophiesResult =
  /** A list's definitions were written. */
  | "loaded"
  /** Nothing was due (already read, backing off, over budget, cooling down, or PSN not configured). */
  | "none"
  /** Sony failed or answered something that cannot be the list's: nothing written, tried again later. */
  | "failed";

/** Waits after the 1st, 2nd, 3rd and later failures of a list. */
export const PSN_RETRY_MS = [3_600_000, 6 * 3_600_000, 24 * 3_600_000, 7 * 24 * 3_600_000];
/** A claim older than this with no trophies stored is a crashed read: due again. */
export const PSN_CLAIM_MS = 10 * 60_000;
/** Pause of every page-open read after Sony refused or failed. */
export const PSN_COOLDOWN_MS = 3_600_000;
export const PSN_OPEN_PER_MINUTE = 6;
export const PSN_OPEN_PER_DAY = 100;
/** Over this database size (pg_database_size) page opens read nothing more. */
export const PSN_DB_SIZE_LIMIT_BYTES = 900 * 1024 * 1024;
/** How long an instance trusts the size it read. */
export const PSN_DB_SIZE_CHECK_MS = 3_600_000;
export const PSN_OPEN_BUDGET_KEY = "psn-open-budget";
/** The page opens' pause (1 h after a Sony failure on an open). */
export const PSN_OPEN_COOLDOWN_KEY = "psn-open-cooldown";
/** The psn-catalog scan's pause (4 h after Sony throttled a slice); page opens respect it too. */
export const PSN_SCAN_COOLDOWN_KEY = "psn-scan-cooldown";
/** The pauses a page open waits for. */
const OPEN_PAUSES = [PSN_OPEN_COOLDOWN_KEY, PSN_SCAN_COOLDOWN_KEY] as const;

type Due = { externalId: string; serviceName: string; tiers: unknown };

/**
 * The lists of `gameId` (catalog rows `p`, their TrophyList `t`) whose trophies a page open may read now:
 * never tried, or failed and past the wait of its attempts, or claimed so long ago that the reader
 * crashed (a takeover counts as an attempt, so a read that keeps crashing backs off too).
 */
const dueWhere = (gameId: string, now: Date) => {
  const [h1, h2, h3, h4] = PSN_RETRY_MS;
  const wait = Prisma.sql`(CASE WHEN p."trophiesAttempts" <= 0 THEN 0::double precision
      WHEN p."trophiesAttempts" = 1 THEN ${h1}::double precision WHEN p."trophiesAttempts" = 2 THEN ${h2}::double precision
      WHEN p."trophiesAttempts" = 3 THEN ${h3}::double precision ELSE ${h4}::double precision END)`;
  return Prisma.sql`
    t."gameId" = ${gameId} AND p."trophyCount" > 0
    AND NOT EXISTS (SELECT 1 FROM "Achievement" a WHERE a."listId" = t.id)
    AND (
      (p."trophiesSyncedAt" IS NULL AND (p."trophiesTriedAt" IS NULL
          OR p."trophiesTriedAt" + ${wait} * interval '1 millisecond' <= ${now}))
      OR (p."trophiesSyncedAt" IS NOT NULL
          AND p."trophiesSyncedAt" + GREATEST(${PSN_CLAIM_MS}::double precision, ${wait}) * interval '1 millisecond' <= ${now}))`;
};

/** True when the game has a PSN catalog list whose trophies a page open would read now. */
export async function hasPsnCatalogTrophiesDue(gameId: string, now: Date = new Date()): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ one: number }[]>(Prisma.sql`
    SELECT 1 AS one FROM "PsnCatalogList" p
    JOIN "TrophyList" t ON t.platform = 'psn' AND t."externalId" = p.id
    WHERE ${dueWhere(gameId, now)} LIMIT 1`);
  return rows.length > 0;
}

/**
 * Claims (one statement) and returns the first due list of the game, never-tried ones first. Under
 * concurrency the others wait for the winner's row lock, re-check the claim and get nothing.
 */
async function claim(gameId: string, now: Date): Promise<Due | null> {
  const rows = await prisma.$queryRaw<{ id: string; serviceName: string; tiers: unknown }[]>(Prisma.sql`
    UPDATE "PsnCatalogList" c SET "trophiesSyncedAt" = ${now},
      "trophiesAttempts" = c."trophiesAttempts" + CASE WHEN c."trophiesSyncedAt" IS NULL THEN 0 ELSE 1 END
    WHERE c.id = (
        SELECT p.id FROM "PsnCatalogList" p
        JOIN "TrophyList" t ON t.platform = 'psn' AND t."externalId" = p.id
        WHERE ${dueWhere(gameId, now)}
        ORDER BY p."trophiesAttempts", p.id LIMIT 1)
      AND (c."trophiesSyncedAt" IS NULL OR c."trophiesSyncedAt" <= ${new Date(now.getTime() - PSN_CLAIM_MS)})
    RETURNING c.id, c."serviceName", c.tiers`);
  return rows[0] ? { externalId: rows[0].id, serviceName: rows[0].serviceName, tiers: rows[0].tiers } : null;
}

/**
 * Epoch ms until which the pauses `keys` hold (the latest of them), or null when none holds at
 * `now`. Page opens read both pauses (the default); the psn-catalog worker reads only its own.
 */
export async function psnCooldownUntil(
  now: Date = new Date(),
  db: Pick<Prisma.TransactionClient, "syncCursor"> = prisma,
  keys: readonly string[] = OPEN_PAUSES,
): Promise<number | null> {
  const rows = await db.syncCursor.findMany({ where: { key: { in: [...keys] } } });
  const untils = rows
    .map((row) => Number((row.value as { until?: unknown } | null)?.until))
    .filter((until) => Number.isFinite(until) && until > now.getTime());
  return untils.length ? Math.max(...untils) : null;
}

/**
 * Starts the pause `key` (the page opens' by default) until `until` (epoch ms). One statement; a
 * pause of that key already running longer is kept.
 */
export async function startPsnCooldown(
  until: number,
  db: Pick<Prisma.TransactionClient, "$executeRaw"> = prisma,
  key: string = PSN_OPEN_COOLDOWN_KEY,
): Promise<void> {
  const value = JSON.stringify({ until });
  await db.$executeRaw`
    INSERT INTO "SyncCursor" AS s (key, value, "updatedAt") VALUES (${key}, ${value}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET "updatedAt" = now(), value = CASE
      WHEN s.value->>'until' ~ '^[0-9]+$' AND (s.value->>'until')::bigint >= ${until}::bigint THEN s.value
      ELSE EXCLUDED.value END`;
}

/** Bytes of the current database (one cheap catalog read). */
const readDatabaseBytes = async (): Promise<number> =>
  Number((await prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`)[0]?.bytes ?? 0);

let sizeCache: { at: number; bytes: number; read: () => Promise<number> } | null = null;

/** Forgets the size this instance read (tests). */
export function resetPsnDbSizeCache(): void {
  sizeCache = null;
}

/**
 * True when the database is over PSN_DB_SIZE_LIMIT_BYTES, by a size read at most once every
 * PSN_DB_SIZE_CHECK_MS per instance. A failed read counts as too big (and is not kept).
 */
async function databaseTooBig(now: Date, read: () => Promise<number>): Promise<boolean> {
  if (!sizeCache || sizeCache.read !== read || now.getTime() - sizeCache.at >= PSN_DB_SIZE_CHECK_MS || now.getTime() < sizeCache.at) {
    try {
      sizeCache = { at: now.getTime(), bytes: await read(), read };
    } catch (error) {
      console.warn(`PSN page open: database size unknown: ${error instanceof Error ? error.message : String(error)}`);
      return true;
    }
  }
  return sizeCache.bytes > PSN_DB_SIZE_LIMIT_BYTES;
}

/**
 * Takes one read from the site-wide budget (one atomic statement; false when the minute or the day
 * is used up). The row holds the start and count of the current minute and day.
 */
export async function takePsnOpenBudget(now: Date = new Date()): Promise<boolean> {
  const ms = now.getTime();
  const zero = { windowStart: ms, count: 0, dayStart: ms, dayCount: 0 };
  await prisma.$executeRaw`
    INSERT INTO "SyncCursor" (key, value, "updatedAt") VALUES (${PSN_OPEN_BUDGET_KEY}, ${JSON.stringify(zero)}::jsonb, ${now})
    ON CONFLICT (key) DO NOTHING`;
  const taken = await prisma.$queryRaw<{ one: number }[]>`
    WITH o AS (
      SELECT (value->>'windowStart')::bigint AS ws, (value->>'count')::int AS cnt,
             (value->>'dayStart')::bigint AS ds, (value->>'dayCount')::int AS dc
      FROM "SyncCursor" WHERE key = ${PSN_OPEN_BUDGET_KEY} FOR UPDATE)
    UPDATE "SyncCursor" s SET "updatedAt" = ${now}, value = jsonb_build_object(
      'windowStart', CASE WHEN o.ws + 60000 <= ${ms}::bigint THEN ${ms}::bigint ELSE o.ws END,
      'count', CASE WHEN o.ws + 60000 <= ${ms}::bigint THEN 1 ELSE o.cnt + 1 END,
      'dayStart', CASE WHEN o.ds + 86400000 <= ${ms}::bigint THEN ${ms}::bigint ELSE o.ds END,
      'dayCount', CASE WHEN o.ds + 86400000 <= ${ms}::bigint THEN 1 ELSE o.dc + 1 END)
    FROM o
    WHERE s.key = ${PSN_OPEN_BUDGET_KEY}
      AND (o.ws + 60000 <= ${ms}::bigint OR o.cnt < ${PSN_OPEN_PER_MINUTE}::int)
      AND (o.ds + 86400000 <= ${ms}::bigint OR o.dc < ${PSN_OPEN_PER_DAY}::int)
    RETURNING 1 AS one`;
  return taken.length > 0;
}

/** Gives back a unit taken by takePsnOpenBudget when no Sony call followed (another open won the claim). */
export async function refundPsnOpenBudget(now: Date): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "SyncCursor" SET "updatedAt" = ${now}, value = jsonb_set(jsonb_set(value,
        '{count}', to_jsonb(GREATEST((value->>'count')::int - 1, 0))),
        '{dayCount}', to_jsonb(GREATEST((value->>'dayCount')::int - 1, 0)))
    WHERE key = ${PSN_OPEN_BUDGET_KEY}`;
}

const tiersOf = (value: unknown): TierCounts => {
  const v = (value ?? {}) as Partial<TierCounts>;
  return { bronze: v.bronze ?? 0, silver: v.silver ?? 0, gold: v.gold ?? 0, platinum: v.platinum ?? 0 };
};

/** Sony refusing or failing (not a wrong answer): every page open pauses. */
const isSonyDown = (error: unknown) =>
  error instanceof PsnAuthError ||
  (error instanceof PsnHttpError && (error.status === 429 || error.status === 403 || error.status >= 500));

/**
 * Reads the definitions of the game's first PSN catalog list that is due and stores them as
 * Achievement rows of its TrophyList (the fields the player sync writes, without any progress:
 * no rarity, no unlocks). A player's sync of the same list later finds these rows by
 * (listId, apiName), so it fills in the rarity and the unlocks without duplicating anything.
 * The answer must pass `definitionsProblem` against the catalog's counts, as in the sync.
 * Without `api`, the service account's client is used, and nothing is read when PSN has no credential.
 * `databaseBytes` replaces the database size read (tests).
 */
export async function loadPsnCatalogTrophies(
  gameId: string,
  api?: Pick<PsnApi, "getListTrophies">,
  now: Date = new Date(),
  { databaseBytes = readDatabaseBytes }: { databaseBytes?: () => Promise<number> } = {},
): Promise<PsnTrophiesResult> {
  if (!api && !platformCredential("psn")) return "none"; // offline fixtures have no lists to read
  // Cheap gates first: nothing due costs one read; no Sony call while cooling down, with the
  // database near its plan's size, or over budget.
  if (!(await hasPsnCatalogTrophiesDue(gameId, now))) return "none";
  if ((await psnCooldownUntil(now)) !== null) return "none";
  if (await databaseTooBig(now, databaseBytes)) return "none";
  if (!(await takePsnOpenBudget(now))) return "none";
  const due = await claim(gameId, now);
  if (!due) {
    await refundPsnOpenBudget(now); // no Sony call will happen
    return "none";
  }

  const giveBack = () =>
    prisma.psnCatalogList
      .update({ where: { id: due.externalId }, data: { trophiesSyncedAt: null, trophiesTriedAt: now, trophiesAttempts: { increment: 1 } } })
      .catch(() => undefined);
  try {
    const service: PsnServiceName = due.serviceName === "trophy" ? "trophy" : "trophy2";
    // Resolved after the claim: an unconfigured PSN (PlatformNotConfiguredError) gives it back like any failure.
    const trophies = await (api ?? getPsn()).getListTrophies(due.externalId, service);
    if (!trophies) throw new Error("Sony has no trophies for the list");
    const problem = definitionsProblem(due.externalId, tiersOf(due.tiers), trophies);
    if (problem) throw new Error(`the answer does not match the list: ${problem}`);

    await prisma.$transaction(async (tx) => {
      const list = await tx.trophyList.findUniqueOrThrow({
        where: { platform_externalId: { platform: "psn", externalId: due.externalId } },
        select: { id: true, gameId: true },
      });
      await tx.achievement.createMany({
        data: trophies.map((t) => ({
          gameId: list.gameId,
          platform: "psn",
          listId: list.id,
          apiName: t.trophyId,
          name: t.name,
          description: t.description,
          iconUrl: t.iconUrl,
          hidden: t.hidden,
          globalPct: t.rarityPct,
          trophyTier: t.tier,
          points: null,
        })),
        skipDuplicates: true,
      });
      await tx.psnCatalogList.update({ where: { id: due.externalId }, data: { trophiesAttempts: 0 } });
    });
    return "loaded";
  } catch (error) {
    await giveBack();
    if (isSonyDown(error)) await startPsnCooldown(now.getTime() + PSN_COOLDOWN_MS).catch(() => undefined);
    console.warn(`PSN trophies of ${due.externalId} (page open): ${error instanceof Error ? error.message : String(error)}`);
    return "failed";
  }
}

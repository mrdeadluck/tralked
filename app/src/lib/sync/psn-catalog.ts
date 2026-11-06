import { prisma } from "@/lib/db";
import { PsnAuthError, PsnHttpError } from "@/lib/integrations/psn/client";
import type { PsnApi, PsnListInfo, PsnServiceName } from "@/lib/integrations/psn/types";
import { ensureTrophyList, psnConsoleCode } from "@/lib/trophies/lists";
import { candidateFamilies } from "./igdb-games";
import { candidatesByName } from "./retro-catalog";

/**
 * The PSN trophy-list index (front e of the trophy unification), filled weekly-ish by the
 * psn-catalog worker (scripts/psn-catalog-worker.ts):
 * 1. `scanPsnIds`: walks the npCommunicationIds `NPWR00001_00`, `NPWR00002_00`, … and asks Sony's
 *    `trophyGroups` for each (no player involved): name, platform and trophy counts go into the
 *    light PsnCatalogList table. Trophies are never read here; the game page reads them on demand.
 * 2. `matchPsnCatalog`: a list whose normalized name is that of exactly one PlayStation-family
 *    catalog game becomes a TrophyList (without trophies) of that game, plus its GamePlatformLink.
 *
 * Only the `_00` suffix is walked; `_01` and above (rare sub-sets) are not read yet.
 * The Sony API is unofficial and the service account is the one the player syncs use, so the
 * scan is slow on purpose: one request every 2 s, and a clean stop on 429/5xx.
 */

/** The SyncCursor of the scan: `{ next, misses, service, completedAt }`. */
export const PSN_SCAN_CURSOR = "psn-catalog-scan";
/** Least time between two Sony requests (0.5 requests/s). Enforced inside `scanPsnIds`. */
export const PSN_MIN_GAP_MS = 2000;
/**
 * The scan has no fixed ceiling: it ends a lap after this many consecutive ids with no list on
 * either service (the real ceiling was ~60.5k ids in 11/2026, with ~35% holes in between).
 */
export const PSN_MISS_LIMIT = 2000;
/** Rows written per transaction. */
export const PSN_WRITE_BATCH = 50;
/** Waits after a 429/5xx/timeout before asking the same id again; when they run out the slice ends. */
export const PSN_BACKOFF_MS = [5_000, 15_000, 45_000];
const MAX_WAIT_MS = 120_000;
/** A list left unmatched (unknown or ambiguous name) is looked at again after this long. */
const RETRY_MS = 30 * 24 * 3_600_000;

export const npwrId = (n: number) => `NPWR${String(n).padStart(5, "0")}_00`;

export type PsnLog = { info(message: string): void; warn(message: string): void };
const quiet: PsnLog = { info: () => {}, warn: () => {} };

type CatalogApi = Pick<PsnApi, "getListInfo">;
type Cursor = { next: number; misses: number; service: PsnServiceName; completedAt: string | null };

export type ScanStop = "count" | "deadline" | "ceiling" | "throttled" | "forbidden";
export type ScanResult = { scanned: number; hits: number; next: number; stopped: ScanStop };

export type ScanOptions = {
  api: CatalogApi;
  /** First id number; default: where the last slice stopped (cursor), or 1. */
  from?: number;
  /** Ids to walk at most. */
  count: number;
  /** Epoch ms after which no further id is started. */
  deadline: number;
  log?: PsnLog;
  /** Injectable for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

async function readCursor(): Promise<Cursor> {
  const row = await prisma.syncCursor.findUnique({ where: { key: PSN_SCAN_CURSOR } });
  const v = (row?.value ?? {}) as Partial<Cursor>;
  return {
    next: Number.isInteger(v.next) && v.next! >= 1 ? v.next! : 1,
    misses: Number.isInteger(v.misses) && v.misses! >= 0 ? v.misses! : 0,
    service: v.service === "trophy" ? "trophy" : "trophy2",
    completedAt: typeof v.completedAt === "string" ? v.completedAt : null,
  };
}

type Row = { id: string; name: string; console: string | null; serviceName: string; trophyCount: number; tiers: string };

/** Rows and cursor in one transaction: the cursor never gets ahead of what is written. */
async function flush(rows: Row[], cursor: Cursor): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (rows.length > 0) {
      await tx.$executeRaw`
        INSERT INTO "PsnCatalogList" AS p (id, name, console, "serviceName", "trophyCount", tiers, "checkedAt")
        SELECT x.id, x.name, x.console, x.service, x.n, x.tiers::jsonb, ${new Date().toISOString()}::timestamp
        FROM unnest(
          ${rows.map((r) => r.id)}::text[], ${rows.map((r) => r.name)}::text[], ${rows.map((r) => r.console)}::text[],
          ${rows.map((r) => r.serviceName)}::text[], ${rows.map((r) => r.trophyCount)}::int[], ${rows.map((r) => r.tiers)}::text[]
        ) AS x(id, name, console, service, n, tiers)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, console = EXCLUDED.console, "serviceName" = EXCLUDED."serviceName",
          "trophyCount" = EXCLUDED."trophyCount", tiers = EXCLUDED.tiers, "checkedAt" = EXCLUDED."checkedAt",
          "matchedAt" = CASE WHEN p.name IS DISTINCT FROM EXCLUDED.name THEN NULL ELSE p."matchedAt" END`;
    }
    await tx.syncCursor.upsert({
      where: { key: PSN_SCAN_CURSOR },
      create: { key: PSN_SCAN_CURSOR, value: cursor },
      update: { value: cursor },
    });
  });
}

const rowOf = (info: PsnListInfo): Row => ({
  id: info.npTitleId,
  name: info.name,
  console: psnConsoleCode(info.platform),
  serviceName: info.serviceName,
  trophyCount: Object.values(info.trophyCounts).reduce((a, b) => a + b, 0),
  tiers: JSON.stringify(info.trophyCounts),
});

/**
 * Walks up to `count` ids from `from` (or the cursor), asking `trophyGroups` of each on the service
 * that answered last and then on the other, one request at a time and at least PSN_MIN_GAP_MS
 * apart. Rows are written PSN_WRITE_BATCH at a time together with the cursor. A 429, 5xx or
 * timeout is retried after PSN_BACKOFF_MS; when that runs out (or on a 403) the slice ends with
 * the cursor on the id that failed. A lap ends after PSN_MISS_LIMIT consecutive ids with no list:
 * the cursor then goes back to 1 with `completedAt` set.
 */
export async function scanPsnIds({
  api,
  from,
  count,
  deadline,
  log = quiet,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: ScanOptions): Promise<ScanResult> {
  const saved = await readCursor();
  let position = from ?? saved.next;
  let misses = from === undefined ? saved.misses : 0;
  let service = saved.service;
  let lastRequestAt = -Infinity;

  /** One request, paced; null = not found on that service. Throws PsnHttpError when Sony keeps refusing. */
  const ask = async (id: string, on: PsnServiceName): Promise<PsnListInfo | null> => {
    for (let attempt = 0; ; attempt++) {
      const wait = lastRequestAt + PSN_MIN_GAP_MS - now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = now();
      try {
        return await api.getListInfo(id, on);
      } catch (error) {
        if (error instanceof PsnAuthError) throw error;
        const status = error instanceof PsnHttpError ? error.status : null;
        if (status !== null && status < 500 && status !== 429) throw error;
        const backoff = PSN_BACKOFF_MS[attempt];
        if (backoff === undefined) throw error;
        const pause = Math.min(Math.max(backoff, error instanceof PsnHttpError ? (error.retryAfterMs ?? 0) : 0), MAX_WAIT_MS);
        log.warn(`PSN ${id} (${on}): ${error instanceof Error ? error.message : String(error)}; waiting ${Math.round(pause / 1000)} s`);
        await sleep(pause);
      }
    }
  };

  const pending: Row[] = [];
  const cursorAt = (next: number): Cursor => ({ next, misses, service, completedAt: saved.completedAt });
  let scanned = 0;
  let hits = 0;
  let stopped: ScanStop = "count";

  try {
    while (true) {
      if (scanned >= count) break;
      if (now() >= deadline) {
        stopped = "deadline";
        break;
      }
      const id = npwrId(position);
      const other: PsnServiceName = service === "trophy2" ? "trophy" : "trophy2";
      let info: PsnListInfo | null;
      try {
        info = (await ask(id, service)) ?? (await ask(id, other));
      } catch (error) {
        if (error instanceof PsnAuthError) throw error;
        const status = error instanceof PsnHttpError ? error.status : null;
        stopped = status !== null && status < 500 && status !== 429 ? "forbidden" : "throttled";
        log.warn(`PSN catalog scan ends at ${id}: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
      position++;
      scanned++;
      if (info) {
        hits++;
        misses = 0;
        service = info.serviceName;
        pending.push(rowOf(info));
      } else {
        misses++;
      }
      if (misses >= PSN_MISS_LIMIT) {
        stopped = "ceiling";
        break;
      }
      if (pending.length >= PSN_WRITE_BATCH) await flush(pending.splice(0), cursorAt(position));
    }
  } finally {
    // Whatever stopped the loop (even an auth error), what was read is kept.
    if (stopped === "ceiling") {
      await flush(pending.splice(0), { next: 1, misses: 0, service: "trophy2", completedAt: new Date().toISOString() });
    } else {
      await flush(pending.splice(0), cursorAt(position));
    }
  }
  return { scanned, hits, next: stopped === "ceiling" ? 1 : position, stopped };
}

export type MatchResult = { linked: number; ambiguous: number; unmatched: number; existing: number };
export type MatchOptions = { stopAt?: number; now?: () => Date; log?: PsnLog };

type QueueRow = { id: string; name: string; console: string | null; serviceName: string; trophyCount: number };

/**
 * Links the catalog lists nobody has linked yet to catalog games: the list's name (as the catalog
 * folds names) must belong to exactly one game of the PlayStation family. Then a TrophyList without
 * trophies (through ensureTrophyList, so the console and region rules hold) and the psn
 * GamePlatformLink are created, 50 lists per transaction. A list that already is a TrophyList or
 * GamePlatformLink (a player's) is never touched. The ones left unmatched wait 30 days.
 */
export async function matchPsnCatalog({ stopAt = Infinity, now = () => new Date() }: MatchOptions = {}): Promise<MatchResult> {
  const result: MatchResult = { linked: 0, ambiguous: 0, unmatched: 0, existing: 0 };
  while (Date.now() < stopAt) {
    const at = now();
    const queue = await prisma.$queryRaw<QueueRow[]>`
      SELECT c.id, c.name, c.console, c."serviceName", c."trophyCount" FROM "PsnCatalogList" c
      WHERE c."matchedAt" IS NULL
         OR (c."matchedAt" < ${new Date(at.getTime() - RETRY_MS)}
             AND NOT EXISTS (SELECT 1 FROM "TrophyList" t WHERE t.platform = 'psn' AND t."externalId" = c.id))
      ORDER BY c.id LIMIT ${PSN_WRITE_BATCH}`;
    if (queue.length === 0) break;
    const part = await matchChunk(queue, at);
    result.linked += part.linked;
    result.ambiguous += part.ambiguous;
    result.unmatched += part.unmatched;
    result.existing += part.existing;
  }
  return result;
}

async function matchChunk(queue: QueueRow[], at: Date): Promise<MatchResult> {
  const result: MatchResult = { linked: 0, ambiguous: 0, unmatched: 0, existing: 0 };
  await prisma.$transaction(
    async (tx) => {
      const ids = queue.map((r) => r.id);
      const taken = new Set([
        ...(await tx.trophyList.findMany({ where: { platform: "psn", externalId: { in: ids } }, select: { externalId: true } })).map((l) => l.externalId),
        ...(await tx.gamePlatformLink.findMany({ where: { platform: "psn", externalId: { in: ids } }, select: { externalId: true } })).map((l) => l.externalId),
      ]);
      const open = queue.filter((r) => !taken.has(r.id));
      result.existing += queue.length - open.length;
      const byName = await candidatesByName(tx, [...new Set(open.map((r) => r.name))]);

      for (const row of open) {
        const games = new Set(
          (byName.get(row.name) ?? []).filter((c) => candidateFamilies(c).has("PLAYSTATION")).map((c) => c.id),
        );
        if (games.size > 1) result.ambiguous++;
        else if (games.size === 0) result.unmatched++;
        else {
          const gameId = [...games][0];
          await ensureTrophyList(tx, {
            gameId,
            platform: "psn",
            externalId: row.id,
            console: row.console,
            name: row.name,
            serviceName: row.serviceName,
            trophyCount: row.trophyCount,
          });
          await tx.gamePlatformLink.createMany({ data: [{ gameId, platform: "psn", externalId: row.id }], skipDuplicates: true });
          result.linked++;
        }
      }
      await tx.psnCatalogList.updateMany({ where: { id: { in: ids } }, data: { matchedAt: at } });
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
  return result;
}

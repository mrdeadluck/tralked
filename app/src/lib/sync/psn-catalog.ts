import { prisma } from "@/lib/db";
import { PsnAuthError, PsnHttpError } from "@/lib/integrations/psn/client";
import type { PsnApi, PsnListInfo, PsnServiceName } from "@/lib/integrations/psn/types";
import { ensureTrophyList, psnConsoleCode } from "@/lib/trophies/lists";
import { candidateFamilies } from "./igdb-games";
import { candidatesByName } from "./retro-catalog";

/**
 * The PSN trophy-list index (front e of the trophy unification), filled by the psn-catalog worker
 * (scripts/psn-catalog-worker.ts):
 * 1. `scanPsnIds`: walks the npCommunicationIds `NPWR00001_00`, `NPWR00002_00`, … and asks Sony's
 *    `trophyGroups` for each (no player involved): name, platform and trophy counts go into the
 *    light PsnCatalogList table. Trophies are never read here; the game page reads them on demand.
 * 2. `matchPsnCatalog`: a list whose normalized name is that of exactly one PlayStation-family
 *    catalog game becomes a TrophyList (without trophies) of that game, plus its GamePlatformLink.
 *
 * Only the `_00` suffix is walked; `_01` and above (rare sub-sets) are not read yet.
 * The Sony API is unofficial and the service account is the one the player syncs use, so the
 * scan is slow on purpose: one request every 2 s, and a clean stop on 429/5xx.
 * The database is not touched while the scan runs (Neon sleeps): the rows of a slice (about 1,100)
 * are held in memory and written once at its end, together with the cursor.
 */

/** The SyncCursor of the scan: see `Cursor`. */
export const PSN_SCAN_CURSOR = "psn-catalog-scan";
/** Least time between two Sony requests (0.5 requests/s). Enforced inside `scanPsnIds`. */
export const PSN_MIN_GAP_MS = 2000;
/**
 * The scan has no fixed ceiling: it ends a lap after this many consecutive ids with no list on
 * either service (the real ceiling was ~60.5k ids in 11/2026, with ~35% holes in between).
 */
export const PSN_MISS_LIMIT = 2000;
/** Rows per statement of the final write. */
export const PSN_WRITE_BATCH = 50;
/** Waits after a 429/5xx/network error before asking the same id again; when they run out the slice ends. */
export const PSN_BACKOFF_MS = [5_000, 15_000, 45_000];
/**
 * An id Sony refuses with 400/403 in this many slices in a row is skipped by the next one (the
 * scan must not stay on one id forever). 401 and authentication errors are never skipped.
 */
export const PSN_STUCK_RUNS = 3;
/** Ids kept in the cursor's `skipped` list. */
const SKIPPED_CAP = 50;
const MAX_WAIT_MS = 120_000;
/** A list left unmatched (unknown or ambiguous name) is looked at again after this long. */
const RETRY_MS = 30 * 24 * 3_600_000;

export const npwrId = (n: number) => `NPWR${String(n).padStart(5, "0")}_00`;

/**
 * Start times (UTC) of the jobs that write to the database, from app/vercel.json and the
 * workflows: the :17-:19 crons at 0/6/12/18 h, the 03:19-03:22 daily ones (they also cover the
 * Sunday 03:21 retro-catalog), the :23-:29 ones on odd hours (crons, steam-players,
 * platform-import), steam-details at :37 of 2/8/14/20 h, catalog-enrich at 04:37.
 */
const NEIGHBOURS: { hours: (h: number) => boolean; minute: number }[] = [
  { hours: (h) => h % 6 === 0, minute: 17 },
  { hours: (h) => h === 3, minute: 19 },
  { hours: (h) => h % 2 === 1, minute: 23 },
  { hours: (h) => h % 6 === 2, minute: 37 },
  { hours: (h) => h === 4, minute: 37 },
];
/** A slice leaves this long before the next neighbour starts. */
const NEIGHBOUR_MARGIN_MS = 2 * 60_000;
/** Under this much room left the worker does not start a scan. */
const MIN_SLICE_MS = 5 * 60_000;

/** Epoch ms of the first neighbour job starting after `from`. */
function nextNeighbourStart(from: number): number {
  const day = Date.UTC(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth(), new Date(from).getUTCDate());
  let best = Infinity;
  for (let d = 0; d <= 1; d++) {
    for (let h = 0; h < 24; h++) {
      for (const n of NEIGHBOURS) {
        const at = day + d * 86_400_000 + h * 3_600_000 + n.minute * 60_000;
        if (n.hours(h) && at > from && at < best) best = at;
      }
    }
  }
  return best;
}

/**
 * Minutes the worker spends from `start`: the slot's size by the hour it starts in (50; 40 at 04 UTC;
 * 25 at 02/08/14/20 h), cut so that it ends 2 minutes before the next neighbour job starts (GitHub
 * often starts a run 10-30 min late). 0 when under 5 minutes are left: the run exits without scanning.
 */
export function psnSliceMinutes(start: Date): number {
  const hour = start.getUTCHours();
  const base = [2, 8, 14, 20].includes(hour) ? 25 : hour === 4 ? 40 : 50;
  const room = nextNeighbourStart(start.getTime()) - NEIGHBOUR_MARGIN_MS - start.getTime();
  if (room < MIN_SLICE_MS) return 0;
  return Math.min(base, Math.floor(room / 60_000));
}

export type PsnLog = { info(message: string): void; warn(message: string): void };
const quiet: PsnLog = { info: () => {}, warn: () => {} };

type CatalogApi = Pick<PsnApi, "getListInfo">;
/**
 * Where the scan is: `next` id number, the `misses` in a row up to it, the `service` that answered
 * last, `completedAt` of the last finished lap (null while a lap runs), `stuck` (an id refused
 * with 400/403 in `runs` slices in a row) and the ids `skipped` for that reason (newest last).
 */
export type Cursor = {
  next: number;
  misses: number;
  service: PsnServiceName;
  completedAt: string | null;
  stuck?: { id: string; runs: number };
  skipped?: string[];
};

export type ScanStop = "count" | "deadline" | "ceiling" | "throttled" | "forbidden" | "signal";
export type ScanResult = { scanned: number; hits: number; next: number; misses: number; stopped: ScanStop };

export type ScanOptions = {
  api: CatalogApi;
  /** First id number; default: where the last slice stopped (cursor), or 1. */
  from?: number;
  /** Ids to walk at most. */
  count: number;
  /** Epoch ms after which no further id is started. */
  deadline: number;
  /** The cursor already read (`readCursor`); read here when absent. */
  cursor?: Cursor;
  /** True once the process was asked to stop (SIGINT/SIGTERM): the loop ends and the slice is written. */
  shouldStop?: () => boolean;
  log?: PsnLog;
  /** Injectable for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export async function readCursor(): Promise<Cursor> {
  const row = await prisma.syncCursor.findUnique({ where: { key: PSN_SCAN_CURSOR } });
  const v = (row?.value ?? {}) as Partial<Cursor>;
  return {
    next: Number.isInteger(v.next) && v.next! >= 1 ? v.next! : 1,
    misses: Number.isInteger(v.misses) && v.misses! >= 0 ? v.misses! : 0,
    service: v.service === "trophy" ? "trophy" : "trophy2",
    completedAt: typeof v.completedAt === "string" ? v.completedAt : null,
    ...(v.stuck && typeof v.stuck.id === "string" && Number.isInteger(v.stuck.runs) ? { stuck: { id: v.stuck.id, runs: v.stuck.runs } } : {}),
    ...(Array.isArray(v.skipped) ? { skipped: v.skipped.filter((s): s is string => typeof s === "string").slice(-SKIPPED_CAP) } : {}),
  };
}

type Row = { id: string; name: string; console: string | null; serviceName: string; trophyCount: number; tiers: string };

/** Rows (in statements of PSN_WRITE_BATCH) and the cursor, last, in one transaction. */
async function writeSlice(rows: Row[], cursor: Cursor): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const checkedAt = new Date().toISOString();
      for (let i = 0; i < rows.length; i += PSN_WRITE_BATCH) {
        const part = rows.slice(i, i + PSN_WRITE_BATCH);
        await tx.$executeRaw`
          INSERT INTO "PsnCatalogList" AS p (id, name, console, "serviceName", "trophyCount", tiers, "checkedAt")
          SELECT x.id, x.name, x.console, x.service, x.n, x.tiers::jsonb, ${checkedAt}::timestamp
          FROM unnest(
            ${part.map((r) => r.id)}::text[], ${part.map((r) => r.name)}::text[], ${part.map((r) => r.console)}::text[],
            ${part.map((r) => r.serviceName)}::text[], ${part.map((r) => r.trophyCount)}::int[], ${part.map((r) => r.tiers)}::text[]
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
    },
    { timeout: 120_000, maxWait: 60_000 },
  );
}

const rowOf = (info: PsnListInfo): Row => ({
  id: info.npTitleId,
  name: info.name,
  console: psnConsoleCode(info.platform),
  serviceName: info.serviceName,
  trophyCount: Object.values(info.trophyCounts).reduce((a, b) => a + b, 0),
  tiers: JSON.stringify(info.trophyCounts),
});

const NETWORK_CODES = /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR_.*)$/;
/** Timeouts, aborts and dropped connections: worth another try. A TypeError or a JSON parse failure is not. */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  const code = (error as { cause?: { code?: unknown } }).cause?.code;
  return typeof code === "string" && NETWORK_CODES.test(code);
}

/**
 * Walks up to `count` ids from `from` (or the cursor), asking `trophyGroups` of each on the service
 * that answered last and then on the other, one request at a time and at least PSN_MIN_GAP_MS
 * apart. Nothing is written while it walks: the rows found and the cursor are written once, in one
 * transaction, when the loop ends (for any reason, errors included; one retry for a Neon cold
 * start). A 429, 5xx or network error is retried after PSN_BACKOFF_MS; when that runs out the
 * slice ends with the cursor on the id that failed. A 400/403 ends the slice too, and the same id
 * refused in PSN_STUCK_RUNS slices in a row is skipped by the next one. A lap ends after
 * PSN_MISS_LIMIT consecutive ids with no list: the cursor then goes back to 1 with `completedAt`
 * set (cleared again when the next lap starts).
 */
export async function scanPsnIds({
  api,
  from,
  count,
  deadline,
  cursor,
  shouldStop = () => false,
  log = quiet,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: ScanOptions): Promise<ScanResult> {
  const saved = cursor ?? (await readCursor());
  let position = from ?? saved.next;
  let misses = from === undefined ? saved.misses : 0;
  let service = saved.service;
  let stuck = saved.stuck;
  let skipped = saved.skipped ?? [];
  // A new lap forgets the end of the last one.
  const completedAt = position === 1 ? null : saved.completedAt;
  let lastRequestAt = -Infinity;

  /** One request, paced; null = not found on that service. Throws when Sony keeps refusing. */
  const ask = async (id: string, on: PsnServiceName): Promise<PsnListInfo | null> => {
    for (let attempt = 0; ; attempt++) {
      const wait = lastRequestAt + PSN_MIN_GAP_MS - now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = now();
      try {
        return await api.getListInfo(id, on);
      } catch (error) {
        if (error instanceof PsnAuthError) throw error;
        if (error instanceof PsnHttpError) {
          if (error.status !== 429 && error.status < 500) throw error; // 400/401/403 and the like: no retry
        } else if (!isNetworkError(error)) {
          throw error;
        }
        const backoff = PSN_BACKOFF_MS[attempt];
        if (backoff === undefined || shouldStop()) throw error;
        // Retry-After in seconds is honored; an HTTP-date one reads as no header and the normal backoff applies.
        const pause = Math.min(Math.max(backoff, error instanceof PsnHttpError ? (error.retryAfterMs ?? 0) : 0), MAX_WAIT_MS);
        log.warn(`PSN ${id} (${on}): ${error instanceof Error ? error.message : String(error)}; waiting ${Math.round(pause / 1000)} s`);
        await sleep(pause);
      }
    }
  };

  const pending: Row[] = [];
  const cursorAt = (next: number): Cursor => ({
    next,
    misses,
    service,
    completedAt,
    ...(stuck ? { stuck } : {}),
    ...(skipped.length ? { skipped } : {}),
  });
  let scanned = 0;
  let hits = 0;
  let stopped: ScanStop = "count";
  let scanError: unknown;

  try {
    while (true) {
      if (scanned >= count) break;
      if (shouldStop()) {
        stopped = "signal";
        break;
      }
      if (now() >= deadline) {
        stopped = "deadline";
        break;
      }
      const id = npwrId(position);
      if (stuck?.id === id && stuck.runs >= PSN_STUCK_RUNS) {
        log.warn(`PSN ${id} was refused in ${stuck.runs} slices in a row: skipped.`);
        skipped = [...skipped, id].slice(-SKIPPED_CAP);
        stuck = undefined;
        position++;
        scanned++;
        misses++;
        continue;
      }
      const other: PsnServiceName = service === "trophy2" ? "trophy" : "trophy2";
      let info: PsnListInfo | null;
      try {
        info = (await ask(id, service)) ?? (await ask(id, other));
      } catch (error) {
        if (error instanceof PsnAuthError) throw error;
        const status = error instanceof PsnHttpError ? error.status : null;
        if (status === 401 || (status === null && !isNetworkError(error))) throw error; // a bug, not Sony: fail loudly
        if (status === 400 || status === 403) {
          stuck = stuck?.id === id ? { id, runs: stuck.runs + 1 } : { id, runs: 1 };
          stopped = "forbidden";
        } else if (status !== null && status < 500 && status !== 429) {
          throw error; // an unexpected 4xx: not worth guessing
        } else {
          stopped = "throttled";
        }
        log.warn(`PSN catalog scan ends at ${id}: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
      if (stuck?.id === id) stuck = undefined;
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
    }
  } catch (error) {
    scanError = error;
    throw error;
  } finally {
    // Whatever stopped the loop (even an auth error), what was read is kept: one write, retried once.
    const rows = pending.splice(0);
    const final: Cursor =
      stopped === "ceiling"
        ? { next: 1, misses: 0, service: "trophy2", completedAt: new Date().toISOString(), ...(skipped.length ? { skipped } : {}) }
        : cursorAt(position);
    try {
      await writeSlice(rows, final);
    } catch (error) {
      log.warn(`PSN catalog write failed, trying once more: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(5_000);
      try {
        await writeSlice(rows, final);
      } catch (again) {
        log.warn(`PSN catalog write failed again: ${again instanceof Error ? again.message : String(again)}`);
        // The error that ended the scan is the one to report; the write error only when the scan was fine.
        if (scanError === undefined) throw again;
      }
    }
  }
  return { scanned, hits, next: stopped === "ceiling" ? 1 : position, misses: stopped === "ceiling" ? 0 : misses, stopped };
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

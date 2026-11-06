import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { PsnAuthError, PsnHttpError } from "@/lib/integrations/psn/client";
import type { PsnApi, PsnListInfo, PsnServiceName } from "@/lib/integrations/psn/types";
import { ensureTrophyList, psnConsoleCode } from "@/lib/trophies/lists";
import { candidateFamilies } from "./igdb-games";
import { PSN_SCAN_COOLDOWN_KEY, startPsnCooldown } from "./psn-catalog-trophies";
import { candidatesByName, type Candidate } from "./retro-catalog";

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
 * scan is slow on purpose: one request every 3 s (psnawp's 300 per 15 min), and a clean stop on
 * 429/5xx or on a burst of 403s (3 different ids in one slice) that also pauses every Sony call of
 * the site for 4 h (`psn-scan-cooldown`: the worker skips its slots while it holds, and page opens
 * respect it too). A single refused id is passed over and asked again by the next slices; 400s on 3
 * different new ids end the slice as "rejected" (exit 1), without a pause.
 * The database is not touched while the scan runs (Neon sleeps): the rows of a slice (about 700)
 * are held in memory and written once at its end, together with the cursor, in one transaction.
 */

/** The SyncCursor of the scan: see `Cursor`. */
export const PSN_SCAN_CURSOR = "psn-catalog-scan";
/**
 * Least time between two Sony requests: 0.33 requests/s, the 300 per 15 min psnawp keeps to.
 * Enforced inside `scanPsnIds`.
 */
export const PSN_MIN_GAP_MS = 3000;
/**
 * The scan has no fixed ceiling: it ends a lap after this many consecutive ids with no list on
 * either service (the real ceiling was ~60.5k ids in 11/2026, with ~35% holes in between), and
 * never below the highest NPWR id a TrophyList already holds.
 */
export const PSN_MISS_LIMIT = 2000;
/** Lists per transaction of matchPsnCatalog. */
export const PSN_WRITE_BATCH = 50;
/**
 * Pause of every Sony call (scan slots and page opens) after Sony throttled the scan (429/5xx
 * after the retries) or refused PSN_FORBIDDEN_BURST different ids with 403 in one slice.
 */
export const PSN_SCAN_COOLDOWN_MS = 4 * 3_600_000;
/**
 * New ids refused with 403 in one slice that make a burst: the slice stops and Sony pauses
 * (PSN_SCAN_COOLDOWN_MS). Fewer are single lists Sony refuses: passed over, retried later. As many
 * new ids answered 400 end the slice too ("rejected", without a pause): Sony changed its API, and
 * the scan must not walk every id refusing them.
 */
export const PSN_FORBIDDEN_BURST = 3;
/** Waits after a 429/5xx/network error before asking the same id again; when they run out the slice ends. */
export const PSN_BACKOFF_MS = [5_000, 15_000, 45_000];
/**
 * An id Sony refuses with 400/403 in this many slices in a row is skipped by the next one (the
 * scan must not ask one id forever). 401 and authentication errors are never skipped.
 */
export const PSN_STUCK_RUNS = 3;
/** Ids kept in the cursor's `skipped` list. */
const SKIPPED_CAP = 50;
/** Ids kept in the cursor's `refused` list (the oldest beyond it are skipped). */
const REFUSED_CAP = 20;
const MAX_WAIT_MS = 120_000;
/** A list left unmatched (unknown or ambiguous name) is looked at again after this long. */
const RETRY_MS = 30 * 24 * 3_600_000;

export const npwrId = (n: number) => `NPWR${String(n).padStart(5, "0")}_00`;

/**
 * Start times (UTC) of the jobs that write to the database, from app/vercel.json, the workflows
 * and the hourly :28 dispatcher (lib/cron/workers.ts): the :17-:19 crons at 0/6/12/18 h, the
 * 03:19-03:22 daily ones (they also cover the Sunday retro-catalog), the :23-:29 ones on odd hours
 * (crons, steam-players, platform-import), steam-details at :28 of 2/8/14/20 h (its :37 schedule
 * is the fallback) and catalog-enrich at 04:28 (fallback 04:37).
 */
const NEIGHBOURS: { hours: (h: number) => boolean; minute: number }[] = [
  { hours: (h) => h % 6 === 0, minute: 17 },
  { hours: (h) => h === 3, minute: 19 },
  { hours: (h) => h % 2 === 1, minute: 23 },
  { hours: (h) => h % 6 === 2, minute: 28 },
  { hours: (h) => h === 4, minute: 28 },
];
/**
 * platform-import works from :28 of an odd hour for up to 0.8 h (until :16 of the next one): a run
 * that GitHub starts that late does not scan.
 */
const insidePlatformImport = (at: Date) =>
  at.getUTCHours() % 2 === 1 ? at.getUTCMinutes() >= 21 : at.getUTCMinutes() < 17;
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

/** Minutes of a slot (the :20 slots of 0, 6, 10, 12, 16, 18 and 22 h). */
const SLOT_MINUTES = 50;

/**
 * Minutes the worker spends from `start`: 50, cut so that it ends 2 minutes before the next
 * neighbour job starts (GitHub often starts a run 10-30 min late). 0 when under 5 minutes are
 * left, or when it starts inside platform-import's window: the run exits without scanning.
 */
export function psnSliceMinutes(start: Date): number {
  if (insidePlatformImport(start)) return 0;
  const room = nextNeighbourStart(start.getTime()) - NEIGHBOUR_MARGIN_MS - start.getTime();
  if (room < MIN_SLICE_MS) return 0;
  return Math.min(SLOT_MINUTES, Math.floor(room / 60_000));
}

export type PsnLog = { info(message: string): void; warn(message: string): void };
const quiet: PsnLog = { info: () => {}, warn: () => {} };

type CatalogApi = Pick<PsnApi, "getListInfo">;
/**
 * Where the scan is: `next` id number, the `misses` in a row up to it, the `service` that answered
 * last, `completedAt` of the last finished lap (null while a lap runs), the ids `refused` with
 * 400/403 (passed over, asked again at the start of the next slices; `runs`: slices in a row that
 * refused it) and the ids `skipped` after PSN_STUCK_RUNS such slices (newest last).
 */
export type Cursor = {
  next: number;
  misses: number;
  service: PsnServiceName;
  completedAt: string | null;
  refused?: { id: string; runs: number }[];
  skipped?: string[];
};

type Refused = { id: string; runs: number };
const isRefused = (r: unknown): r is Refused =>
  !!r && typeof (r as Refused).id === "string" && Number.isInteger((r as Refused).runs) && (r as Refused).runs >= 0;

export type ScanStop = "count" | "deadline" | "ceiling" | "throttled" | "forbidden" | "rejected" | "signal";
export type ScanResult = {
  scanned: number;
  hits: number;
  next: number;
  misses: number;
  stopped: ScanStop;
  /** Epoch ms of the Sony pause the slice wrote (throttled, or a burst of 403s), else null. */
  cooldownUntil: number | null;
};

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
  /** Highest NPWR number a TrophyList holds (a lap never ends below it); read here when absent. */
  knownCeiling?: number;
  /** True once the process was asked to stop (SIGINT/SIGTERM): the loop ends and the slice is written. */
  shouldStop?: () => boolean;
  log?: PsnLog;
  /** Injectable for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export async function readCursor(): Promise<Cursor> {
  const row = await prisma.syncCursor.findUnique({ where: { key: PSN_SCAN_CURSOR } });
  const v = (row?.value ?? {}) as Partial<Cursor> & { stuck?: unknown };
  // `stuck` (one id) is the cursor's shape before `refused`.
  const refused = Array.isArray(v.refused) ? v.refused.filter(isRefused) : isRefused(v.stuck) ? [v.stuck] : [];
  return {
    next: Number.isInteger(v.next) && v.next! >= 1 ? v.next! : 1,
    misses: Number.isInteger(v.misses) && v.misses! >= 0 ? v.misses! : 0,
    service: v.service === "trophy" ? "trophy" : "trophy2",
    completedAt: typeof v.completedAt === "string" ? v.completedAt : null,
    ...(refused.length ? { refused: refused.slice(-REFUSED_CAP).map((r) => ({ id: r.id, runs: r.runs })) } : {}),
    ...(Array.isArray(v.skipped) ? { skipped: v.skipped.filter((s): s is string => typeof s === "string").slice(-SKIPPED_CAP) } : {}),
  };
}

/** Highest NPWR number among the PSN TrophyLists (0 when none). */
export async function knownPsnCeiling(): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number | null }[]>`
    SELECT max(substring("externalId" from 5 for 5)::int) AS n FROM "TrophyList"
    WHERE platform = 'psn' AND "externalId" ~ '^NPWR[0-9]{5}_[0-9]{2}$'`;
  return Number(rows[0]?.n ?? 0);
}

type Row = { id: string; name: string; console: string | null; serviceName: string; trophyCount: number; tiers: string };

/**
 * The slice's one write, one transaction: the rows (one statement, one row per id: ON CONFLICT
 * cannot touch a row twice), the cursor and, when Sony throttled the slice, the scan's pause.
 */
async function writeSlice(slice: Row[], cursor: Cursor, cooldownUntil: number | null): Promise<void> {
  const rows = [...new Map(slice.map((r) => [r.id, r])).values()];
  await prisma.$transaction(
    async (tx) => {
      const checkedAt = new Date().toISOString();
      if (rows.length > 0) {
        await tx.$executeRaw`
          INSERT INTO "PsnCatalogList" AS p (id, name, console, "serviceName", "trophyCount", tiers, "checkedAt")
          SELECT x.id, x.name, x.console, x.service, x.n, x.tiers::jsonb, ${checkedAt}::timestamp
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
      if (cooldownUntil !== null) await startPsnCooldown(cooldownUntil, tx, PSN_SCAN_COOLDOWN_KEY);
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
 * slice ends with the cursor on the id that failed. An id refused with 400/403 is passed over and
 * kept in the cursor's `refused` list: the next slices ask it again first (read: it leaves the
 * list), and one refused in PSN_STUCK_RUNS slices in a row is skipped. 403s on
 * PSN_FORBIDDEN_BURST new ids in one slice are Sony refusing the account, not lists: the slice
 * stops there, and those refusals do not count toward any id's runs; 400s on as many new ids end
 * it the same way as "rejected" (an API change), without a pause. An id the retries asked is not
 * asked again by the walk (an older cursor's `next` can be it). A slice ended by a 429/5xx (after
 * the retries) or by the 403 burst writes the scan's 4 h pause (PSN_SCAN_COOLDOWN_MS,
 * `psn-scan-cooldown`, which page opens respect too) in its one write; a network error, 400s or
 * fewer 403s do not. A lap ends after PSN_MISS_LIMIT consecutive ids with no list, once past the highest
 * NPWR id a TrophyList holds: the cursor then goes back to 1 with `completedAt` set (cleared again
 * when the next lap starts).
 */
export async function scanPsnIds({
  api,
  from,
  count,
  deadline,
  cursor,
  knownCeiling,
  shouldStop = () => false,
  log = quiet,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: ScanOptions): Promise<ScanResult> {
  const saved = cursor ?? (await readCursor());
  const ceiling = knownCeiling ?? (await knownPsnCeiling());
  let position = from ?? saved.next;
  let misses = from === undefined ? saved.misses : 0;
  let service = saved.service;
  let refused: Refused[] = (saved.refused ?? []).map((r) => ({ ...r }));
  const runsBefore = new Map(refused.map((r) => [r.id, r.runs]));
  let skipped = saved.skipped ?? [];
  /** New ids refused with 403 / answered 400 in this slice (the slice ends at PSN_FORBIDDEN_BURST). */
  const forbiddenNew = new Set<string>();
  const rejectedNew = new Set<string>();
  /** What the retries at the slice's start made of each refused id: the walk never asks it again. */
  const retried = new Map<string, "hit" | "miss" | "refused" | "skipped">();
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
    ...(refused.length ? { refused } : {}),
    ...(skipped.length ? { skipped } : {}),
  });
  let scanned = 0;
  let hits = 0;
  // Set inside the closures below too: the cast keeps TypeScript from narrowing it to "count".
  let stopped = "count" as ScanStop;
  /** HTTP status that ended a throttled slice; null for a network error. */
  let stopStatus: number | null = null;
  let cooldownUntil: number | null = null;
  let scanError: unknown;

  /** Should the slice stop before the next request: a signal or the deadline. */
  const halted = (): boolean => {
    if (shouldStop()) stopped = "signal";
    else if (now() >= deadline) stopped = "deadline";
    else return false;
    return true;
  };
  /** Status of the last refusal `read` answered (400 or 403). */
  let lastRefusal = 0;
  /**
   * Asks one id on both services. "refused" for a 400/403; a 429/5xx after the retries or a
   * network error sets `stopped` ("throttled") and answers "stop"; anything else throws.
   */
  const read = async (id: string): Promise<PsnListInfo | null | "refused" | "stop"> => {
    const other: PsnServiceName = service === "trophy2" ? "trophy" : "trophy2";
    try {
      return (await ask(id, service)) ?? (await ask(id, other));
    } catch (error) {
      if (error instanceof PsnAuthError) throw error;
      const status = error instanceof PsnHttpError ? error.status : null;
      if (status === 401 || (status === null && !isNetworkError(error))) throw error; // a bug, not Sony: fail loudly
      const message = error instanceof Error ? error.message : String(error);
      if (status === 400 || status === 403) {
        log.warn(`PSN ${id} refused: ${message}`);
        lastRefusal = status;
        return "refused";
      }
      if (status !== null && status < 500 && status !== 429) throw error; // an unexpected 4xx: not worth guessing
      stopStatus = status;
      stopped = "throttled";
      log.warn(`PSN catalog scan ends at ${id}: ${message}`);
      return "stop";
    }
  };
  const found = (info: PsnListInfo) => {
    hits++;
    service = info.serviceName;
    pending.push(rowOf(info));
  };

  try {
    // First the ids refused by earlier slices: skipped after PSN_STUCK_RUNS slices, else asked again.
    let walk = true;
    for (const r of [...refused]) {
      if (r.runs >= PSN_STUCK_RUNS) {
        log.warn(`PSN ${r.id} was refused in ${r.runs} slices in a row: skipped.`);
        skipped = [...skipped, r.id].slice(-SKIPPED_CAP);
        refused = refused.filter((x) => x !== r);
        retried.set(r.id, "skipped");
        continue;
      }
      if (halted()) {
        walk = false;
        break;
      }
      const answer = await read(r.id);
      if (answer === "stop") {
        walk = false;
        break;
      }
      if (answer === "refused") r.runs++;
      else {
        refused = refused.filter((x) => x !== r);
        if (answer) found(answer);
      }
      retried.set(r.id, answer === "refused" ? "refused" : answer ? "hit" : "miss");
    }
    while (walk) {
      if (scanned >= count) break;
      if (halted()) break;
      const id = npwrId(position);
      // An id the retries above already asked (an older cursor's `next` can be its stuck id): its
      // outcome stands, no second request and no second run.
      const before = retried.get(id);
      const answer = before === undefined ? await read(id) : before === "hit" ? "hit" : before === "miss" ? null : "known";
      if (answer === "stop") break;
      position++;
      scanned++;
      if (answer === "known") continue;
      if (answer === "hit") {
        misses = 0;
        continue;
      }
      if (answer === "refused") {
        // Passed over, asked again by the next slices; not a miss (its list is unknown).
        const known = refused.find((r) => r.id === id);
        if (known) known.runs++;
        else refused.push({ id, runs: 1 });
        if (!runsBefore.has(id)) (lastRefusal === 403 ? forbiddenNew : rejectedNew).add(id);
        if (forbiddenNew.size >= PSN_FORBIDDEN_BURST) {
          stopped = "forbidden";
          log.warn(`PSN catalog scan ends at ${id}: ${forbiddenNew.size} different ids refused with 403 in one slice.`);
          break;
        }
        if (rejectedNew.size >= PSN_FORBIDDEN_BURST) {
          stopped = "rejected";
          log.warn(`PSN catalog scan ends at ${id}: ${rejectedNew.size} different ids answered 400 in one slice (has Sony's API changed?).`);
          break;
        }
        continue;
      }
      if (answer) {
        found(answer);
        misses = 0;
      } else {
        misses++;
      }
      if (misses >= PSN_MISS_LIMIT && position > ceiling) {
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
    // A burst of 403s (or 400s) is Sony refusing the account or changing its API, not those lists:
    // no id's runs count it (the ids it refused are asked again, as never refused).
    if (stopped === "forbidden" || stopped === "rejected") refused = refused.map((r) => ({ id: r.id, runs: runsBefore.get(r.id) ?? 0 }));
    if (refused.length > REFUSED_CAP) {
      const dropped = refused.slice(0, refused.length - REFUSED_CAP);
      log.warn(`PSN catalog: too many refused ids, skipped: ${dropped.map((r) => r.id).join(", ")}`);
      skipped = [...skipped, ...dropped.map((r) => r.id)].slice(-SKIPPED_CAP);
      refused = refused.slice(-REFUSED_CAP);
    }
    // Sony throttling (429/5xx after the retries) or refusing the account (a burst of 403s): the
    // scan's pause (its next slots, and the page opens). A burst of 400s does not pause.
    const throttledBySony =
      (stopped === "throttled" && stopStatus !== null && (stopStatus === 429 || stopStatus >= 500)) || stopped === "forbidden";
    cooldownUntil = throttledBySony ? Date.now() + PSN_SCAN_COOLDOWN_MS : null;
    const final: Cursor =
      stopped === "ceiling"
        ? {
            next: 1,
            misses: 0,
            service: "trophy2",
            completedAt: new Date().toISOString(),
            ...(refused.length ? { refused } : {}),
            ...(skipped.length ? { skipped } : {}),
          }
        : cursorAt(position);
    try {
      await writeSlice(rows, final, cooldownUntil);
    } catch (error) {
      log.warn(`PSN catalog write failed, trying once more: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(5_000);
      try {
        await writeSlice(rows, final, cooldownUntil);
      } catch (again) {
        log.warn(`PSN catalog write failed again: ${again instanceof Error ? again.message : String(again)}`);
        // The error that ended the scan is the one to report; the write error only when the scan was fine.
        if (scanError === undefined) throw again;
      }
    }
  }
  return {
    scanned,
    hits,
    next: stopped === "ceiling" ? 1 : position,
    misses: stopped === "ceiling" ? 0 : misses,
    stopped,
    cooldownUntil,
  };
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
        const gameId = pickPsnMatch(byName.get(row.name) ?? []);
        if (gameId === "ambiguous") result.ambiguous++;
        else if (gameId === null) result.unmatched++;
        else {
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

/**
 * The game a PSN list's name points to, among the catalog games named like it (candidatesByName):
 * the one game of the PlayStation family; "ambiguous" when several are, null when none is.
 */
export function pickPsnMatch(candidates: Candidate[]): string | "ambiguous" | null {
  const games = new Set(candidates.filter((c) => candidateFamilies(c).has("PLAYSTATION")).map((c) => c.id));
  if (games.size > 1) return "ambiguous";
  return games.size === 1 ? [...games][0] : null;
}

export type MatchCheckList = { externalId: string; name: string; gameId: string };
export type MatchCheck = {
  /** PSN TrophyLists looked at. */
  checked: number;
  /** The matcher picks the game the list already belongs to. */
  correct: number;
  /** The matcher picks another game: `matchedGameId` instead of the stored `gameId`. */
  wrong: (MatchCheckList & { matchedGameId: string })[];
  /** No pick (no PlayStation game of that name, or several): `ambiguous` of them had several. */
  noMatch: number;
  ambiguous: number;
};

/**
 * How matchPsnCatalog's pick (candidatesByName + pickPsnMatch) agrees with the game the given PSN
 * TrophyLists (psnListsForCheck: the lists players hold, linked by the sync) belong to, by their names. Reads only
 * (`pnpm psn-catalog:match-check` runs it on a read-only session).
 */
export async function checkPsnMatcher(
  lists: MatchCheckList[],
  db: Prisma.TransactionClient = prisma,
  chunk = 500,
): Promise<MatchCheck> {
  const out: MatchCheck = { checked: 0, correct: 0, wrong: [], noMatch: 0, ambiguous: 0 };
  for (let i = 0; i < lists.length; i += chunk) {
    const part = lists.slice(i, i + chunk);
    const byName = await candidatesByName(db, [...new Set(part.map((l) => l.name))]);
    for (const list of part) {
      out.checked++;
      const pick = pickPsnMatch(byName.get(list.name) ?? []);
      if (pick === list.gameId) out.correct++;
      else if (pick === null || pick === "ambiguous") {
        out.noMatch++;
        if (pick === "ambiguous") out.ambiguous++;
      } else out.wrong.push({ ...list, matchedGameId: pick });
    }
  }
  return out;
}

/**
 * The PSN TrophyLists some player holds (a UserTrophyList: linked to their game by the sync), name
 * and game, for checkPsnMatcher. Lists matchPsnCatalog made and nobody holds are left out, so a
 * re-check after matching ran does not grade the matcher on its own picks.
 */
export async function psnListsForCheck(db: Prisma.TransactionClient = prisma): Promise<MatchCheckList[]> {
  return db.trophyList.findMany({
    where: { platform: "psn", progress: { some: {} } },
    select: { externalId: true, name: true, gameId: true },
    orderBy: { externalId: "asc" },
  });
}

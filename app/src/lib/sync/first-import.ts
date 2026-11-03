import { prisma } from "@/lib/db";
import { platformAvailable } from "@/lib/integrations/availability";
import { steamMode } from "@/lib/integrations/steam";
import type { WithDb } from "@/lib/worker/db-retry";
import { rethrowIfDatabaseDown } from "@/lib/worker/errors";
import { holdImportLease, importKey, releaseImportLease, type ImportLane } from "./import-lease";
import { CODE_PLATFORMS } from "./platform-library";
import { syncPlatformAccount } from "./platform-user";
import { steamBacklogKey, syncUser } from "./user";

/**
 * First imports of any size, run by scripts/platform-import-worker.ts on GitHub Actions instead of
 * the cron's 50 s invocations: a PSN library of 700 games or a Steam one of thousands takes many
 * minutes, and at 5 accounts per 50 s cron run it never finished. Accounts still to import:
 * - PSN, Xbox and RetroAchievements connections whose sync never reached the end of the list
 *   (`lastSyncedAt` null);
 * - Steam users never synced whole, or whose last sync ran out of time (the `steam-backlog:` marker).
 * One lane per platform runs in parallel (each platform's service account reads one account at a
 * time). Each account gets slices of IMPORT_SLICE_MS and goes to the back of its lane after each,
 * so one huge library never holds up a newcomer. The ordinary syncs do the rest: they are resumable
 * and idempotent, so a slice continues where the previous one (or the cron) stopped.
 */

/** Time one account gets before the next in its lane: reading, then writing what was read. */
export const IMPORT_SLICE_MS = 5 * 60_000;
/** An account the cron or a "Sincronizar agora" started this recently is left to finish first. */
export const RECENT_ATTEMPT_MS = 3 * 60_000;
/** Lane wait when its only accounts are being synced by someone else. */
const IDLE_WAIT_MS = 30_000;
/** The lease is renewed this often while the worker runs (it is valid for 15 min). */
const LEASE_RENEW_MS = 5 * 60_000;
/** Candidates read per pick: the stalest first. */
const CANDIDATE_WINDOW = 100;

export type ImportLog = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
};

export type LaneStats = {
  /** Accounts whose import reached the end. */
  finished: number;
  /** Slices run (one sync call each). */
  slices: number;
  /** Accounts left for a later run: private, unlinked, or a slice that changed nothing. */
  stopped: number;
  /** Accounts whose slice threw (outage, refused credential): retried by a later run. */
  failed: number;
};

export type FirstImportOptions = {
  /** Epoch ms after which no slice starts (a slice may still be writing what it read). */
  stopAt: number;
  sliceMs?: number;
  /** Lanes to run (default: every platform with its credential here, see importLanes). */
  lanes?: ImportLane[];
  /** Only these users (tests). */
  only?: string[];
  log?: ImportLog;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Runs each turn of a lane and repeats it when the database connection drops
   * (lib/worker/db-retry.ts); default: once, a lost connection ends the run.
   */
  withDb?: WithDb;
};

/** Platforms this process can read: Steam with its Web API key, the others with their credential. */
export function importLanes(): ImportLane[] {
  return [
    ...(steamMode() === "api" ? (["steam"] as const) : []),
    ...CODE_PLATFORMS.filter(platformAvailable),
  ];
}

type Candidate = { userId: string; lastSyncAttemptAt: Date | null };

/** Accounts of a lane whose import is unfinished, stalest attempt first (never attempted first). */
export async function importCandidates(lane: ImportLane, only?: string[]): Promise<Candidate[]> {
  const userFilter = only ? { in: only } : undefined;
  if (lane === "steam") {
    const prefix = steamBacklogKey("");
    const markers = await prisma.syncCursor.findMany({ where: { key: { startsWith: prefix } }, select: { key: true } });
    const backlog = markers.map((m) => m.key.slice(prefix.length));
    const users = await prisma.user.findMany({
      where: {
        steamId: { not: null },
        OR: [{ lastSyncedAt: null }, { id: { in: backlog } }],
        ...(userFilter && { id: userFilter }),
      },
      orderBy: { lastSyncAttemptAt: { sort: "asc", nulls: "first" } },
      take: CANDIDATE_WINDOW,
      select: { id: true, lastSyncAttemptAt: true },
    });
    return users.map((u) => ({ userId: u.id, lastSyncAttemptAt: u.lastSyncAttemptAt }));
  }
  return prisma.linkedAccount.findMany({
    where: { platform: lane, linkedAt: { not: null }, lastSyncedAt: null, ...(userFilter && { userId: userFilter }) },
    orderBy: { lastSyncAttemptAt: { sort: "asc", nulls: "first" } },
    take: CANDIDATE_WINDOW,
    select: { userId: true, lastSyncAttemptAt: true },
  });
}

/**
 * What an account has on record for a lane, as one comparable string: a slice that leaves it equal
 * made no progress (every title failing, say), so the account waits for the next run instead of
 * being read again and again.
 */
async function progressOf(lane: ImportLane, userId: string): Promise<string> {
  const where = { userId, platform: lane };
  const [games, timed, account] = await Promise.all([
    prisma.userGame.aggregate({
      where,
      _count: { _all: true },
      _sum: { unlockedCount: true, checkedPlaytimeMin: true, playtimeMin: true },
    }),
    prisma.userGame.count({ where: { ...where, playtimeUpdatedAt: { not: null } } }),
    lane === "xbox"
      ? prisma.linkedAccount.findUnique({ where: { userId_platform: where }, select: { minutesChecked: true } })
      : null,
  ]);
  const checked = account?.minutesChecked;
  const minutesChecked = checked && typeof checked === "object" ? Object.keys(checked).length : 0;
  return [
    games._count._all,
    games._sum.unlockedCount ?? 0,
    games._sum.checkedPlaytimeMin ?? 0,
    games._sum.playtimeMin ?? 0,
    timed,
    minutesChecked,
  ].join("/");
}

/** One sync call: `done` when it reached the end, `closed` when the account cannot be read now. */
type SliceOutcome = { outcome: "done" | "partial" | "closed"; detail?: string };

async function importSlice(lane: ImportLane, userId: string, deadline: number): Promise<SliceOutcome> {
  if (lane === "steam") {
    const result = await syncUser(userId, { probeBudgetMs: Math.max(0, deadline - Date.now()) });
    if (result.status !== "ok") return { outcome: "closed" };
    return { outcome: result.partial ? "partial" : "done" };
  }
  const result = await syncPlatformAccount(userId, lane, { deadline });
  if (result.status !== "ok") return { outcome: "closed" };
  // In the log: a slice that keeps reading the same titles shows here, not just "continues".
  const detail = result.titles && `${result.titles.read} titles read, ${result.titles.upToDate} up to date`;
  return { outcome: result.partial ? "partial" : "done", detail };
}

const LANE_NAMES: Record<ImportLane, string> = { steam: "Steam", psn: "PSN", xbox: "Xbox", retro: "RA" };

/**
 * Runs the lanes until `stopAt` or until no lane has work left. While it runs it holds the import
 * lease (lib/sync/import-lease.ts) listing the accounts it took, so the cron leaves them alone;
 * the lease is released at the end (and expires by itself if the process dies).
 */
export async function runFirstImports(options: FirstImportOptions): Promise<Partial<Record<ImportLane, LaneStats>>> {
  const {
    stopAt,
    sliceMs = IMPORT_SLICE_MS,
    lanes = importLanes(),
    only,
    log = console,
    now = Date.now,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    withDb = (_label, unit) => unit(),
  } = options;
  /** A lane gave up (database gone for good): the others stop at their next turn. */
  let aborted = false;

  /** Accounts this run took and has not settled (finished or stopped): the cron leaves them alone. */
  const busy = new Set<string>();
  let writing = Promise.resolve();
  const publish = () => {
    const snapshot = [...busy];
    writing = writing
      .then(() => holdImportLease(snapshot, now()))
      .catch((error) => log.error("Could not renew the import lease", error));
    return writing;
  };
  const renew = setInterval(() => void publish(), LEASE_RENEW_MS);
  renew.unref?.();

  async function runLane(lane: ImportLane): Promise<LaneStats> {
    const stats: LaneStats = { finished: 0, slices: 0, stopped: 0, failed: 0 };
    const settled = new Set<string>();
    const settle = async (key: string, userId: string) => {
      settled.add(userId);
      busy.delete(key);
      await publish();
    };
    /** One turn: pick the next account and give it a slice. A lost connection repeats the turn. */
    const turn = async (): Promise<"empty" | "more"> => {
      const candidates = (await importCandidates(lane, only)).filter((c) => !settled.has(c.userId));
      if (candidates.length === 0) return "empty";
      const recent = now() - RECENT_ATTEMPT_MS;
      const next = candidates.find(
        (c) =>
          busy.has(importKey(lane, c.userId)) ||
          c.lastSyncAttemptAt === null ||
          c.lastSyncAttemptAt.getTime() < recent,
      );
      if (!next) {
        // Only accounts someone else is syncing right now: wait for them instead of syncing twice.
        await sleep(Math.max(0, Math.min(IDLE_WAIT_MS, stopAt - now())));
        return "more";
      }
      const { userId } = next;
      const key = importKey(lane, userId);
      if (!busy.has(key)) {
        busy.add(key);
        await publish();
      }
      const label = `${LANE_NAMES[lane]} ${userId}`;
      try {
        const before = await progressOf(lane, userId);
        const started = now();
        const { outcome, detail } = await importSlice(lane, userId, Math.min(stopAt, started + sliceMs));
        stats.slices++;
        const took = `${Math.round((now() - started) / 1000)} s${detail ? `; ${detail}` : ""}`;
        if (outcome === "done") {
          stats.finished++;
          log.info(`${label}: import finished (${took})`);
          await settle(key, userId);
        } else if (outcome === "closed") {
          stats.stopped++;
          log.info(`${label}: private or unlinked, left for later`);
          await settle(key, userId);
        } else if ((await progressOf(lane, userId)) === before) {
          stats.stopped++;
          log.warn(`${label}: a slice changed nothing (${took}), left for the next run`);
          await settle(key, userId);
        } else {
          log.info(`${label}: imported a part (${took}), continues`);
        }
      } catch (error) {
        // The database went away: not the account's fault. It stays reserved in the lease and the
        // turn runs again once the database is back (the syncs resume where they stopped).
        rethrowIfDatabaseDown(error);
        stats.failed++;
        log.error(`${label}: import failed`, error);
        await settle(key, userId);
      }
      return "more";
    };
    while (!aborted && now() < stopAt) {
      if ((await withDb(`${LANE_NAMES[lane]} lane`, turn)) === "empty") break;
    }
    return stats;
  }

  try {
    await publish();
    const settledLanes = await Promise.allSettled(
      lanes.map(async (lane) => {
        try {
          return [lane, await runLane(lane)] as const;
        } catch (error) {
          aborted = true;
          throw error;
        }
      }),
    );
    const failure = settledLanes.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failure) throw failure.reason;
    const results = settledLanes.map((r) => (r as PromiseFulfilledResult<readonly [ImportLane, LaneStats]>).value);
    return Object.fromEntries(results) as Partial<Record<ImportLane, LaneStats>>;
  } finally {
    clearInterval(renew);
    await writing;
    await releaseImportLease().catch((error) => log.error("Could not release the import lease", error));
  }
}

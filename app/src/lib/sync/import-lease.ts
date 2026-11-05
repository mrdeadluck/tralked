import { prisma } from "@/lib/db";

/**
 * Lease of the first-import worker (scripts/platform-import-worker.ts): while it runs, it lists the
 * accounts it is importing right now, so the cron jobs and the worker never sync the same account
 * at the same time. Kept apart from first-import.ts so the cron syncs can read it without an import
 * cycle.
 */
export const IMPORT_WORKER_CURSOR = "platform-import-worker";
/** A lease not renewed for this long is over (the worker died): the cron takes every account again. */
export const IMPORT_WORKER_LEASE_MS = 15 * 60_000;

/** `steam` (the Steam sync of a user) or a code platform. */
export type ImportLane = "steam" | "psn" | "xbox" | "retro";

type LeaseValue = { until: number; busy: string[] };

export const importKey = (lane: ImportLane, userId: string) => `${lane}:${userId}`;

/** Writes the lease: valid for IMPORT_WORKER_LEASE_MS from `now`, with the accounts in progress. */
export async function holdImportLease(busy: Iterable<string>, now = Date.now()): Promise<void> {
  const value: LeaseValue = { until: now + IMPORT_WORKER_LEASE_MS, busy: [...busy] };
  await prisma.syncCursor.upsert({
    where: { key: IMPORT_WORKER_CURSOR },
    create: { key: IMPORT_WORKER_CURSOR, value },
    update: { value },
  });
}

/** The worker is done: nothing is reserved any more. */
export async function releaseImportLease(): Promise<void> {
  await holdImportLease([], 0);
}

/** Accounts the worker is importing now (`importKey`), empty when no lease is valid. */
export async function busyImports(now = Date.now()): Promise<Set<string>> {
  const row = await prisma.syncCursor.findUnique({ where: { key: IMPORT_WORKER_CURSOR } });
  const value = row?.value as Partial<LeaseValue> | null | undefined;
  if (!value || typeof value.until !== "number" || value.until <= now || !Array.isArray(value.busy)) {
    return new Set();
  }
  return new Set(value.busy.filter((key): key is string => typeof key === "string"));
}

/** Users and platforms of busy keys, for a cron query (`lane:userId`). */
export function busyPairs(busy: Set<string>): { platform: ImportLane; userId: string }[] {
  return [...busy].flatMap((key) => {
    const at = key.indexOf(":");
    if (at <= 0) return [];
    return [{ platform: key.slice(0, at) as ImportLane, userId: key.slice(at + 1) }];
  });
}

/**
 * Changes the lease's account list under a row lock: `edit` gets the keys a valid lease holds now
 * and returns the new list. The lease ends when no key remains; otherwise it is renewed for
 * IMPORT_WORKER_LEASE_MS (`renew`) or keeps its current end. For a one-off job beside the worker
 * (lib/trophies/finish.ts), which adds and removes only its own keys. The worker itself overwrites
 * (or wipes) the whole list without reading it (holdImportLease, releaseImportLease): such a job
 * puts its keys back often (finish: every 30 s and before each account).
 *
 * A renewal extends the whole lease, so the keys of a worker that died stay in it while the job
 * runs (harmless: the cron only skips those accounts until the job ends and the lease expires).
 */
async function editImportLease(edit: (busy: Set<string>) => Set<string>, now: number, renew: boolean): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ value: unknown }[]>`
      SELECT value FROM "SyncCursor" WHERE key = ${IMPORT_WORKER_CURSOR} FOR UPDATE`;
    const value = rows[0]?.value as Partial<LeaseValue> | null | undefined;
    const valid = value && typeof value.until === "number" && value.until > now && Array.isArray(value.busy);
    const busy = new Set(valid ? value.busy!.filter((key): key is string => typeof key === "string") : []);
    const next = [...edit(busy)];
    const until = next.length === 0 ? 0 : renew || !valid ? now + IMPORT_WORKER_LEASE_MS : value.until!;
    const lease: LeaseValue = { until, busy: next };
    await tx.syncCursor.upsert({
      where: { key: IMPORT_WORKER_CURSOR },
      create: { key: IMPORT_WORKER_CURSOR, value: lease },
      update: { value: lease },
    });
  });
}

/**
 * Reserves `keys` beside whatever the lease holds: returns the keys taken now and those someone
 * (the import worker, another job) holds already, which are left to them.
 */
export async function reserveImportKeys(
  keys: Iterable<string>,
  now = Date.now(),
): Promise<{ taken: string[]; held: string[] }> {
  const taken: string[] = [];
  const held: string[] = [];
  await editImportLease((busy) => {
    for (const key of keys) {
      if (busy.has(key)) held.push(key);
      else taken.push(key);
    }
    return new Set([...busy, ...taken]);
  }, now, true);
  return { taken, held };
}

/** Puts `keys` back in the lease (the worker may have rewritten it) and renews it. */
export async function renewImportKeys(keys: Iterable<string>, now = Date.now()): Promise<void> {
  await editImportLease((busy) => new Set([...busy, ...keys]), now, true);
}

/** Takes `keys` out of the lease, leaving the others as they are. */
export async function releaseImportKeys(keys: Iterable<string>, now = Date.now()): Promise<void> {
  const drop = new Set(keys);
  await editImportLease((busy) => new Set([...busy].filter((key) => !drop.has(key))), now, false);
}

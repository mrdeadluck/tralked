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

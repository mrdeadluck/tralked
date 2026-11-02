import { prisma } from "@/lib/db";
import { createLimiter } from "@/lib/auth/rate-limit";
import { platformAvailable } from "@/lib/integrations/availability";
import { containsCode, generateLinkCode } from "./link";
import { readConnectedProfile, type LinkPlatform, type PlatformProfile } from "./profiles";

/**
 * "Verificar agora": an active connection (typed in, so "não verificada") proves that the account
 * is the user's own. Same proof as a claim (./link.ts): Tralked gives a TRK- code, the user
 * pastes it in the free text of the platform profile (Steam "Resumo", PSN "Sobre mim", Xbox bio,
 * RetroAchievements motto: every one of them is user-editable and readable by the service
 * account), and the check reads the public profile. Found, the connection becomes verified. The
 * account never changes hands here, nothing is released and no XP moves: it only adds the seal.
 *
 * The code sits on the active row (`verifyCode`/`verifyExpiresAt`, which claims only use on
 * inactive rows). Changing or disconnecting the account clears it (./connect.ts, ./link.ts).
 *
 * Each check reads the platform with Tralked's service account, so:
 * - one check per VERIFY_COOLDOWN_MS per connection (`verifyCheckedAt`, claimed atomically, so a
 *   double click or two tabs never reach the platform twice);
 * - at most VERIFY_CHECKS_PER_HOUR checks and VERIFY_STARTS_PER_HOUR new codes per user (in
 *   memory, per server instance, like the other form limits);
 * - the read is cut at VERIFY_READ_TIMEOUT_MS, so the request stays short even when the platform
 *   is slow (the user is told to try again).
 */

/** Long enough to edit the profile on a console and come back. */
export const VERIFY_CODE_TTL_MS = 24 * 60 * 60_000;
export const VERIFY_COOLDOWN_MS = 30_000;
export const VERIFY_CHECKS_PER_HOUR = 10;
export const VERIFY_STARTS_PER_HOUR = 10;
export const VERIFY_READ_TIMEOUT_MS = 15_000;
const HOUR_MS = 60 * 60_000;

const checkLimiter = createLimiter({ limit: VERIFY_CHECKS_PER_HOUR, windowMs: HOUR_MS });
const startLimiter = createLimiter({ limit: VERIFY_STARTS_PER_HOUR, windowMs: HOUR_MS });

/** Tests only: forgets the per-user counters. */
export function resetVerifyLimits(): void {
  checkLimiter.clear();
  startLimiter.clear();
}

/** Why a check did not verify (kept in `verifyFailure` so the page can say it after a reload). */
export const VERIFY_FAILURES = ["code_missing", "not_found", "different", "private", "error"] as const;
export type VerifyFailure = (typeof VERIFY_FAILURES)[number];

export const isVerifyFailure = (value: string | null | undefined): value is VerifyFailure =>
  (VERIFY_FAILURES as readonly string[]).includes(value ?? "");

export type TooSoon = { ok: false; reason: "too_soon"; retryAfterSec: number };

/** The connection cannot start or check a verification at all. */
export type VerifyRefusal = "not_connected" | "already_verified" | "unavailable";

export type StartVerificationResult =
  | { ok: true; code: string; expiresAt: Date }
  | { ok: false; reason: VerifyRefusal }
  | TooSoon;

export type CheckVerificationResult =
  | { ok: true; handle: string }
  | { ok: false; reason: VerifyRefusal | "expired" | VerifyFailure }
  | TooSoon;

const retryAfter = (until: number, now: Date) => Math.max(1, Math.ceil((until - now.getTime()) / 1000));

/** Steam is read from public pages; the others need Tralked's service account on this server. */
const available = (platform: LinkPlatform) => platform === "steam" || platformAvailable(platform);

async function activeRow(userId: string, platform: LinkPlatform) {
  const row = await prisma.linkedAccount.findUnique({ where: { userId_platform: { userId, platform } } });
  return row?.linkedAt ? row : null;
}

/**
 * Gives the user a code to paste in the profile of their connected account (a new code each time:
 * "Gerar novo código" calls this again and the old code stops working).
 */
export async function startVerification(
  userId: string,
  platform: LinkPlatform,
  now: Date = new Date(),
): Promise<StartVerificationResult> {
  if (!available(platform)) return { ok: false, reason: "unavailable" };
  const row = await activeRow(userId, platform);
  if (!row) return { ok: false, reason: "not_connected" };
  if (row.verifiedAt) return { ok: false, reason: "already_verified" };

  const slot = startLimiter.hit(userId, now.getTime());
  if (!slot.ok) return { ok: false, reason: "too_soon", retryAfterSec: slot.retryAfterSec };

  const code = generateLinkCode();
  const expiresAt = new Date(now.getTime() + VERIFY_CODE_TTL_MS);
  // Guarded on the account read above: one replaced or verified meanwhile is left alone.
  const { count } = await prisma.linkedAccount.updateMany({
    where: { id: row.id, externalId: row.externalId, linkedAt: { not: null }, verifiedAt: null },
    data: { verifyCode: code, verifyExpiresAt: expiresAt, verifyFailure: null },
  });
  if (count === 0) return { ok: false, reason: "not_connected" };
  return { ok: true, code, expiresAt };
}

/** Rejects after `ms` (the platform read keeps going in the background, its answer unused). */
export function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`profile read took longer than ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * "Verificar agora": reads the connected account's public profile and, when the pending code is
 * there, marks the connection verified. A failure is recorded with its reason.
 */
export async function checkVerification(
  userId: string,
  platform: LinkPlatform,
  now: Date = new Date(),
): Promise<CheckVerificationResult> {
  if (!available(platform)) return { ok: false, reason: "unavailable" };
  const row = await activeRow(userId, platform);
  if (!row) return { ok: false, reason: "not_connected" };
  if (row.verifiedAt) return { ok: true, handle: row.handle };
  if (!row.verifyCode || !row.verifyExpiresAt || row.verifyExpiresAt <= now) return { ok: false, reason: "expired" };

  const hourly = checkLimiter.check(userId, now.getTime());
  if (!hourly.ok) return { ok: false, reason: "too_soon", retryAfterSec: hourly.retryAfterSec };

  // Atomic per-connection cooldown: two checks of the same code cannot both reach the platform.
  const claimed = await prisma.linkedAccount.updateMany({
    where: {
      id: row.id,
      verifyCode: row.verifyCode,
      OR: [
        { verifyCheckedAt: null },
        { verifyCheckedAt: { lte: new Date(now.getTime() - VERIFY_COOLDOWN_MS) } },
      ],
    },
    data: { verifyCheckedAt: now },
  });
  if (claimed.count === 0) {
    const fresh = await prisma.linkedAccount.findUnique({
      where: { id: row.id },
      select: { verifyCode: true, verifyCheckedAt: true },
    });
    // A new code (or a cancel) landed in between: this check's code is gone.
    if (fresh?.verifyCode !== row.verifyCode) return { ok: false, reason: "expired" };
    const last = fresh.verifyCheckedAt?.getTime() ?? now.getTime();
    return { ok: false, reason: "too_soon", retryAfterSec: retryAfter(last + VERIFY_COOLDOWN_MS, now) };
  }
  checkLimiter.hit(userId, now.getTime());

  const code = row.verifyCode;
  const fail = async (reason: VerifyFailure): Promise<CheckVerificationResult> => {
    await prisma.linkedAccount.updateMany({ where: { id: row.id, verifyCode: code }, data: { verifyFailure: reason } });
    return { ok: false, reason };
  };

  let profile: PlatformProfile | null;
  try {
    profile = await within(readConnectedProfile(platform, { externalId: row.externalId, handle: row.handle }),VERIFY_READ_TIMEOUT_MS);
  } catch (error) {
    console.error(`Verification: could not read the ${platform} profile`, error instanceof Error ? error.message : String(error));
    return fail("error");
  }
  if (!profile) return fail("not_found");
  // The stored handle now names another account (renamed, and the name was taken).
  if (profile.externalId !== row.externalId) return fail("different");
  if (!containsCode(profile.text, code)) return fail(platform === "steam" && profile.isPrivate ? "private" : "code_missing");

  // Only the same account with the same code: a replaced connection or a new code is not verified.
  const { count } = await prisma.linkedAccount.updateMany({
    where: { id: row.id, externalId: row.externalId, linkedAt: { not: null }, verifyCode: code },
    data: { verifiedAt: now, verifyCode: null, verifyExpiresAt: null, verifyFailure: null },
  });
  if (count === 0) return { ok: false, reason: "expired" };
  return { ok: true, handle: profile.handle };
}

/** Drops the pending code (the connection stays, unverified). False when there was none. */
export async function cancelVerification(userId: string, platform: LinkPlatform): Promise<boolean> {
  const { count } = await prisma.linkedAccount.updateMany({
    where: { userId, platform, linkedAt: { not: null }, verifiedAt: null, verifyCode: { not: null } },
    data: { verifyCode: null, verifyExpiresAt: null, verifyFailure: null },
  });
  return count > 0;
}

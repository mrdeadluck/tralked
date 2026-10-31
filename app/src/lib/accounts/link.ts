import { randomInt } from "node:crypto";
import { Prisma, type LinkedAccount } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { toLocalDay } from "@/lib/engine/streak";
import { platformAvailable } from "@/lib/integrations/availability";
import { parseSteamProfileInput, steamProfileHandle } from "@/lib/integrations/steam/profile-lookup";
import { recomputeUser, revalidateMissions } from "@/lib/progression/recompute";
import type { CodePlatform } from "@/lib/sync/platform-library";
import { lookupProfile, type LinkPlatform, type PlatformProfile } from "./profiles";

/**
 * Claims and disconnections of Steam, PSN, Xbox and RetroAchievements accounts.
 *
 * Connecting is instant (./connect.ts): typing the profile links it, unverified. A platform account
 * can only be on one Tralked profile, so when it is already on another one the user claims it here
 * (the only place that asks for proof): they receive a temporary code, paste it in the platform
 * profile (Steam "Resumo", PSN "Sobre mim", Xbox bio, RA motto) and confirm; Tralked reads the
 * public profile (with its own service account where the platform needs one). Proven, the account
 * moves to the claimant as verified, the previous profile loses it through the unlink path (its XP
 * from it is voided) and is notified. The user never hands over a password or token. Steam's
 * claim also fills User.steamId and may recover an account of the old Steam login: ./steam-link.ts.
 *
 * Anti-squatting: a pending claim reserves nothing. While pending (or after an unlink), the
 * user's own row (unique per user and platform) is inactive (`linkedAt` null) and holds a
 * placeholder externalId `pending:<userId>[:<start times>]`; the real id is only written when the
 * account is linked or the code is confirmed.
 *
 * Rate limits (each confirmation reads the platform with the service account):
 * - confirm: once per CONFIRM_COOLDOWN_MS per user and platform (`lastSyncAttemptAt`, which
 *   starting a claim never resets);
 * - start: at most MAX_STARTS_PER_HOUR per user over all platforms (start times are kept in the
 *   placeholder externalId, so no schema change is needed).
 */

export const LINK_CODE_TTL_MS = 30 * 60_000;
export const CONFIRM_COOLDOWN_MS = 30_000;
export const MAX_STARTS_PER_HOUR = 5;
const HOUR_MS = 60 * 60_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
const CODE_LENGTH = 6;
const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

/** Handle formats accepted per platform (checked before any request to the platform). */
export const HANDLE_PATTERNS: Record<CodePlatform, RegExp> = {
  // PSN online id: 3-16 letters, digits, hyphen, underscore.
  psn: /^[A-Za-z0-9_-]{3,16}$/,
  // Gamertag: letters, digits and spaces (modern gamertags may carry a #1234 suffix).
  xbox: /^[A-Za-z0-9 ]{1,16}(#\d{1,4})?$/,
  // RetroAchievements username.
  retro: /^[A-Za-z0-9_]{2,32}$/,
};

/**
 * The handle as typed for a lookup, or null when the platform cannot have it. A Steam profile
 * link is reduced to its SteamID64 or custom URL name.
 */
export function normalizeLinkHandle(platform: LinkPlatform, handle: string): string | null {
  if (platform === "steam") {
    const ref = parseSteamProfileInput(handle);
    return ref ? steamProfileHandle(ref) : null;
  }
  const trimmed = handle.trim();
  return HANDLE_PATTERNS[platform].test(trimmed) ? trimmed : null;
}

const PLATFORM_NAMES: Record<LinkPlatform, string> = {
  steam: "Steam",
  psn: "PlayStation",
  xbox: "Xbox",
  retro: "RetroAchievements",
};

export type TooSoon = { ok: false; reason: "too_soon"; retryAfterSec: number };

export type StartClaimResult =
  | { ok: true; code: string; expiresAt: Date }
  | { ok: false; reason: "invalid_handle" | "already_linked" | "unavailable" }
  | TooSoon;

export type ConfirmClaimFailure =
  | "code_missing"
  | "expired"
  | "taken"
  | "private"
  | "not_found"
  | "too_soon";

export type ConfirmClaimResult =
  | { ok: true; handle: string; externalId: string; previousHolderId: string | null }
  | { ok: false; reason: Exclude<ConfirmClaimFailure, "too_soon"> }
  | TooSoon;

/** Placeholder externalId of an inactive row, carrying the recent claim start times. */
export function pendingExternalId(userId: string, starts: number[] = []): string {
  return starts.length > 0
    ? `pending:${userId}:${starts.map((t) => t.toString(36)).join(".")}`
    : `pending:${userId}`;
}

/** Start times kept in a placeholder externalId (none for an active row). */
export function startsOf(externalId: string, userId: string): number[] {
  const prefix = `pending:${userId}:`;
  if (!externalId.startsWith(prefix)) return [];
  return externalId
    .slice(prefix.length)
    .split(".")
    .map((s) => parseInt(s, 36))
    .filter((n) => Number.isFinite(n));
}

const retryAfter = (until: number, now: Date) => Math.max(1, Math.ceil((until - now.getTime()) / 1000));

export function generateLinkCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `TRK-${code}`;
}

/** True when `text` contains `code`, ignoring case and spacing around the hyphen. */
export function containsCode(text: string, code: string): boolean {
  const squash = (s: string) => s.toUpperCase().replace(/[\s-]+/g, "");
  return squash(text).includes(squash(code));
}

/**
 * Starts (or restarts, with a new code) claiming `handle` on `platform`. An account already
 * connected on that platform must be disconnected first (the claim is kept on the user's inactive
 * row). Limited to MAX_STARTS_PER_HOUR per user.
 */
export async function startClaim(
  userId: string,
  platform: LinkPlatform,
  handle: string,
  now: Date = new Date(),
): Promise<StartClaimResult> {
  const trimmed = normalizeLinkHandle(platform, handle);
  if (!trimmed) return { ok: false, reason: "invalid_handle" };
  if (platform !== "steam" && !platformAvailable(platform)) return { ok: false, reason: "unavailable" };

  const rows = await prisma.linkedAccount.findMany({ where: { userId } });
  const existing = rows.find((r) => r.platform === platform);
  if (existing?.linkedAt) return { ok: false, reason: "already_linked" };
  if (platform === "steam") {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { steamId: true } });
    if (me.steamId) return { ok: false, reason: "already_linked" };
  }

  const windowStart = now.getTime() - HOUR_MS;
  const recent = rows
    .flatMap((r) => startsOf(r.externalId, userId))
    .filter((t) => t > windowStart)
    .sort((a, b) => a - b);
  if (recent.length >= MAX_STARTS_PER_HOUR) {
    return { ok: false, reason: "too_soon", retryAfterSec: retryAfter(recent[0] + HOUR_MS, now) };
  }

  const ownStarts = (existing ? startsOf(existing.externalId, userId) : []).filter((t) => t > windowStart);
  const code = generateLinkCode();
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
  const pending = {
    externalId: pendingExternalId(userId, [...ownStarts, now.getTime()]),
    handle: trimmed,
    linkedAt: null,
    verifyCode: code,
    verifyExpiresAt: expiresAt,
    verifiedAt: null,
  };
  try {
    await prisma.linkedAccount.upsert({
      // Only an inactive row is reused: an account linked a moment ago is never overwritten.
      where: { userId_platform: { userId, platform }, linkedAt: null },
      create: { userId, platform, ...pending },
      update: pending,
    });
  } catch (error) {
    // The row became active meanwhile (the guarded update matched nothing, or the create collided).
    if (isKnownError(error, "P2025") || isKnownError(error, "P2002")) return { ok: false, reason: "already_linked" };
    throw error;
  }
  return { ok: true, code, expiresAt };
}

export const isKnownError = (error: unknown, code: string) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

export type PendingCodeCheck =
  | { ok: true; pending: LinkedAccount; profile: PlatformProfile }
  | { ok: false; reason: "expired" | "not_found" | "code_missing" | "private" }
  | TooSoon;

/**
 * First half of a claim confirmation (shared with Steam): the pending code must still be valid,
 * the per-claim cooldown free, and the profile must exist and show the code. A Steam profile that
 * is private does not show its "Resumo" at all, so a missing code there is reported as private.
 */
export async function checkPendingCode(
  userId: string,
  platform: LinkPlatform,
  now: Date = new Date(),
): Promise<PendingCodeCheck> {
  const pending = await prisma.linkedAccount.findUnique({
    where: { userId_platform: { userId, platform } },
  });
  if (!pending || pending.linkedAt || !pending.verifyCode || !pending.verifyExpiresAt) {
    return { ok: false, reason: "expired" };
  }
  if (pending.verifyExpiresAt <= now) return { ok: false, reason: "expired" };

  // Atomic cooldown claim: two confirmations of the same claim cannot both reach the platform.
  const claimed = await prisma.linkedAccount.updateMany({
    where: {
      id: pending.id,
      linkedAt: null,
      OR: [
        { lastSyncAttemptAt: null },
        { lastSyncAttemptAt: { lte: new Date(now.getTime() - CONFIRM_COOLDOWN_MS) } },
      ],
    },
    data: { lastSyncAttemptAt: now },
  });
  if (claimed.count === 0) {
    const last = pending.lastSyncAttemptAt?.getTime() ?? now.getTime();
    return { ok: false, reason: "too_soon", retryAfterSec: retryAfter(last + CONFIRM_COOLDOWN_MS, now) };
  }

  const profile = await lookupProfile(platform, pending.handle);
  if (!profile) return { ok: false, reason: "not_found" };
  if (!containsCode(profile.text, pending.verifyCode)) {
    return { ok: false, reason: platform === "steam" && profile.isPrivate ? "private" : "code_missing" };
  }
  return { ok: true, pending, profile };
}

/** Thrown inside a transaction to roll it back when a guarded update matched nothing. */
export class Raced extends Error {}

/**
 * Second half of a claim: the proven account becomes the claimant's verified, active connection.
 * Whoever had it (an active link of another profile, or for Steam a User.steamId) loses it in the
 * same transaction through the unlink path (XP from it voided, library rows removed) and gets a
 * notification. Their level and missions are recomputed afterwards.
 */
export async function takeOverAccount(
  userId: string,
  pending: LinkedAccount,
  profile: PlatformProfile,
  now: Date,
): Promise<ConfirmClaimResult | { ok: false; reason: "different" }> {
  const platform = pending.platform as LinkPlatform;
  const externalId = profile.externalId;
  const [row, steamOwner] = await Promise.all([
    prisma.linkedAccount.findUnique({
      where: { platform_externalId: { platform, externalId } },
      select: { userId: true },
    }),
    platform === "steam"
      ? prisma.user.findFirst({ where: { steamId: externalId, id: { not: userId } }, select: { id: true } })
      : null,
  ]);
  const holderId = (row && row.userId !== userId ? row.userId : null) ?? steamOwner?.id ?? null;

  let released: { days: string[] } | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      if (holderId) released = await releaseForClaim(tx, holderId, platform, profile, now);
      if (platform === "steam") {
        // The guard makes a concurrent link of another Steam account fail instead of replacing it.
        const { count } = await tx.user.updateMany({
          where: { id: userId, OR: [{ steamId: null }, { steamId: externalId }] },
          data: { steamId: externalId, lastSyncedAt: null },
        });
        if (count === 0) throw new Raced();
      }
      await tx.linkedAccount.update({
        where: { id: pending.id, linkedAt: null, verifyCode: pending.verifyCode },
        data: {
          externalId,
          handle: profile.handle,
          linkedAt: now,
          verifiedAt: now,
          verifyCode: null,
          verifyExpiresAt: null,
          lastSyncedAt: null,
          // lastSyncAttemptAt stays at this attempt, so the cooldown also covers unlink + reclaim.
        },
      });
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (error instanceof Raced) return { ok: false, reason: "different" };
    // Someone else linked this account a moment earlier, or the holder changed accounts meanwhile
    // (nothing of theirs is released then: the transaction rolls back).
    if (error instanceof HolderChanged || isKnownError(error, "P2002")) return { ok: false, reason: "taken" };
    // The pending claim changed under us (restarted or confirmed concurrently).
    if (isKnownError(error, "P2025")) return { ok: false, reason: "expired" };
    throw error;
  }
  const done = released as { days: string[] } | null;
  if (holderId && done) await settleRelease(holderId, done, now);
  return { ok: true, handle: profile.handle, externalId, previousHolderId: done ? holderId : null };
}

/** The holder no longer has the account a claim read: the claim's transaction rolls back. */
export class HolderChanged extends Error {}

/**
 * In a claim's transaction: `holderId` loses the claimed account (only if it is still that one,
 * otherwise HolderChanged) through the unlink path, and is notified. Call settleRelease after the
 * transaction commits.
 */
export async function releaseForClaim(
  tx: Prisma.TransactionClient,
  holderId: string,
  platform: LinkPlatform,
  profile: Pick<PlatformProfile, "externalId" | "handle">,
  now: Date,
): Promise<{ days: string[] } | null> {
  const released = await releaseAccount(tx, holderId, platform, now, profile.externalId);
  if (released) {
    const name = PLATFORM_NAMES[platform];
    await tx.notification.create({
      data: {
        userId: holderId,
        kind: "system",
        title: `Sua conexão ${name} foi reivindicada`,
        body: `Outra pessoa provou, com um código no perfil, ser dona da conta ${name} ${profile.handle}. Ela saiu do seu personagem e o XP que veio dela foi anulado. Se a conta é sua, conecte de novo em Conexões e use "Reivindicar".`,
        href: "/conta/conexoes",
      },
    });
  }
  return released;
}

/** After a release committed: re-checks the missions its unlocks completed and recomputes the user. */
export async function settleRelease(userId: string, released: { days: string[] }, now: Date): Promise<void> {
  await revalidateMissions(userId, released.days, now);
  await recomputeUser(userId, now);
}

/**
 * Checks the pending claim of a PSN/Xbox/RA account: the profile must exist, show the code and
 * have its trophies/achievements visible. Proven, the account becomes the user's verified
 * connection, taken from whoever had it.
 */
export async function confirmClaim(
  userId: string,
  platform: CodePlatform,
  now: Date = new Date(),
): Promise<ConfirmClaimResult> {
  const check = await checkPendingCode(userId, platform, now);
  if (!check.ok) return check;
  if (check.profile.isPrivate) return { ok: false, reason: "private" };
  const result = await takeOverAccount(userId, check.pending, check.profile, now);
  // "different" only happens for Steam (User.steamId).
  return result.ok || result.reason !== "different" ? result : { ok: false, reason: "expired" };
}

/**
 * Cancels a claim that was started but never confirmed: the code stops working. The row stays
 * (placeholder externalId) so the start limit still counts. Returns false when there is no
 * unconfirmed claim to cancel.
 */
export async function cancelClaim(userId: string, platform: LinkPlatform): Promise<boolean> {
  const { count } = await prisma.linkedAccount.updateMany({
    where: { userId, platform, linkedAt: null, verifyCode: { not: null } },
    data: { verifyCode: null, verifyExpiresAt: null },
  });
  return count > 0;
}

/**
 * Inside a transaction: disconnects `userId`'s account on `platform`. The row goes back to the
 * inactive state (placeholder externalId, so the platform account is free for anyone), the
 * platform's library rows and valid unlocks are removed, and its ledger entries are voided
 * (never deleted): linking the same account again later does not pay those unlocks again, while
 * another user who links it is paid normally. Suspicious unlocks are kept, so fraud history
 * survives. Disconnecting Steam also clears User.steamId (the Steam sync stops). Returns the days
 * whose missions must be re-checked, or null when nothing was connected.
 *
 * The rows are locked FOR UPDATE: a platform sync re-checks the account row (FOR SHARE) in every
 * title transaction, and the Steam sync the user row, so a sync either records its title before
 * the unlink (which then removes it) or sees the account gone and stops.
 */
export async function releaseAccount(
  tx: Prisma.TransactionClient,
  userId: string,
  platform: LinkPlatform,
  now: Date,
  /** The account the caller means to release: anything else (changed meanwhile) throws HolderChanged. */
  expectedExternalId?: string,
): Promise<{ days: string[] } | null> {
  if (platform === "steam") await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "LinkedAccount" WHERE "userId" = ${userId} AND platform = ${platform} FOR UPDATE`;
  const account = await tx.linkedAccount.findUnique({
    where: { userId_platform: { userId, platform } },
  });
  const steamId =
    platform === "steam"
      ? (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { steamId: true } })).steamId
      : null;
  if (expectedExternalId !== undefined) {
    const current = account?.linkedAt ? account.externalId : steamId;
    if (current !== expectedExternalId) throw new HolderChanged();
  }
  if (!account?.linkedAt && !steamId) return null;
  if (account?.linkedAt) {
    await tx.linkedAccount.update({
      where: { id: account.id },
      data: {
        externalId: pendingExternalId(userId),
        linkedAt: null,
        verifiedAt: null,
        verifyCode: null,
        verifyExpiresAt: null,
        lastSyncedAt: null,
      },
    });
  }
  await tx.xpLedgerEntry.updateMany({
    where: { userId, platform, voidedAt: null },
    data: { voidedAt: now },
  });
  if (platform === "steam") {
    // The Steam sync writes its entries without a platform (lib/sync/user.ts): they are found by
    // their source instead, the user's Steam unlocks and Steam games (read before they go away).
    const [unlocks, games] = await Promise.all([
      tx.userAchievement.findMany({ where: { userId, achievement: { platform: "steam" } }, select: { achievementId: true } }),
      tx.userGame.findMany({ where: { userId, platform: "steam" }, select: { gameId: true } }),
    ]);
    await tx.xpLedgerEntry.updateMany({
      where: {
        userId,
        platform: null,
        voidedAt: null,
        OR: [
          { source: "achievement", sourceKey: { in: unlocks.map((u) => u.achievementId) } },
          { source: "platinum", sourceKey: { in: games.map((g) => g.gameId) } },
          // Hours milestones of Steam games (lib/engine/playtime.ts): `steam:<gameId>:<hours>`.
          { source: "playtime", sourceKey: { startsWith: "steam:" } },
        ],
      },
      data: { voidedAt: now },
    });
    // The wishlist came from that Steam account too.
    await tx.wishlistItem.deleteMany({ where: { userId, platform: "steam" } });
  }
  // Days of the unlocks that go away: the missions of those days and weeks are re-checked.
  const gone = await tx.userAchievement.findMany({
    where: { userId, suspicious: false, achievement: { platform } },
    select: { unlockedAt: true },
  });
  await tx.userAchievement.deleteMany({
    where: { userId, suspicious: false, achievement: { platform } },
  });
  await tx.userGame.deleteMany({ where: { userId, platform } });
  if (platform === "steam") await tx.user.update({ where: { id: userId }, data: { steamId: null, lastSyncedAt: null } });
  return { days: [...new Set(gone.map((u) => toLocalDay(u.unlockedAt)))] };
}

/**
 * Disconnects the account (see releaseAccount), then re-checks the missions that its unlocks
 * completed (their rewards are voided) and recomputes the user. Returns false when the platform
 * was not connected.
 */
export async function unlink(
  userId: string,
  platform: LinkPlatform,
  now: Date = new Date(),
): Promise<boolean> {
  const removed = await prisma.$transaction((tx) => releaseAccount(tx, userId, platform, now), TRANSACTION_OPTIONS);
  if (!removed) return false;
  await settleRelease(userId, removed, now);
  return true;
}

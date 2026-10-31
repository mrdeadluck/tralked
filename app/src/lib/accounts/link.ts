import { randomInt } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { recomputeUser } from "@/lib/progression/recompute";
import type { CodePlatform } from "@/lib/sync/platform-library";
import { lookupProfile } from "./profiles";

/**
 * Linking PSN, Xbox and RetroAchievements accounts (Exophase model). The user types their
 * handle, receives a temporary code, pastes it in the platform profile (PSN "Sobre mim", Xbox
 * bio, RA motto) and confirms; Tralked reads the public profile with its own service account.
 * The user never hands over a password or token.
 *
 * Anti-squatting: a pending link does not reserve the platform account. While pending, the
 * user's own row (unique per user and platform) holds a placeholder externalId; the real id is
 * only written when the code is confirmed, so starting a link for someone else's account
 * blocks nobody.
 */

export const LINK_CODE_TTL_MS = 30 * 60_000;
/** Minimum time between two confirmations of the same pending link (each one reads the platform). */
export const CONFIRM_COOLDOWN_MS = 10_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
const CODE_LENGTH = 6;

/** Handle formats accepted per platform (checked before any request to the platform). */
export const HANDLE_PATTERNS: Record<CodePlatform, RegExp> = {
  // PSN online id: 3-16 letters, digits, hyphen, underscore.
  psn: /^[A-Za-z0-9_-]{3,16}$/,
  // Gamertag: letters, digits and spaces (modern gamertags may carry a #1234 suffix).
  xbox: /^[A-Za-z0-9 ]{1,16}(#\d{1,4})?$/,
  // RetroAchievements username.
  retro: /^[A-Za-z0-9_]{2,32}$/,
};

export type StartLinkResult =
  | { ok: true; code: string; expiresAt: Date }
  | { ok: false; reason: "invalid_handle" | "already_linked" };

export type ConfirmLinkFailure =
  | "code_missing"
  | "expired"
  | "taken"
  | "private"
  | "not_found"
  | "too_soon";

export type ConfirmLinkResult =
  | { ok: true; handle: string; externalId: string }
  | { ok: false; reason: ConfirmLinkFailure };

const pendingExternalId = (userId: string) => `pending:${userId}`;

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
 * Starts (or restarts, with a new code) linking `handle` on `platform`. A verified account on
 * that platform must be unlinked first.
 */
export async function startLink(
  userId: string,
  platform: CodePlatform,
  handle: string,
  now: Date = new Date(),
): Promise<StartLinkResult> {
  const trimmed = handle.trim();
  if (!HANDLE_PATTERNS[platform].test(trimmed)) return { ok: false, reason: "invalid_handle" };

  const existing = await prisma.linkedAccount.findUnique({
    where: { userId_platform: { userId, platform } },
  });
  if (existing?.verifiedAt) return { ok: false, reason: "already_linked" };

  const code = generateLinkCode();
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
  const pending = {
    externalId: pendingExternalId(userId),
    handle: trimmed,
    verifyCode: code,
    verifyExpiresAt: expiresAt,
    verifiedAt: null,
    lastSyncAttemptAt: null,
  };
  await prisma.linkedAccount.upsert({
    where: { userId_platform: { userId, platform } },
    create: { userId, platform, ...pending },
    update: pending,
  });
  return { ok: true, code, expiresAt };
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * Checks the pending link: the profile must exist, show the code, belong to nobody else and
 * have its trophies/achievements visible. On success the link is verified and the real
 * platform id is stored.
 */
export async function confirmLink(
  userId: string,
  platform: CodePlatform,
  now: Date = new Date(),
): Promise<ConfirmLinkResult> {
  const pending = await prisma.linkedAccount.findUnique({
    where: { userId_platform: { userId, platform } },
  });
  if (!pending || pending.verifiedAt || !pending.verifyCode || !pending.verifyExpiresAt) {
    return { ok: false, reason: "expired" };
  }
  if (pending.verifyExpiresAt <= now) return { ok: false, reason: "expired" };

  // Atomic cooldown claim: two confirmations of the same link cannot both reach the platform.
  const claimed = await prisma.linkedAccount.updateMany({
    where: {
      id: pending.id,
      verifiedAt: null,
      OR: [
        { lastSyncAttemptAt: null },
        { lastSyncAttemptAt: { lt: new Date(now.getTime() - CONFIRM_COOLDOWN_MS) } },
      ],
    },
    data: { lastSyncAttemptAt: now },
  });
  if (claimed.count === 0) return { ok: false, reason: "too_soon" };

  const profile = await lookupProfile(platform, pending.handle);
  if (!profile) return { ok: false, reason: "not_found" };
  if (!containsCode(profile.text, pending.verifyCode)) return { ok: false, reason: "code_missing" };

  const owner = await prisma.linkedAccount.findUnique({
    where: { platform_externalId: { platform, externalId: profile.externalId } },
    select: { userId: true },
  });
  if (owner && owner.userId !== userId) return { ok: false, reason: "taken" };
  if (profile.isPrivate) return { ok: false, reason: "private" };

  try {
    await prisma.linkedAccount.update({
      where: { id: pending.id, verifiedAt: null, verifyCode: pending.verifyCode },
      data: {
        externalId: profile.externalId,
        handle: profile.handle,
        verifiedAt: now,
        verifyCode: null,
        verifyExpiresAt: null,
        lastSyncAttemptAt: null,
      },
    });
  } catch (error) {
    // Another user verified the same platform account a moment earlier.
    if (isUniqueViolation(error)) return { ok: false, reason: "taken" };
    // The pending link changed under us (restarted or confirmed concurrently).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { ok: false, reason: "expired" };
    }
    throw error;
  }
  return { ok: true, handle: profile.handle, externalId: profile.externalId };
}

/**
 * Removes the link and the progress imported from it: that platform's library rows, unlocks
 * and ledger entries are deleted, so the platform account can later be linked again (by this or
 * another user) without paying XP twice. Fraud history stays: suspicious unlocks and voided
 * ledger entries are kept, so a re-link never pays them again. Returns false when nothing was
 * linked.
 */
export async function unlink(userId: string, platform: CodePlatform): Promise<boolean> {
  const removed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.linkedAccount.deleteMany({ where: { userId, platform } });
    if (count === 0) return false;
    await tx.xpLedgerEntry.deleteMany({ where: { userId, platform, voidedAt: null } });
    await tx.userAchievement.deleteMany({
      where: { userId, suspicious: false, achievement: { platform } },
    });
    await tx.userGame.deleteMany({ where: { userId, platform } });
    return true;
  });
  if (removed) await recomputeUser(userId);
  return removed;
}

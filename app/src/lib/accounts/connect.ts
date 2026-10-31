import { prisma } from "@/lib/db";
import { createLimiter } from "@/lib/auth/rate-limit";
import { platformAvailable } from "@/lib/integrations/availability";
import { parseSteamProfileInput } from "@/lib/integrations/steam/profile-lookup";
import { HolderChanged, isKnownError, normalizeLinkHandle, Raced, releaseAccount, settleRelease, unlink } from "./link";
import { lookupProfile, type LinkPlatform, type PlatformProfile } from "./profiles";

/**
 * Connections the Exophase way: the user types each profile in /conta/conexoes (Steam link,
 * custom URL name or SteamID64; PSN online id; gamertag; RA user) and saves. Tralked checks that
 * the profile exists and is public, and links it at once: an active connection (`linkedAt`) that
 * is not verified, which syncs and pays XP like a verified one. No code, no password.
 *
 * - A platform account is on one profile only: when it is already on another one the save is
 *   refused ("taken") and the user may claim it with a code in the profile (./link.ts). An
 *   account of the old Steam login (User.steamId, no row) also counts, so its history is only
 *   recovered through a claim, never by typing the id.
 * - Clearing a field disconnects it, and typing another account replaces it; both lose the XP
 *   that came from the old account (unlink path), so both need `confirmed` (the UI asks first).
 * - Each profile lookup costs a request to the platform: at most SAVE_LOOKUPS_PER_WINDOW per
 *   user per SAVE_WINDOW_MS (same in-memory limiter as the login forms).
 */

export const SAVE_LOOKUPS_PER_WINDOW = 12;
export const SAVE_WINDOW_MS = 15 * 60_000;
const lookupLimiter = createLimiter({ limit: SAVE_LOOKUPS_PER_WINDOW, windowMs: SAVE_WINDOW_MS });

/** Tests only: forgets the lookup counters. */
export function resetConnectionLimits(): void {
  lookupLimiter.clear();
}

export type SaveConnectionResult =
  | { status: "unchanged" }
  /** `value`: what the field shows from now on (Steam: the SteamID64). */
  | { status: "linked"; handle: string; value: string }
  | { status: "unlinked" }
  | { status: "needs_confirm"; action: "unlink" | "replace" }
  | { status: "invalid" | "not_found" | "private" | "taken" | "unavailable" | "error" }
  | { status: "too_soon"; retryAfterSec: number };

type CurrentLink = { externalId: string; handle: string };

/** What the field of a connected account shows (and what typing it again matches). */
export function connectionFieldValue(platform: LinkPlatform, link: CurrentLink): string {
  return platform === "steam" ? link.externalId : link.handle;
}

/** The user's active connection on `platform` (Steam: also an old-login User.steamId without row). */
async function currentLink(userId: string, platform: LinkPlatform): Promise<CurrentLink | null> {
  const row = await prisma.linkedAccount.findUnique({ where: { userId_platform: { userId, platform } } });
  if (row?.linkedAt) return { externalId: row.externalId, handle: row.handle };
  if (platform !== "steam") return null;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { steamId: true } });
  return user.steamId ? { externalId: user.steamId, handle: user.steamId } : null;
}

/** Same account as the current one, judged from the typed text alone (no lookup needed). */
function sameAsTyped(platform: LinkPlatform, typed: string, current: CurrentLink): boolean {
  if (platform === "steam") {
    const ref = parseSteamProfileInput(typed);
    return ref?.kind === "id" && ref.steamId === current.externalId;
  }
  return typed.toLowerCase() === current.handle.toLowerCase();
}

/** Another Tralked profile has this platform account (active link, or an old-login Steam). */
async function heldByAnother(userId: string, platform: LinkPlatform, externalId: string): Promise<boolean> {
  const row = await prisma.linkedAccount.findUnique({
    where: { platform_externalId: { platform, externalId } },
    select: { userId: true },
  });
  if (row && row.userId !== userId) return true;
  if (platform !== "steam") return false;
  const owner = await prisma.user.findFirst({ where: { steamId: externalId, id: { not: userId } }, select: { id: true } });
  return owner !== null;
}

/**
 * Writes the active, unverified connection, replacing `current` (released through the unlink path)
 * in the same transaction: if the new link fails (taken a moment earlier), nothing was undone.
 * Steam also fills User.steamId (its sync reads it). Returns the release to settle afterwards.
 */
async function writeLink(
  userId: string,
  platform: LinkPlatform,
  profile: PlatformProfile,
  current: CurrentLink | null,
  now: Date,
): Promise<{ days: string[] } | null> {
  return prisma.$transaction(async (tx) => {
    const released = current ? await releaseAccount(tx, userId, platform, now, current.externalId) : null;
    await tx.$queryRaw`SELECT id FROM "LinkedAccount" WHERE "userId" = ${userId} AND platform = ${platform} FOR UPDATE`;
    const existing = await tx.linkedAccount.findUnique({ where: { userId_platform: { userId, platform } } });
    // Linked by a concurrent save: never overwritten (its XP would not be voided).
    if (existing?.linkedAt) throw new Raced();
    if (platform === "steam") {
      const { count } = await tx.user.updateMany({
        where: { id: userId, OR: [{ steamId: null }, { steamId: profile.externalId }] },
        // A new Steam: its first import starts from scratch (probes the whole catalog).
        data: { steamId: profile.externalId, lastSyncedAt: null, lastSyncAttemptAt: null },
      });
      if (count === 0) throw new Raced();
    }
    const active = {
      externalId: profile.externalId,
      handle: profile.handle,
      linkedAt: now,
      verifiedAt: null,
      // A pending claim on this row is dropped: the user connected an account instead.
      verifyCode: null,
      verifyExpiresAt: null,
      lastSyncedAt: null,
      lastSyncAttemptAt: null,
    };
    if (existing) await tx.linkedAccount.update({ where: { id: existing.id }, data: active });
    else await tx.linkedAccount.create({ data: { userId, platform, ...active } });
    return released;
  });
}
/**
 * Applies one field of the "Serviços" form: `value` empty disconnects, a new profile connects
 * (replacing the current one when there is one), the same profile changes nothing.
 */
export async function saveConnection(
  userId: string,
  platform: LinkPlatform,
  value: string,
  { confirmed = false, now = new Date() }: { confirmed?: boolean; now?: Date } = {},
): Promise<SaveConnectionResult> {
  const typed = value.trim();
  const current = await currentLink(userId, platform);

  if (typed === "") {
    if (!current) return { status: "unchanged" };
    if (!confirmed) return { status: "needs_confirm", action: "unlink" };
    return (await unlink(userId, platform, now)) ? { status: "unlinked" } : { status: "unchanged" };
  }

  const handle = normalizeLinkHandle(platform, typed);
  if (!handle) return { status: "invalid" };
  if (current && sameAsTyped(platform, handle, current)) return { status: "unchanged" };
  if (platform !== "steam" && !platformAvailable(platform)) return { status: "unavailable" };

  const slot = lookupLimiter.hit(userId, now.getTime());
  if (!slot.ok) return { status: "too_soon", retryAfterSec: slot.retryAfterSec };

  let profile: PlatformProfile | null;
  try {
    profile = await lookupProfile(platform, handle);
  } catch (error) {
    console.error(`Connection: could not read the ${platform} profile`, error instanceof Error ? error.message : String(error));
    return { status: "error" };
  }
  if (!profile) return { status: "not_found" };
  if (profile.isPrivate) return { status: "private" };
  if (current?.externalId === profile.externalId) return { status: "unchanged" };
  // Checked before anything is undone: a refused replacement keeps the current account.
  if (await heldByAnother(userId, platform, profile.externalId)) return { status: "taken" };
  if (current && !confirmed) return { status: "needs_confirm", action: "replace" };

  let released: { days: string[] } | null;
  try {
    released = await writeLink(userId, platform, profile, current, now);
  } catch (error) {
    // A unique violation is either another profile that linked this account a moment earlier, or
    // a concurrent save of this same field creating the user's own row: only the first is "taken".
    if (isKnownError(error, "P2002")) {
      return (await heldByAnother(userId, platform, profile.externalId)) ? { status: "taken" } : { status: "error" };
    }
    // This field changed in a concurrent save (all rolled back).
    if (error instanceof Raced || error instanceof HolderChanged) return { status: "error" };
    throw error;
  }
  if (released) await settleRelease(userId, released, now);
  return {
    status: "linked",
    handle: profile.handle,
    value: connectionFieldValue(platform, profile),
  };
}

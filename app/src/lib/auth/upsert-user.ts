import type { User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getSteam } from "@/lib/integrations";

const MAX_HANDLE_LENGTH = 20;
const FALLBACK_HANDLE = "jogador";
// `/jogador/me` is a route alias, so "me" can never be a real handle.
const RESERVED_HANDLES = new Set(["me"]);

/** Lowercase ASCII `[a-z0-9_]`, at most 20 chars. */
export function slugifyPersonaName(personaName: string): string {
  const slug = personaName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_HANDLE_LENGTH)
    .replace(/_+$/g, "");
  return slug || FALLBACK_HANDLE;
}

const withSuffix = (base: string, suffix: string) =>
  base.slice(0, MAX_HANDLE_LENGTH - suffix.length) + suffix;

/**
 * Picks a unique handle: the slug, then slug + last 4 digits of the steamId,
 * then that plus an incrementing counter.
 */
export async function generateHandle(
  personaName: string,
  steamId: string,
  isTaken: (handle: string) => Promise<boolean>,
): Promise<string> {
  const base = slugifyPersonaName(personaName);
  const unavailable = async (handle: string) =>
    RESERVED_HANDLES.has(handle) || (await isTaken(handle));

  if (!(await unavailable(base))) return base;

  const withDigits = withSuffix(base, steamId.slice(-4));
  if (!(await unavailable(withDigits))) return withDigits;

  for (let counter = 2; ; counter++) {
    const candidate = withSuffix(withDigits, String(counter));
    if (!(await unavailable(candidate))) return candidate;
  }
}

/**
 * Creates the user on first login; refreshes Steam profile data afterwards. The Steam account
 * is mirrored in a verified LinkedAccount (OpenID already proved ownership), kept in sync with
 * the persona name on every login.
 */
export async function upsertUserFromSteam(steamId: string, now: Date = new Date()): Promise<User> {
  const summary = await getSteam().getPlayerSummary(steamId);
  const profile = {
    displayName: summary.personaName,
    avatarUrl: summary.avatarUrl,
    profilePublic: summary.profilePublic,
  };
  const steamAccount = {
    platform: "steam",
    externalId: steamId,
    handle: summary.personaName,
    verifiedAt: now,
  };

  const existing = await prisma.user.findUnique({ where: { steamId } });
  if (existing) {
    return prisma.user.update({
      where: { steamId },
      data: {
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        // Visibility is the user's choice after sign-up (/conta); a private Steam profile still
        // hides the sheet, since nothing can be imported from it.
        ...(profile.profilePublic ? {} : { profilePublic: false }),
        linkedAccounts: {
          upsert: {
            where: { userId_platform: { userId: existing.id, platform: "steam" } },
            create: steamAccount,
            update: { externalId: steamId, handle: summary.personaName },
          },
        },
      },
    });
  }

  const handle = await generateHandle(
    summary.personaName,
    steamId,
    async (candidate) => (await prisma.user.findUnique({ where: { handle: candidate } })) !== null,
  );
  return prisma.user.create({
    data: { steamId, handle, ...profile, linkedAccounts: { create: steamAccount } },
  });
}

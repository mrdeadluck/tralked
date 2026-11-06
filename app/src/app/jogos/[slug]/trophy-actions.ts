"use server";

import { z } from "zod";
import { restOfVersion, type VersionTabTrophy } from "@/components/game/version-views";
import { getGameProfile } from "@/lib/queries/game-profile";

const slugSchema = z.string().trim().min(1).max(200);
const keySchema = z.string().min(1).max(120);

/**
 * "Ver a lista inteira" on the game page's trophy tabs: the trophies of one version after the rows
 * the page already carries. Read from the cached public profile (`getGameProfile`, tagged with
 * the game), so the same for everyone and never a database read per click; hidden trophies stay
 * masked (a player's own come with their marks). Null for an unknown game or version.
 */
export async function moreVersionTrophies(slug: unknown, key: unknown): Promise<VersionTabTrophy[] | null> {
  const s = slugSchema.safeParse(slug);
  const k = keySchema.safeParse(key);
  if (!s.success || !k.success) return null;
  const profile = await getGameProfile(s.data);
  return profile ? restOfVersion(profile.versions, k.data) : null;
}

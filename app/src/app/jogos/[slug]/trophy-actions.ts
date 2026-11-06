"use server";

import { z } from "zod";
import { publicTrophies, type VersionTabTrophy } from "@/components/game/version-views";
import { getGameVersionCached } from "@/lib/queries/game-profile";

const slugSchema = z.string().trim().min(1).max(200);
const keySchema = z.string().min(1).max(120);

/**
 * "Ver a lista inteira" on the game page's trophy tabs: the version's WHOLE public list, which the
 * panel shows in place of its first rows (two snapshots never mix). Read from `getGameVersionCached`
 * (that version alone, cached and tagged with the game), so a click never reruns the whole profile;
 * hidden trophies stay masked (a player's own come with their marks). Null for an unknown game or
 * version.
 */
export async function moreVersionTrophies(slug: unknown, key: unknown): Promise<VersionTabTrophy[] | null> {
  const s = slugSchema.safeParse(slug);
  const k = keySchema.safeParse(key);
  if (!s.success || !k.success) return null;
  const version = await getGameVersionCached(s.data, k.data);
  return version ? publicTrophies(version) : null;
}

"use server";

import { z } from "zod";
import { publicTrophies, type VersionTabTrophy } from "@/components/game/version-views";
import { getGameVersionCached, getGameVersionKeysCached } from "@/lib/queries/game-profile";

const slugSchema = z.string().trim().min(1).max(200);
/** versionKey's shapes: "steam", "psn:<console codes or NPWR id>", "xbox:<titleId>", "retro:<RA game id>". */
const keySchema = z.string().regex(/^(?:steam|psn:[A-Z0-9_+]{1,40}|xbox:\d{1,20}|retro:\d{1,20})$/);

/**
 * "Ver a lista inteira" on the game page's trophy tabs: the version's WHOLE public list, which the
 * panel shows in place of its first rows (two snapshots never mix). Read from `getGameVersionCached`
 * (that version alone, cached and tagged with the game), so a click never reruns the whole profile;
 * hidden trophies stay masked (a player's own come with their marks). Only a key of one of the
 * game's versions gets that read (a made-up key would cost a read and a cache entry). Null for an
 * unknown game or version.
 */
export async function moreVersionTrophies(slug: unknown, key: unknown): Promise<VersionTabTrophy[] | null> {
  const s = slugSchema.safeParse(slug);
  const k = keySchema.safeParse(key);
  if (!s.success || !k.success) return null;
  if (!(await getGameVersionKeysCached(s.data)).includes(k.data)) return null;
  const version = await getGameVersionCached(s.data, k.data);
  return version ? publicTrophies(version) : null;
}

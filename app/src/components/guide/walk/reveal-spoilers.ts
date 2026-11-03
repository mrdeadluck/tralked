"use server";

import { isStaffRole } from "@/lib/admin/access";
import { getSessionUser } from "@/lib/auth/session";
import { previewWalkSpoilers, publishedWalkSpoilers } from "./spoilers-data";
import type { WalkSpoilers } from "./view";

/**
 * The spoilers of one walkthrough (notes, callouts, gated items, hidden achievements and the inline
 * spans of its text and roadmap), fetched only when the reader turns spoilers on or taps "mostrar":
 * until then the page never carries them.
 * Published guides for everyone (cached per guide, under the game's tag); a guide still in review
 * only for staff (the preview, uncached).
 */
export async function revealWalkSpoilers(guideId: string): Promise<WalkSpoilers | null> {
  if (typeof guideId !== "string" || guideId.length === 0 || guideId.length > 64) return null;
  const published = await publishedWalkSpoilers(guideId);
  if (published) return published;
  if (!isStaffRole((await getSessionUser())?.role)) return null;
  return previewWalkSpoilers(guideId);
}

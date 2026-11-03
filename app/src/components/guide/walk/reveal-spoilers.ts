"use server";

import { isStaffRole } from "@/lib/admin/access";
import { getSessionUser } from "@/lib/auth/session";
import { walkthroughSchema } from "@/lib/content/walkthrough-schema";
import { safeImageUrl } from "@/lib/content/url";
import { prisma } from "@/lib/db";
import { walkSpoilers, type HiddenText, type WalkSpoilers } from "./view";

/**
 * The spoilers of one walkthrough (notes, callouts, gated items and hidden achievements), fetched
 * only when the reader turns spoilers on or taps "mostrar": until then the page never carries them.
 * Published guides for everyone; a guide still in review only for staff (the preview).
 */
export async function revealWalkSpoilers(guideId: string): Promise<WalkSpoilers | null> {
  if (typeof guideId !== "string" || guideId.length > 64) return null;
  const guide = await prisma.guide.findFirst({
    where: { id: guideId, format: 2 },
    select: { gameId: true, status: true, walkthrough: true },
  });
  if (!guide) return null;
  if (guide.status !== "published" && !isStaffRole((await getSessionUser())?.role)) return null;
  const walkthrough = walkthroughSchema.safeParse(guide.walkthrough);
  if (!walkthrough.success) return null;

  const rows = await prisma.achievement.findMany({
    where: { gameId: guide.gameId, platform: "steam" },
    select: { apiName: true, name: true, namePt: true, description: true, descriptionPt: true, iconUrl: true, hidden: true },
  });
  const achievements: Record<string, HiddenText & { hidden: boolean }> = {};
  for (const a of rows) {
    achievements[a.apiName] = {
      name: a.namePt ?? a.name,
      description: a.descriptionPt ?? a.description,
      iconUrl: safeImageUrl(a.iconUrl),
      hidden: a.hidden,
    };
  }
  return walkSpoilers(walkthrough.data, achievements);
}

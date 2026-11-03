import { cacheLife, cacheTag } from "next/cache";
import { walkthroughSchema } from "@/lib/content/walkthrough-schema";
import { safeImageUrl } from "@/lib/content/url";
import { prisma } from "@/lib/db";
import { gameTag } from "@/lib/queries/games-cached";
import { walkSpoilers, type HiddenText, type WalkSpoilers } from "./view";

/*
 * The spoilers of a walkthrough, read for revealWalkSpoilers. A published guide's are the same for
 * every reader: cached under the game's tag (every guide write expires it). A guide still in review
 * is read uncached, for staff only (the caller checks the role).
 */

const guideSelect = {
  gameId: true,
  status: true,
  walkthrough: true,
  game: { select: { slug: true } },
  // The roadmap phases, in the order the page shows them (their spans are masked there too).
  steps: { orderBy: { order: "asc" }, select: { title: true, body: true } },
} as const;

async function spoilersOf(guide: { gameId: string; walkthrough: unknown; steps: { title: string; body: string }[] }) {
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
  return walkSpoilers(walkthrough.data, achievements, guide.steps);
}

/** Spoilers of a published walkthrough, cached; null when the guide is not published (or not a walkthrough). */
export async function publishedWalkSpoilers(guideId: string): Promise<WalkSpoilers | null> {
  "use cache";
  cacheLife("hours");
  const guide = await prisma.guide.findFirst({ where: { id: guideId, format: 2 }, select: guideSelect });
  if (!guide) return null;
  cacheTag(gameTag(guide.game.slug));
  return guide.status === "published" ? spoilersOf(guide) : null;
}

/** Spoilers of a walkthrough in any status, uncached: the staff preview (callers check the role). */
export async function previewWalkSpoilers(guideId: string): Promise<WalkSpoilers | null> {
  const guide = await prisma.guide.findFirst({ where: { id: guideId, format: 2 }, select: guideSelect });
  return guide ? spoilersOf(guide) : null;
}

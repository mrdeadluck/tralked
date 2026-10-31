import { revalidateTag } from "next/cache";
import { FORUM_TAG, GALLERY_TAG, photoTag } from "@/lib/community/cached";
import { prisma } from "@/lib/db";
import { playerTag } from "@/lib/queries/players-cached";

/**
 * Cache tags of every public page that shows a player depending on their profile visibility:
 * gallery listings (grid, photo of the week, game pages' community galleries, all tagged
 * `gallery`), each of their photo pages, the forum listings and their own profile page.
 * Invalidated whenever `profilePublic` flips, so "private" takes effect at once.
 */
export async function visibilityTags(userId: string): Promise<string[]> {
  const [user, photos] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { handle: true } }),
    prisma.photo.findMany({ where: { authorId: userId }, select: { id: true } }),
  ]);
  return [
    GALLERY_TAG,
    FORUM_TAG,
    ...photos.map((p) => photoTag(p.id)),
    ...(user ? [playerTag(user.handle)] : []),
  ];
}

/**
 * For code outside Server Actions (the Steam sync turning a profile private, from a route
 * handler, `after()` or the cron): revalidates the visibility tags with `expire: 0`. Outside a
 * Next.js request (scripts) there is no cache to invalidate, so failures are only logged.
 */
export async function revalidateVisibility(userId: string): Promise<void> {
  try {
    for (const tag of await visibilityTags(userId)) revalidateTag(tag, { expire: 0 });
  } catch (error) {
    console.warn("Could not revalidate the profile visibility caches", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

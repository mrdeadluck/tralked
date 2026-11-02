import { cacheLife, cacheTag } from "next/cache";
import { prisma } from "@/lib/db";
import {
  findSection,
  getThread,
  listCategories,
  listGameTopics,
  listSectionThreads,
  recentThreads,
  type ForumSection,
} from "./forum";
import { galleryGame, galleryGames, getPhoto, listPhotos, photoOfTheWeek } from "./gallery";

/** Every public gallery listing (grid, filter, photo of the week). */
export const GALLERY_TAG = "gallery";
export const photoTag = (id: string) => `photo:${id}`;
/** Every forum listing (index, sections). */
export const FORUM_TAG = "forum";
export const threadTag = (id: string) => `thread:${id}`;

// ---------- Gallery ----------

export async function listPhotosCached(gameSlug: string | null, page: number) {
  "use cache";
  cacheLife("minutes");
  cacheTag(GALLERY_TAG);
  return listPhotos({ gameSlug, page });
}

export async function photoOfTheWeekCached() {
  "use cache";
  cacheLife("hours");
  cacheTag(GALLERY_TAG);
  return photoOfTheWeek();
}

export async function galleryGamesCached() {
  "use cache";
  cacheLife("hours");
  cacheTag(GALLERY_TAG);
  return galleryGames();
}

export async function galleryGameCached(slug: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(GALLERY_TAG);
  return galleryGame(slug);
}

export async function getPhotoCached(id: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(photoTag(id));
  return getPhoto(id);
}

// ---------- Forum ----------

export async function forumIndexCached() {
  "use cache";
  cacheLife("minutes");
  cacheTag(FORUM_TAG);
  const [categories, games, recent] = await Promise.all([
    listCategories(),
    listGameTopics(),
    recentThreads(8),
  ]);
  return { categories, games, recent };
}

export async function findSectionCached(segment: string): Promise<ForumSection | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(FORUM_TAG);
  return findSection(segment);
}

export async function listSectionThreadsCached(section: ForumSection, page: number) {
  "use cache";
  cacheLife("minutes");
  cacheTag(FORUM_TAG);
  return listSectionThreads(section, page);
}

export async function getThreadCached(id: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(threadTag(id));
  return getThread(id);
}

// ---------- Comment targets ----------

/** Id of a game's guide (the comment target of the guide page). */
export async function guideIdCached(gameId: string): Promise<string | null> {
  "use cache";
  cacheLife("days");
  const guide = await prisma.guide.findUnique({ where: { gameId }, select: { id: true } });
  return guide?.id ?? null;
}

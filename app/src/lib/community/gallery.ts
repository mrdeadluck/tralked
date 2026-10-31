import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { authorSelect, type AuthorView } from "./comments";
import type { Db } from "./limits";
import { notify } from "./notify";

/** Photos per gallery page (a multiple of 3 keeps the grid rows full). */
export const PHOTOS_PER_PAGE = 24;
const WEEK_MS = 7 * 86_400_000;

export type PhotoCardView = {
  id: string;
  url: string | null;
  width: number;
  height: number;
  caption: string | null;
  likeCount: number;
  commentCount: number;
  createdAt: Date;
  author: AuthorView;
  game: { slug: string; name: string } | null;
};

export type PhotoDetail = PhotoCardView & { authorPhotoCount: number };

const photoSelect = {
  id: true,
  url: true,
  width: true,
  height: true,
  caption: true,
  likeCount: true,
  createdAt: true,
  author: authorSelect,
  game: { select: { slug: true, name: true } },
} satisfies Prisma.PhotoSelect;

type PhotoRow = Prisma.PhotoGetPayload<{ select: typeof photoSelect }>;

async function withCommentCounts(rows: PhotoRow[]): Promise<PhotoCardView[]> {
  if (rows.length === 0) return [];
  const counts = await prisma.comment.groupBy({
    by: ["targetId"],
    where: { targetType: "photo", targetId: { in: rows.map((r) => r.id) }, status: "visible" },
    _count: { _all: true },
  });
  const byId = new Map(counts.map((c) => [c.targetId, c._count._all]));
  return rows.map((r) => ({ ...r, commentCount: byId.get(r.id) ?? 0 }));
}

export type PhotoListing = { photos: PhotoCardView[]; total: number; page: number; pageCount: number };

/** Visible photos, newest first, optionally only one game's. `page` starts at 1. */
export async function listPhotos(filter: { gameSlug?: string | null; page?: number }): Promise<PhotoListing> {
  const where: Prisma.PhotoWhereInput = { status: "visible" };
  if (filter.gameSlug) where.game = { slug: filter.gameSlug };
  const total = await prisma.photo.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PHOTOS_PER_PAGE));
  const page = Math.min(Math.max(1, Math.floor(filter.page ?? 1)), pageCount);
  const rows = await prisma.photo.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PHOTOS_PER_PAGE,
    take: PHOTOS_PER_PAGE,
    select: photoSelect,
  });
  return { photos: await withCommentCounts(rows), total, page, pageCount };
}

/** "Foto da semana": the most liked visible photo posted in the last 7 days (ties: newest). */
export async function photoOfTheWeek(now: Date = new Date()): Promise<PhotoCardView | null> {
  const row = await prisma.photo.findFirst({
    where: { status: "visible", likeCount: { gt: 0 }, createdAt: { gte: new Date(now.getTime() - WEEK_MS) } },
    orderBy: [{ likeCount: "desc" }, { createdAt: "desc" }],
    select: photoSelect,
  });
  if (!row) return null;
  return (await withCommentCounts([row]))[0];
}

/** One visible photo with its author's photo count; null when missing or moderated. */
export async function getPhoto(id: string): Promise<PhotoDetail | null> {
  const row = await prisma.photo.findFirst({ where: { id, status: "visible" }, select: photoSelect });
  if (!row) return null;
  const [card] = await withCommentCounts([row]);
  const authorPhotoCount = row.author
    ? await prisma.photo.count({ where: { authorId: row.author.id, status: "visible" } })
    : 0;
  return { ...card, authorPhotoCount };
}

/** A player's newest visible photos (character sheet gallery) and how many they have in all. */
export async function listPhotosByAuthor(
  authorId: string,
  limit: number,
): Promise<{ photos: PhotoCardView[]; total: number }> {
  const where: Prisma.PhotoWhereInput = { authorId, status: "visible" };
  const [total, rows] = await Promise.all([
    prisma.photo.count({ where }),
    prisma.photo.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: photoSelect,
    }),
  ]);
  return { photos: await withCommentCounts(rows), total };
}

/** Recent visible photos, for generateStaticParams. */
export async function recentPhotoIds(limit: number): Promise<string[]> {
  const rows = await prisma.photo.findMany({
    where: { status: "visible" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export type GameOption = { slug: string; name: string; photoCount: number };

/** Every game (for the upload form) with its number of visible photos (for the filter). */
export async function galleryGames(): Promise<GameOption[]> {
  const games = await prisma.game.findMany({
    orderBy: { name: "asc" },
    select: { slug: true, name: true, _count: { select: { photos: { where: { status: "visible" } } } } },
  });
  return games.map((g) => ({ slug: g.slug, name: g.name, photoCount: g._count.photos }));
}

export type LikeResult = { status: "ok"; liked: boolean; likeCount: number } | { status: "not_found" };

/** Likes the photo, or removes the like when it already exists. Run inside a transaction. */
export async function toggleLike(db: Db, userId: string, photoId: string): Promise<LikeResult> {
  const photo = await db.photo.findFirst({
    where: { id: photoId, status: "visible" },
    select: { authorId: true },
  });
  if (!photo) return { status: "not_found" };

  const removed = await db.photoLike.deleteMany({ where: { userId, photoId } });
  if (removed.count > 0) {
    const updated = await db.photo.update({
      where: { id: photoId },
      data: { likeCount: { decrement: removed.count } },
      select: { likeCount: true },
    });
    return { status: "ok", liked: false, likeCount: updated.likeCount };
  }

  // skipDuplicates keeps a concurrent double click from counting twice.
  const created = await db.photoLike.createMany({ data: [{ userId, photoId }], skipDuplicates: true });
  const updated = await db.photo.update({
    where: { id: photoId },
    data: { likeCount: { increment: created.count } },
    select: { likeCount: true },
  });
  if (created.count > 0) {
    const liker = await db.user.findUnique({ where: { id: userId }, select: { handle: true } });
    await notify(db, {
      userId: photo.authorId,
      actorId: userId,
      kind: "photo_like",
      title: `@${liker?.handle ?? "alguém"} curtiu sua foto`,
      href: `/galeria/${photoId}`,
    });
  }
  return { status: "ok", liked: true, likeCount: updated.likeCount };
}

/** Whether `userId` liked each of `photoIds`. */
export async function likedPhotoIds(userId: string, photoIds: string[]): Promise<Set<string>> {
  if (photoIds.length === 0) return new Set();
  const likes = await prisma.photoLike.findMany({
    where: { userId, photoId: { in: photoIds } },
    select: { photoId: true },
  });
  return new Set(likes.map((l) => l.photoId));
}

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { cleanQuery, foldQueryInDb } from "@/lib/search/normalize";
import { authorSelect, type AuthorView } from "./comments";

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
  dislikeCount: number;
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
  dislikeCount: true,
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

/**
 * Photos shown in public listings (gallery grid, photo of the week, game pages, filter counts):
 * visible, and not by a player whose profile is private. Photos of deleted accounts stay listed.
 */
const LISTED: Prisma.PhotoWhereInput = {
  status: "visible",
  OR: [{ authorId: null }, { author: { profilePublic: true } }],
};

export type PhotoListing = { photos: PhotoCardView[]; total: number; page: number; pageCount: number };

/** Visible photos, newest first, optionally only one game's. `page` starts at 1. */
export async function listPhotos(filter: { gameSlug?: string | null; page?: number }): Promise<PhotoListing> {
  const where: Prisma.PhotoWhereInput = { ...LISTED };
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
    where: { ...LISTED, likeCount: { gt: 0 }, createdAt: { gte: new Date(now.getTime() - WEEK_MS) } },
    orderBy: [{ likeCount: "desc" }, { createdAt: "desc" }],
    select: photoSelect,
  });
  if (!row) return null;
  return (await withCommentCounts([row]))[0];
}

/**
 * One listed photo with its author's photo count; null (404) when missing, moderated or by a
 * player whose profile is private (going private takes the photo pages down too).
 */
export async function getPhoto(id: string): Promise<PhotoDetail | null> {
  const row = await prisma.photo.findFirst({ where: { id, ...LISTED }, select: photoSelect });
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

/** Recent listed photos (never a private profile's), for generateStaticParams. */
export async function recentPhotoIds(limit: number): Promise<string[]> {
  const rows = await prisma.photo.findMany({
    where: LISTED,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export type GameOption = { slug: string; name: string; photoCount: number };

/**
 * The gallery filter: the games that have listed photos, with their count. (The upload form used
 * to receive every catalog game from here, an 8.5 MB page; it now searches with searchUploadGames.)
 */
export async function galleryGames(): Promise<GameOption[]> {
  const games = await prisma.game.findMany({
    where: { photos: { some: LISTED } },
    orderBy: { name: "asc" },
    select: { slug: true, name: true, _count: { select: { photos: { where: LISTED } } } },
  });
  return games.map((g) => ({ slug: g.slug, name: g.name, photoCount: g._count.photos }));
}

/** A game asked for by slug (`/galeria?jogo=`), also without photos yet (its empty grid invites the first). */
export async function galleryGame(slug: string): Promise<GameOption | null> {
  const game = await prisma.game.findUnique({
    where: { slug },
    select: { slug: true, name: true, _count: { select: { photos: { where: LISTED } } } },
  });
  return game ? { slug: game.slug, name: game.name, photoCount: game._count.photos } : null;
}

export type UploadGameOption = { slug: string; name: string };

/** Most matches the upload form's game search returns. */
export const UPLOAD_GAME_RESULTS = 20;

/**
 * The upload form's game search: catalog games whose name contains `query` (accents, case and
 * punctuation ignored, over the trigram index of `searchName`), most popular first. Name-only stubs
 * of the full Steam catalog stay out, as in the old picker. Blank or 1-letter queries: no results.
 */
export async function searchUploadGames(query: string): Promise<UploadGameOption[]> {
  const q = cleanQuery(query);
  if (!q) return [];
  const folded = await foldQueryInDb(q);
  if (folded.length < 2) return [];
  return prisma.game.findMany({
    where: { stub: false, searchName: { contains: folded } },
    orderBy: [{ popularity: "desc" }, { name: "asc" }],
    take: UPLOAD_GAME_RESULTS,
    select: { slug: true, name: true },
  });
}

import type { NextRequest } from "next/server";
import { searchUploadGames, type UploadGameOption } from "@/lib/community/gallery";

export type UploadGameSearch = { games: UploadGameOption[] };

/**
 * GET /galeria/jogos?q=…: the upload form's game search (≤ 20 catalog games, most popular first).
 * Public catalog data, the same for everyone: the CDN keeps each answer, so typing the same letters
 * again does not reach the server.
 */
export async function GET(request: NextRequest) {
  const games = await searchUploadGames(request.nextUrl.searchParams.get("q") ?? "");
  const body: UploadGameSearch = { games };
  return Response.json(body, {
    headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" },
  });
}

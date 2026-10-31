import { authorize } from "@/lib/api/auth";
import { apiError } from "@/lib/api/errors";
import { searchGames } from "@/lib/api/games";

/**
 * GET /api/v1/games?q=…|slug=…|steamAppId=…|igdbId=…: lets a bot find the game it writes about.
 * Any active key may search.
 */
export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const result = await searchGames(new URL(request.url).searchParams);
  if (!result.ok) {
    return apiError("bad_request", result.message, [{ path: result.param, message: result.message }], auth.headers);
  }
  return Response.json({ games: result.games }, { headers: auth.headers });
}

import { authorize } from "@/lib/api/auth";
import { apiError } from "@/lib/api/errors";
import { gameMedia } from "@/lib/api/media";

/**
 * GET /api/v1/games/{slug}/media: the game's wide images (hero, screenshots, artworks) and YouTube
 * video ids from the catalog, so robots can illustrate an article. Any active key may read.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/games/[slug]/media">) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const { slug } = await ctx.params;
  const media = await gameMedia(slug);
  if (!media) return apiError("not_found", "Jogo não encontrado. Procure o jogo em GET /api/v1/games?q=…", [], auth.headers);
  return Response.json(media, { headers: auth.headers });
}

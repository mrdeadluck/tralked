import { authorize } from "@/lib/api/auth";
import { apiError } from "@/lib/api/errors";
import { gameDossier } from "@/lib/api/insights";

/**
 * GET /api/v1/games/{slug}/dossie: the game's sheet, its Tralked aggregates and every visible
 * achievement, for evergreen pieces. Any active key may read; never exposes users.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/games/[slug]/dossie">) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const { slug } = await ctx.params;
  const dossier = await gameDossier(slug);
  if (!dossier) return apiError("not_found", "Jogo não encontrado. Procure o jogo em GET /api/v1/games?q=…", [], auth.headers);
  return Response.json(dossier, { headers: auth.headers });
}

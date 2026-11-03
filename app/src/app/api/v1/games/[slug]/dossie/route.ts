import { authorize } from "@/lib/api/auth";
import { apiError } from "@/lib/api/errors";
import { gameDossier } from "@/lib/api/insights";

/**
 * GET /api/v1/games/{slug}/dossie: the game's sheet, its Tralked aggregates and every visible
 * achievement, for evergreen pieces. Any active key may read; never exposes users.
 * `?all=1` (scope guides:write) also lists the hidden achievements, flagged, with PT-BR names: the
 * guide robot's completeness gate needs every Steam achievement.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/games/[slug]/dossie">) {
  const all = new URL(request.url).searchParams.get("all") === "1";
  const auth = await authorize(request, all ? "guides:write" : undefined);
  if (!auth.ok) return auth.response;
  const { slug } = await ctx.params;
  const dossier = await gameDossier(slug, { all });
  if (!dossier) return apiError("not_found", "Jogo não encontrado. Procure o jogo em GET /api/v1/games?q=…", [], auth.headers);
  return Response.json(dossier, { headers: auth.headers });
}

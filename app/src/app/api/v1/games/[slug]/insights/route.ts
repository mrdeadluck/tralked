import { authorize } from "@/lib/api/auth";
import { apiError } from "@/lib/api/errors";
import { gameInsights } from "@/lib/api/insights";

/**
 * GET /api/v1/games/{slug}/insights: aggregates about the game and its Tralked players (rarest
 * achievements, average playtime). Any active key may read; never exposes users.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/games/[slug]/insights">) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const { slug } = await ctx.params;
  const insights = await gameInsights(slug);
  if (!insights) return apiError("not_found", "Jogo não encontrado. Procure o jogo em GET /api/v1/games?q=…", [], auth.headers);
  return Response.json(insights, { headers: auth.headers });
}

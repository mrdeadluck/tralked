import { authorize } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { claimNextRequest } from "@/lib/guide-requests/queue";

/**
 * POST /api/v1/guide-requests/next: the guide robot takes the next request of the queue (it moves
 * to `researching`). 204 when nothing is waiting. `gameSlug` is the game whose `/dossie` comes next.
 */
export async function POST(request: Request) {
  const auth = await authorize(request, "guides:write");
  if (!auth.ok) return auth.response;

  const claimed = await claimNextRequest(new Date());
  if (!claimed) return new Response(null, { status: 204, headers: auth.headers });

  const game = await prisma.game.findUnique({ where: { steamAppId: claimed.steamAppId }, select: { slug: true } });
  return Response.json(
    { request: { id: claimed.id, steamAppId: claimed.steamAppId, gameSlug: game?.slug ?? null, attempts: claimed.attempts } },
    { headers: auth.headers },
  );
}

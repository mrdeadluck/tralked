import { createArticle } from "@/lib/api/articles";
import { authorize } from "@/lib/api/auth";
import { apiError } from "@/lib/api/errors";
import { listRecentArticles } from "@/lib/api/feed";
import { handleWrite } from "@/lib/api/write";

/**
 * GET /api/v1/articles?since=<ISO>&limit=<1..200>: published articles of any author (default:
 * the last 7 days, newest first), so a robot does not repeat what the site already covers.
 */
export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const result = await listRecentArticles(new URL(request.url).searchParams);
  if (!result.ok) {
    return apiError("bad_request", result.message, [{ path: result.param, message: result.message }], auth.headers);
  }
  return Response.json({ articles: result.articles }, { headers: auth.headers });
}

/** POST /api/v1/articles: a bot creates a news article (review queue without the publish scope). */
export function POST(request: Request) {
  return handleWrite(request, { scope: "articles:write", kind: "article", execute: createArticle });
}

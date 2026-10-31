import { articleStatus, updateArticle } from "@/lib/api/articles";
import { authorize } from "@/lib/api/auth";
import { apiError } from "@/lib/api/errors";
import { handleWrite } from "@/lib/api/write";

/** GET /api/v1/articles/{id}: status of an article created by this key. */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/articles/[id]">) {
  const auth = await authorize(request, "articles:write");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const article = await articleStatus(auth.key, id);
  if (!article) return apiError("not_found", "Notícia não encontrada para esta chave.", [], auth.headers);
  return Response.json(article, { headers: auth.headers });
}

/** PATCH /api/v1/articles/{id}: changes an article created by this key. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/articles/[id]">) {
  const { id } = await ctx.params;
  return handleWrite(request, {
    scope: "articles:write",
    kind: "article",
    execute: (write) => updateArticle(write, id),
  });
}

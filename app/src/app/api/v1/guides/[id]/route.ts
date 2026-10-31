import { authorize } from "@/lib/api/auth";
import { apiError } from "@/lib/api/errors";
import { guideStatus, updateGuide } from "@/lib/api/guides";
import { handleWrite } from "@/lib/api/write";

/** GET /api/v1/guides/{id}: status of a guide created by this key. */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/guides/[id]">) {
  const auth = await authorize(request, "guides:write");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const guide = await guideStatus(auth.key, id);
  if (!guide) return apiError("not_found", "Guia não encontrado para esta chave.", [], auth.headers);
  return Response.json(guide, { headers: auth.headers });
}

/** PATCH /api/v1/guides/{id}: updates a guide created by this key (saves a new version). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/guides/[id]">) {
  const { id } = await ctx.params;
  return handleWrite(request, {
    scope: "guides:write",
    kind: "guide",
    execute: (write) => updateGuide(write, id),
  });
}

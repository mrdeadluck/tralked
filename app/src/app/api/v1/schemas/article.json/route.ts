import { articleJsonSchema } from "@/lib/api/openapi";

/** GET /api/v1/schemas/article.json: JSON Schema of the article payload (public, prerendered). */
export function GET() {
  return Response.json(articleJsonSchema(), { headers: { "Content-Type": "application/schema+json" } });
}

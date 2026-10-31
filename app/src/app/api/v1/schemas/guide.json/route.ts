import { guideJsonSchema } from "@/lib/api/openapi";

/** GET /api/v1/schemas/guide.json: JSON Schema of the guide payload (public, prerendered). */
export function GET() {
  return Response.json(guideJsonSchema(), { headers: { "Content-Type": "application/schema+json" } });
}

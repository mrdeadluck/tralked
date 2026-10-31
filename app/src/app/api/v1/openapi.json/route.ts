import { openApiDocument } from "@/lib/api/openapi";

/** GET /api/v1/openapi.json: OpenAPI 3.1 description of the bot API (public, prerendered). */
export function GET() {
  return Response.json(openApiDocument());
}

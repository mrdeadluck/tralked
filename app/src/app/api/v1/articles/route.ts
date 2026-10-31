import { createArticle } from "@/lib/api/articles";
import { handleWrite } from "@/lib/api/write";

/** POST /api/v1/articles: a bot creates a news article (review queue without the publish scope). */
export function POST(request: Request) {
  return handleWrite(request, { scope: "articles:write", kind: "article", execute: createArticle });
}

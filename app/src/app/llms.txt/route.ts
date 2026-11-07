import { cacheLife, cacheTag } from "next/cache";
import { env } from "@/lib/env";
import { GUIDES_TAG } from "@/lib/queries/home-guides";
import { NEWS_TAG } from "@/lib/queries/news";
import { buildLlmsTxt, loadLlmsData } from "@/lib/seo/llms";

async function llmsTxt() {
  "use cache";
  cacheLife("hours");
  cacheTag(NEWS_TAG, GUIDES_TAG);
  return buildLlmsTxt(await loadLlmsData(), env.APP_URL);
}

/** GET /llms.txt: the site map for AI answer engines (lib/seo/llms.ts). */
export async function GET() {
  return new Response(await llmsTxt(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

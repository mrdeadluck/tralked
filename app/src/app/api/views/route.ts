import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { isBotUserAgent, isPrefetchRequest, recordArticleView, RecentViews } from "@/lib/news/views";

/** Repeat views of one article by one visitor, per server instance (see lib/news/views.ts). */
const recent = new RecentViews();

const ID = /^[\w-]{1,64}$/;

const noContent = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

/** Short, non-reversible visitor key (IP + user agent); never stored outside this memory. */
function visitorKey(request: NextRequest, userAgent: string): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
  return createHash("sha256").update(`${ip}|${userAgent}`).digest("base64url").slice(0, 16);
}

/**
 * POST /api/views `{"articleId": "..."}`: the article page's beacon after it rendered in a
 * visible tab. Always answers 204 (nothing to read, nothing to retry); a view is counted only for
 * a same-site browser request that is not a bot, a prefetch or a recent repeat.
 */
export async function POST(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") ?? "";
  if (isBotUserAgent(userAgent) || isPrefetchRequest(request.headers)) return noContent();
  // Browsers send Sec-Fetch-Site; another site's page cannot count views here.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "same-site") return noContent();

  if (Number(request.headers.get("content-length") ?? 0) > 512) return noContent();
  let articleId: unknown;
  try {
    // sendBeacon posts text/plain; fetch fallbacks post JSON. Both carry the same body.
    articleId = (JSON.parse(await request.text()) as { articleId?: unknown })?.articleId;
  } catch {
    return noContent();
  }
  if (typeof articleId !== "string" || !ID.test(articleId)) return noContent();
  if (!recent.take(`${visitorKey(request, userAgent)}:${articleId}`)) return noContent();

  try {
    await recordArticleView(articleId);
  } catch (error) {
    console.error("recordArticleView failed", error);
  }
  return noContent();
}

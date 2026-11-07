import { INDEXNOW_KEY } from "@/lib/seo/indexnow";

/** The IndexNow key file: search engines read it to trust this site's submissions (lib/seo/indexnow.ts). */
export function GET() {
  return new Response(INDEXNOW_KEY, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}

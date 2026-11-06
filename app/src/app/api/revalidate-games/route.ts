import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { FORUM_TAG, GALLERY_TAG } from "@/lib/community/cached";
import { env } from "@/lib/env";
import { gameTag } from "@/lib/queries/games-cached";

/** Expires the cache of the given games, the forum index and the gallery from outside Next (merge scripts). Same secret as the crons. */
const body = z.object({ slugs: z.array(z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/i)).min(1).max(200) });

function isAuthorized(request: NextRequest): boolean {
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const slugs = [...new Set(parsed.data.slugs)];
  for (const slug of slugs) revalidateTag(gameTag(slug), { expire: 0 });
  revalidateTag(FORUM_TAG, { expire: 0 });
  // The gallery filter names games by slug (/galeria?jogo=<slug>).
  revalidateTag(GALLERY_TAG, { expire: 0 });
  return NextResponse.json({ revalidated: slugs.length });
}

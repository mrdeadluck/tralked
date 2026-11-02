import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";

/**
 * `/jogador/me`: the logged-in user's sheet. A visitor gets the character showcase (what the
 * sheet is, with an example and the way in), not a login wall.
 */
export async function GET() {
  const user = await getSessionUser();
  const target = user ? `/jogador/${encodeURIComponent(user.handle)}` : "/personagem";
  return NextResponse.redirect(new URL(target, env.APP_URL));
}

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";

/** `/jogador/me`: the logged-in user's sheet, or the login page that comes back here. */
export async function GET() {
  const user = await getSessionUser();
  const target = user ? `/jogador/${encodeURIComponent(user.handle)}` : "/entrar?returnTo=%2Fjogador%2Fme";
  return NextResponse.redirect(new URL(target, env.APP_URL));
}

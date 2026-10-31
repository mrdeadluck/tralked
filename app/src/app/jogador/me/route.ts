import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";

/** `/jogador/me`: the logged-in user's sheet, or Steam login that returns here. */
export async function GET() {
  const user = await getSessionUser();
  const target = user
    ? `/jogador/${encodeURIComponent(user.handle)}`
    : "/api/auth/steam?returnTo=/jogador/me";
  return NextResponse.redirect(new URL(target, env.APP_URL));
}

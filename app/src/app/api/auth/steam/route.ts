import { type NextRequest, NextResponse } from "next/server";
import { createOidState } from "@/lib/auth/oid-state";
import { buildSteamLoginUrl } from "@/lib/auth/openid";
import { sanitizeReturnTo } from "@/lib/auth/return-to";
import { env } from "@/lib/env";

/** Starts the Steam OpenID login; `?returnTo=/path` and a CSRF `state` are carried through the callback URL. */
export async function GET(request: NextRequest) {
  const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  const state = await createOidState();

  const callback = new URL("/api/auth/steam/callback", env.APP_URL);
  callback.searchParams.set("returnTo", returnTo);
  callback.searchParams.set("state", state);

  return NextResponse.redirect(buildSteamLoginUrl(callback.toString(), new URL(env.APP_URL).origin));
}

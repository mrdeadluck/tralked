import { type NextRequest, NextResponse } from "next/server";
import { verifySteamAssertion } from "@/lib/auth/openid";
import { DEFAULT_RETURN_TO, sanitizeReturnTo } from "@/lib/auth/return-to";
import { createSession } from "@/lib/auth/session";
import { upsertUserFromSteam } from "@/lib/auth/upsert-user";
import { env } from "@/lib/env";
import { syncUser } from "@/lib/sync/user";

const redirectTo = (path: string) => NextResponse.redirect(new URL(path, env.APP_URL));

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // The assertion must be answering a login we started, not one for another site.
  const expectedReturnTo = new URL("/api/auth/steam/callback", env.APP_URL).toString();
  if (!params.get("openid.return_to")?.startsWith(expectedReturnTo)) {
    return redirectTo("/?login=erro");
  }

  const steamId = await verifySteamAssertion(params);
  if (!steamId) return redirectTo("/?login=erro");

  let user;
  try {
    user = await upsertUserFromSteam(steamId);
  } catch (error) {
    console.error("Steam login: could not load or create the user", error);
    return redirectTo("/?login=erro");
  }

  await createSession(user.id);

  // A failed sync must never block the login itself.
  try {
    await syncUser(user.id);
  } catch (error) {
    console.error("Steam login: initial sync failed", error);
  }

  const returnTo = sanitizeReturnTo(params.get("returnTo"));
  return redirectTo(returnTo === DEFAULT_RETURN_TO ? `/jogador/${user.handle}` : returnTo);
}

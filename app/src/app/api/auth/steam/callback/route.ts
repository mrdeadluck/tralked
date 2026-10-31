import { after, type NextRequest, NextResponse } from "next/server";
import { consumeOidState } from "@/lib/auth/oid-state";
import { verifySteamAssertion } from "@/lib/auth/openid";
import { DEFAULT_RETURN_TO, sanitizeReturnTo } from "@/lib/auth/return-to";
import { linkSteamToUser } from "@/lib/auth/link-steam";
import { createSession, getSessionUser } from "@/lib/auth/session";
import { upsertUserFromSteam } from "@/lib/auth/upsert-user";
import { env } from "@/lib/env";
import { syncUser } from "@/lib/sync/user";

const redirectTo = (path: string) => NextResponse.redirect(new URL(path, env.APP_URL));
/**
 * A failed login goes home with a reason the page explains (`LoginNotice`) and the server logs:
 * `estado` = the browser lost or replaced the login cookie (expired, another tab, cookies blocked);
 * `steam` = Steam did not confirm the assertion; `conta` = the account could not be loaded/created.
 */
type FailReason = "estado" | "steam" | "conta";
const fail = (reason: FailReason, detail: string) => {
  console.warn(`Steam login failed (${reason}): ${detail}`);
  return redirectTo(`/?login=erro&motivo=${reason}`);
};

/** The signed `openid.return_to` must be exactly our callback (origin + path), never a prefix match. */
function parseOwnReturnTo(value: string | null): URL | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const own = new URL("/api/auth/steam/callback", env.APP_URL);
  return url.origin === own.origin && url.pathname === own.pathname ? url : null;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // Always consume the state cookie, whatever happens next.
  const stateOk = await consumeOidState(params.get("state"));

  // The assertion must be answering a login this browser started, for this site.
  const returnToUrl = parseOwnReturnTo(params.get("openid.return_to"));
  if (!stateOk) return fail("estado", "state cookie missing or different from the callback's state");
  if (!returnToUrl) return fail("estado", `openid.return_to is not this site's callback (${params.get("openid.return_to")})`);
  // `state` and `returnTo` also have to match what Steam signed, not just the unsigned query string.
  if (returnToUrl.searchParams.get("state") !== params.get("state")) return fail("estado", "signed return_to state differs");

  const steamId = await verifySteamAssertion(params);
  if (!steamId) return fail("steam", "assertion rejected (mode, endpoint, claimed_id, signed fields, nonce or check_authentication)");

  // Logged in without Steam (e.g. a Google-only account): link Steam to that account instead of
  // creating a second one. Anyone else (logged out, or already with Steam) gets a normal login.
  const sessionUser = await getSessionUser();
  const linking = sessionUser !== null && sessionUser.steamId === null;

  let user;
  try {
    if (linking) {
      const result = await linkSteamToUser(sessionUser.id, steamId);
      if (!result.ok) {
        return redirectTo(`/conta/conexoes?erro=${result.reason === "in_use" ? "steam_em_uso" : "steam_diferente"}`);
      }
      user = result.user;
    } else {
      user = await upsertUserFromSteam(steamId);
    }
  } catch (error) {
    console.error("Steam login: could not load or create the user", error);
    return fail("conta", "upsert/link threw");
  }

  if (!linking) await createSession(user.id);

  // The first sync can take minutes (whole library, new games cataloged), so it runs after the
  // response: the session cookie and redirect go out right away, and the character page shows
  // "Ainda não sincronizado" meanwhile. A failed sync never blocks the login; cron retries it.
  const userId = user.id;
  after(async () => {
    try {
      await syncUser(userId);
    } catch (error) {
      console.error("Steam login: initial sync failed", error);
    }
  });

  const returnTo = sanitizeReturnTo(returnToUrl.searchParams.get("returnTo"));
  return redirectTo(returnTo === DEFAULT_RETURN_TO ? `/jogador/${user.handle}` : returnTo);
}

import { after, type NextRequest, NextResponse } from "next/server";
import { consumeOidState } from "@/lib/auth/oid-state";
import { verifySteamAssertion } from "@/lib/auth/openid";
import { DEFAULT_RETURN_TO, sanitizeReturnTo } from "@/lib/auth/return-to";
import { linkSteamToUser } from "@/lib/auth/link-steam";
import { createSession, getSessionUser } from "@/lib/auth/session";
import { upsertUserFromSteam } from "@/lib/auth/upsert-user";
import { env } from "@/lib/env";
import { claimSyncSlot } from "@/lib/sync/claim";
import { syncUser } from "@/lib/sync/user";

const redirectTo = (path: string) => NextResponse.redirect(new URL(path, env.APP_URL));
const fail = () => redirectTo("/?login=erro");

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
  if (!stateOk || !returnToUrl) return fail();
  // `state` and `returnTo` also have to match what Steam signed, not just the unsigned query string.
  if (returnToUrl.searchParams.get("state") !== params.get("state")) return fail();

  const steamId = await verifySteamAssertion(params);
  if (!steamId) return fail();

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
    return fail();
  }

  if (!linking) await createSession(user.id);

  // The first sync can take minutes (whole library, new games cataloged), so it runs after the
  // response: the session cookie and redirect go out right away, and the character page shows
  // "Ainda não sincronizado" meanwhile. A failed sync never blocks the login; cron retries it.
  // It claims the same rate-limit slot as "Sincronizar": logging in again within the interval (or
  // while the cron or a manual sync runs) does not stack another sync.
  const userId = user.id;
  after(async () => {
    try {
      if (!(await claimSyncSlot(userId))) return;
      await syncUser(userId);
    } catch (error) {
      console.error("Steam login: initial sync failed", error);
    }
  });

  const returnTo = sanitizeReturnTo(returnToUrl.searchParams.get("returnTo"));
  return redirectTo(returnTo === DEFAULT_RETURN_TO ? `/jogador/${user.handle}` : returnTo);
}

const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";
const CLAIMED_ID_PATTERN = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

/**
 * URL that sends the browser to Steam's OpenID login page.
 * `returnTo` is the absolute callback URL Steam redirects back to; `realm` is
 * the site origin Steam shows to the user and must be a prefix of `returnTo`.
 */
export function buildSteamLoginUrl(returnTo: string, realm: string): string {
  const params = new URLSearchParams({
    "openid.ns": OPENID_NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": IDENTIFIER_SELECT,
    "openid.claimed_id": IDENTIFIER_SELECT,
  });
  return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`;
}

/**
 * Validates the OpenID assertion Steam sent back to the callback by replaying it
 * to Steam with `check_authentication`. Returns the SteamID64 or null if invalid.
 */
export async function verifySteamAssertion(params: URLSearchParams): Promise<string | null> {
  if (params.get("openid.mode") !== "id_res") return null;

  const steamId = CLAIMED_ID_PATTERN.exec(params.get("openid.claimed_id") ?? "")?.[1];
  if (!steamId) return null;

  const body = new URLSearchParams(params);
  body.set("openid.mode", "check_authentication");

  try {
    const response = await fetch(STEAM_OPENID_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) return null;
    const text = await response.text();
    return /^is_valid:true$/m.test(text) ? steamId : null;
  } catch {
    return null;
  }
}

const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";
const CLAIMED_ID_PATTERN = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

const STEAM_REQUEST_TIMEOUT_MS = 10_000;
const MAX_NONCE_AGE_MS = 5 * 60 * 1000;
// Fields Steam must have signed for the assertion to bind identity, target and freshness.
const REQUIRED_SIGNED_FIELDS = ["claimed_id", "identity", "return_to", "response_nonce"];

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

/** `response_nonce` starts with a UTC timestamp (`YYYY-MM-DDThh:mm:ssZ`); stale or malformed ones are rejected. */
function isFreshNonce(nonce: string | null): boolean {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/.exec(nonce ?? "");
  if (!match) return false;
  const issuedAt = Date.parse(match[1]);
  return Number.isFinite(issuedAt) && Math.abs(Date.now() - issuedAt) <= MAX_NONCE_AGE_MS;
}

/**
 * Validates the OpenID assertion Steam sent back to the callback by replaying it
 * to Steam with `check_authentication`. Returns the SteamID64 or null if invalid.
 *
 * Everything we read locally must be exactly what we forward to Steam, so any
 * repeated `openid.*` parameter is rejected outright.
 */
export async function verifySteamAssertion(params: URLSearchParams): Promise<string | null> {
  const openidFields = new Map<string, string>();
  for (const [key, value] of params) {
    if (!key.startsWith("openid.")) continue;
    if (openidFields.has(key)) return null;
    openidFields.set(key, value);
  }

  if (openidFields.get("openid.mode") !== "id_res") return null;
  if (openidFields.get("openid.op_endpoint") !== STEAM_OPENID_ENDPOINT) return null;

  const claimedId = openidFields.get("openid.claimed_id") ?? "";
  const steamId = CLAIMED_ID_PATTERN.exec(claimedId)?.[1];
  if (!steamId) return null;
  if (openidFields.get("openid.identity") !== claimedId) return null;

  const signed = (openidFields.get("openid.signed") ?? "").split(",");
  if (!REQUIRED_SIGNED_FIELDS.every((field) => signed.includes(field))) return null;

  if (!isFreshNonce(openidFields.get("openid.response_nonce") ?? null)) return null;

  const body = new URLSearchParams([...openidFields]);
  body.set("openid.mode", "check_authentication");

  try {
    const response = await fetch(STEAM_OPENID_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(STEAM_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const text = await response.text();
    return /^is_valid:true$/m.test(text) ? steamId : null;
  } catch {
    return null;
  }
}

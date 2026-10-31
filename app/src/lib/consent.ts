/*
 * Cookie consent (LGPD). The site only sets necessary cookies (session, login state). The visitor's
 * choice is remembered in a first-party cookie; anything optional added later (measurement,
 * advertising) must check `optionalAllowed` first. Kept free of React so it can be unit-tested.
 */

export const CONSENT_COOKIE = "tk_consent";
/** One year, as the privacy policy says. */
export const CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export type ConsentChoice = "necessary" | "all";

/** The stored choice from a `document.cookie` string, or null when the visitor has not chosen. */
export function readConsent(cookieHeader: string): ConsentChoice | null {
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== CONSENT_COOKIE) continue;
    const value = rest.join("=");
    return value === "necessary" || value === "all" ? value : null;
  }
  return null;
}

/** The Set-Cookie string for the choice (`Secure` on https). */
export function consentCookie(choice: ConsentChoice, secure: boolean): string {
  return `${CONSENT_COOKIE}=${choice}; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Optional cookies only with an explicit "all"; no choice means necessary only. */
export const optionalAllowed = (choice: ConsentChoice | null) => choice === "all";

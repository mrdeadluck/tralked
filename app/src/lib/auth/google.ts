import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { cookies } from "next/headers";
import { Prisma, type User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { timeoutSignal } from "@/lib/integrations/http";
import { generateHandle } from "./upsert-user";

/**
 * Google login (OpenID Connect, Authorization Code + PKCE). Creates a reader account, or links
 * Google to the account of the user who is already logged in. Off (routes answer 404, the UI
 * hides the button) unless GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
export const GOOGLE_COOKIE = "gl_google_oauth";
const COOKIE_MAX_AGE_SECONDS = 10 * 60;
export const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";

export function googleLoginEnabled(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

const base64url = (bytes: Buffer) => bytes.toString("base64url");

/** PKCE S256 challenge of a verifier (RFC 7636). */
export function pkceChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export type GoogleAuthState = { state: string; nonce: string; verifier: string; returnTo: string };

export function buildGoogleAuthUrl(
  clientId: string,
  redirectUri: string,
  { state, nonce, verifier }: GoogleAuthState,
): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/** Starts a login: stores state/nonce/verifier in a short-lived httpOnly cookie and returns Google's URL. */
export async function startGoogleLogin(returnTo: string): Promise<string> {
  const auth: GoogleAuthState = {
    state: base64url(randomBytes(16)),
    nonce: base64url(randomBytes(16)),
    verifier: base64url(randomBytes(32)),
    returnTo,
  };
  const cookieStore = await cookies();
  cookieStore.set(GOOGLE_COOKIE, JSON.stringify(auth), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.APP_URL.startsWith("https"),
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return buildGoogleAuthUrl(
    env.GOOGLE_CLIENT_ID ?? "",
    new URL(GOOGLE_CALLBACK_PATH, env.APP_URL).toString(),
    auth,
  );
}

/** One-shot: always clears the cookie; returns the stored login only if `state` matches it. */
export async function consumeGoogleLogin(state: string | null): Promise<GoogleAuthState | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(GOOGLE_COOKIE)?.value;
  cookieStore.delete(GOOGLE_COOKIE);
  if (!raw || !state) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GoogleAuthState>;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.verifier !== "string" ||
      typeof parsed.returnTo !== "string"
    ) {
      return null;
    }
    return parsed.state === state ? (parsed as GoogleAuthState) : null;
  } catch {
    return null;
  }
}

export type GoogleClaims = {
  sub: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
};

export type GoogleClientConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: typeof fetch;
  /** Injectable for tests; defaults to Google's published keys. */
  keys?: JWTVerifyGetKey;
};

let remoteKeys: JWTVerifyGetKey | undefined;

/**
 * Exchanges the authorization code (with the PKCE verifier) and validates the ID token:
 * signature, issuer, audience, expiry and nonce. Errors never include the code or secrets.
 */
export async function exchangeGoogleCode(
  config: GoogleClientConfig,
  code: string,
  auth: Pick<GoogleAuthState, "nonce" | "verifier">,
): Promise<GoogleClaims> {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: auth.verifier,
    }).toString(),
    signal: timeoutSignal(),
  });
  if (!res.ok) throw new Error(`Google token request failed with HTTP ${res.status}`);
  const { id_token: idToken } = (await res.json()) as { id_token?: string };
  if (!idToken) throw new Error("Google token response has no id_token");

  const keys = config.keys ?? (remoteKeys ??= createRemoteJWKSet(new URL(JWKS_URL)));
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: ISSUERS,
    audience: config.clientId,
  });
  if (payload.nonce !== auth.nonce) throw new Error("Google ID token nonce mismatch");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("Google ID token has no sub");
  const str = (value: unknown) => (typeof value === "string" && value ? value : undefined);
  return {
    sub: payload.sub,
    email: str(payload.email),
    emailVerified: payload.email_verified === true,
    name: str(payload.name),
    picture: str(payload.picture),
  };
}

export type GoogleUpsertResult =
  | { ok: true; user: User }
  /** taken: this Google account belongs to another user; different: the logged-in account is
   * already linked to another Google account (never replaced silently). */
  | { ok: false; reason: "taken" | "different" };

const httpsOrUndefined = (url: string | undefined) => (url?.startsWith("https://") ? url : undefined);

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * Logged in (`sessionUserId`): links Google to that account, unless this Google account already
 * belongs to someone else or the account is already linked to a different Google account.
 * Logged out: logs in the account linked to this Google account, or creates a reader account
 * (no Steam) for it.
 */
export async function upsertUserFromGoogle(
  claims: GoogleClaims,
  sessionUserId: string | null,
): Promise<GoogleUpsertResult> {
  const email = claims.emailVerified ? claims.email : undefined;
  const owner = await prisma.user.findUnique({ where: { googleSub: claims.sub } });

  if (sessionUserId) {
    if (owner && owner.id !== sessionUserId) return { ok: false, reason: "taken" };
    const current = await prisma.user.findUniqueOrThrow({ where: { id: sessionUserId } });
    if (current.googleSub && current.googleSub !== claims.sub) return { ok: false, reason: "different" };
    if (current.googleSub === claims.sub) return { ok: true, user: current };
    try {
      // The `googleSub: null` guard makes a concurrent link of another Google account fail
      // instead of replacing it.
      const { count } = await prisma.user.updateMany({
        where: { id: sessionUserId, googleSub: null },
        data: { googleSub: claims.sub, email: current.email ?? email },
      });
      if (count === 0) return { ok: false, reason: "different" };
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false, reason: "taken" };
      throw error;
    }
    return { ok: true, user: await prisma.user.findUniqueOrThrow({ where: { id: sessionUserId } }) };
  }

  if (owner) return { ok: true, user: owner };

  const displayName = (claims.name ?? email?.split("@")[0] ?? "Leitor").slice(0, 60);
  const handle = await generateHandle(
    displayName,
    claims.sub,
    async (candidate) => (await prisma.user.findUnique({ where: { handle: candidate } })) !== null,
  );
  try {
    const user = await prisma.user.create({
      data: {
        googleSub: claims.sub,
        email,
        handle,
        displayName,
        avatarUrl: httpsOrUndefined(claims.picture),
      },
    });
    return { ok: true, user };
  } catch (error) {
    // The same Google account finished a second login at the same moment.
    if (!isUniqueViolation(error)) throw error;
    const raced = await prisma.user.findUnique({ where: { googleSub: claims.sub } });
    if (!raced) throw error;
    return { ok: true, user: raced };
  }
}

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export const OID_STATE_COOKIE = "gl_oid_state";
const OID_STATE_MAX_AGE_SECONDS = 10 * 60;

/**
 * Login-CSRF protection: binds a login attempt to the browser that started it.
 * Sets a short-lived cookie and returns the nonce to embed in the OpenID return_to.
 */
export async function createOidState(): Promise<string> {
  const state = randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set(OID_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.APP_URL.startsWith("https"),
    path: "/",
    maxAge: OID_STATE_MAX_AGE_SECONDS,
  });
  return state;
}

/** One-shot: always clears the cookie; true only if it matches the state echoed back. */
export async function consumeOidState(received: string | null | undefined): Promise<boolean> {
  const cookieStore = await cookies();
  const expected = cookieStore.get(OID_STATE_COOKIE)?.value;
  cookieStore.delete(OID_STATE_COOKIE);
  return Boolean(expected) && Boolean(received) && expected === received;
}

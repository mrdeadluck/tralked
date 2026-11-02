import { after, connection, type NextRequest, NextResponse } from "next/server";
import { sendWelcomeEmail } from "@/lib/auth/email-verification";
import {
  consumeGoogleLogin,
  exchangeGoogleCode,
  GOOGLE_CALLBACK_PATH,
  googleLoginEnabled,
  upsertUserFromGoogle,
} from "@/lib/auth/google";
import { DEFAULT_RETURN_TO, sanitizeReturnTo } from "@/lib/auth/return-to";
import { createSession, getSessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { isBanned } from "@/lib/moderation/permissions";

const redirectTo = (path: string) => NextResponse.redirect(new URL(path, env.APP_URL));

export async function GET(request: NextRequest) {
  // Request time, never prerendered: the 404 depends on runtime env, not on the build's env.
  await connection();
  if (!googleLoginEnabled() || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return new NextResponse(null, { status: 404 });
  }
  const params = request.nextUrl.searchParams;

  // Always consume the cookie; the login must be one this browser started (CSRF).
  const auth = await consumeGoogleLogin(params.get("state"));
  const code = params.get("code");
  if (!auth || !code || params.get("error")) return redirectTo("/?login=erro");

  const sessionUser = await getSessionUser();
  let result;
  try {
    const claims = await exchangeGoogleCode(
      {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectUri: new URL(GOOGLE_CALLBACK_PATH, env.APP_URL).toString(),
      },
      code,
      auth,
    );
    result = await upsertUserFromGoogle(claims, sessionUser?.id ?? null);
  } catch (error) {
    console.error("Google login failed", error instanceof Error ? error.message : String(error));
    return redirectTo("/?login=erro");
  }
  if (!result.ok) {
    return redirectTo(
      result.reason === "different"
        ? "/conta/conexoes?erro=google_diferente"
        : result.reason === "email_taken"
          ? "/entrar?erro=google_email"
          : "/?login=google_em_uso",
    );
  }

  // A suspended account gets no session (getSessionUser would refuse it anyway).
  if (isBanned(result.user)) return redirectTo("/entrar?erro=suspensa");
  if (!sessionUser) await createSession(result.user.id);
  if (result.created && result.user.email) {
    const userId = result.user.id;
    after(async () => {
      try {
        await sendWelcomeEmail(userId);
      } catch (error) {
        console.error("Welcome e-mail failed", error instanceof Error ? error.message : String(error));
      }
    });
  }
  const returnTo = sanitizeReturnTo(auth.returnTo);
  return redirectTo(returnTo === DEFAULT_RETURN_TO ? `/jogador/${result.user.handle}` : returnTo);
}

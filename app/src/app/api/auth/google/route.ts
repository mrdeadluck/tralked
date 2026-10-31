import { connection, type NextRequest, NextResponse } from "next/server";
import { googleLoginEnabled, startGoogleLogin } from "@/lib/auth/google";
import { sanitizeReturnTo } from "@/lib/auth/return-to";

/** Starts the Google login (`?returnTo=/path`). 404 when Google login is not configured. */
export async function GET(request: NextRequest) {
  // Request time, never prerendered: the 404 depends on runtime env, not on the build's env.
  await connection();
  if (!googleLoginEnabled()) return new NextResponse(null, { status: 404 });
  const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  return NextResponse.redirect(await startGoogleLogin(returnTo));
}

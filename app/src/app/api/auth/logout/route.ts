import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";
import { env } from "@/lib/env";

export async function POST() {
  await destroySession();
  // 303 so the browser follows the redirect with GET after the POST.
  return NextResponse.redirect(new URL("/", env.APP_URL), 303);
}

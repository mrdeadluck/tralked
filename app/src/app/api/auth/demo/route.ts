import { connection, NextResponse } from "next/server";
import { createSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { env, hasKey } from "@/lib/env";

const DEMO_HANDLE = "lucas";

/** Offline login as the seeded demo user. Only exists outside production and without a Steam API key. */
export async function GET() {
  // Env is read at request time, never baked into a prerendered response.
  await connection();
  if (hasKey("STEAM_API_KEY") || process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const user = await prisma.user.findUnique({ where: { handle: DEMO_HANDLE } });
  if (!user) return new NextResponse("Demo user not found. Run `pnpm db:seed`.", { status: 404 });

  await createSession(user.id);
  return NextResponse.redirect(new URL(`/jogador/${user.handle}`, env.APP_URL));
}

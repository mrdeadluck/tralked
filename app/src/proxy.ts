import { NextResponse, type NextRequest } from "next/server";
import { canAccess, requiredLevel } from "@/lib/admin/access";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/**
 * /admin answers a real 404 to anyone without the role, before anything renders: the pages are
 * partially prerendered, so a check inside them can only stream a not-found page with status 200.
 * The pages and every Server Action still check the role themselves.
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const userId = token ? await verifySessionToken(token) : null;
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }) : null;
  if (canAccess(user?.role, requiredLevel(request.nextUrl.pathname))) return NextResponse.next();
  // An unknown path renders the site's not-found page with a 404 status.
  return NextResponse.rewrite(new URL("/admin-nao-encontrado", request.url), { status: 404 });
}

export const config = {
  matcher: "/admin/:path*",
};

import { NextResponse, type NextRequest } from "next/server";
import { adminPath, canAccess, requiredLevel } from "@/lib/admin/access";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { boardHref, legacySkillBoard } from "@/lib/highscores/boards";

/**
 * /admin answers a real 404 to anyone without the role, before anything renders: the pages are
 * partially prerendered, so a check inside them can only stream a not-found page with status 200.
 * The path is normalized first (percent-decoding, case, repeated and trailing slashes), so
 * `/ADMIN/`, `/%61dmin` or `//admin//robos` are judged like `/admin` and `/admin/robos`.
 * The pages and every Server Action still check the role themselves.
 *
 * Also: old `/highscores?skill=<id>` links (Plano 1) get a permanent redirect (308) to that
 * genre's board, `/highscores/genero/<id>`, before the prerendered page is served.
 */
export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/highscores") {
    const board = legacySkillBoard(request.nextUrl.searchParams.get("skill") ?? undefined);
    if (board) return NextResponse.redirect(new URL(boardHref(board), request.url), 308);
  }

  const path = adminPath(request.nextUrl.pathname);
  if (path === null) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const userId = token ? await verifySessionToken(token) : null;
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }) : null;
  if (canAccess(user?.role, requiredLevel(path))) return NextResponse.next();
  // An unknown path renders the site's not-found page with a 404 status.
  return NextResponse.rewrite(new URL("/admin-nao-encontrado", request.url), { status: 404 });
}

export const config = {
  // Every page request (any spelling of /admin must reach the check); static assets are skipped.
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};

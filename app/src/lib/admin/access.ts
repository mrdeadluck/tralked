/**
 * Which role an /admin path needs, shared by the proxy (real 404 status before rendering) and
 * documented next to the pages, which check the same level again on the server.
 */

export type AccessLevel = "staff" | "admin";

/** Sections only admins manage (API keys, feeds, roles, fraud, game overrides). */
export const ADMIN_ONLY_SECTIONS = ["/admin/fraude", "/admin/jogos", "/admin/robos", "/admin/feeds", "/admin/usuarios"];

/**
 * The path in canonical form (percent-decoded until stable, lowercase, backslashes as slashes,
 * repeated and trailing slashes removed) when it is /admin or below it, else null.
 */
export function adminPath(pathname: string): string | null {
  let path = pathname;
  for (let i = 0; i < 3; i++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      break;
    }
    if (decoded === path) break;
    path = decoded;
  }
  path = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();
  if (path.length > 1) path = path.replace(/\/+$/, "");
  // "/admin;x" and "/admin.x" style variants are not routes, but match them too.
  return /^\/admin(?:[/;.]|$)/.test(path) ? path : null;
}

export function requiredLevel(pathname: string): AccessLevel {
  const path = adminPath(pathname) ?? pathname;
  return ADMIN_ONLY_SECTIONS.some((section) => path === section || path.startsWith(`${section}/`))
    ? "admin"
    : "staff";
}

export const isStaffRole = (role: string | null | undefined) => role === "admin" || role === "editor";

export function canAccess(role: string | null | undefined, level: AccessLevel): boolean {
  return level === "admin" ? role === "admin" : isStaffRole(role);
}

/**
 * Which role an /admin path needs, shared by the proxy (real 404 status before rendering) and
 * documented next to the pages, which check the same level again on the server.
 */

export type AccessLevel = "staff" | "admin";

/** Sections only admins manage (API keys, feeds, roles, fraud, game overrides). */
export const ADMIN_ONLY_SECTIONS = ["/admin/fraude", "/admin/jogos", "/admin/robos", "/admin/feeds", "/admin/usuarios"];

export function requiredLevel(pathname: string): AccessLevel {
  return ADMIN_ONLY_SECTIONS.some((section) => pathname === section || pathname.startsWith(`${section}/`))
    ? "admin"
    : "staff";
}

export const isStaffRole = (role: string | null | undefined) => role === "admin" || role === "editor";

export function canAccess(role: string | null | undefined, level: AccessLevel): boolean {
  return level === "admin" ? role === "admin" : isStaffRole(role);
}

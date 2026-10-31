import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * Paths answered by route handlers that redirect (`/jogador/me` → the player's sheet or the
 * login, `/api/…`). A next/link client navigation would fetch them as an RSC payload and only
 * then fall back to a full navigation, and its prefetch would hit the handler on every page
 * view. They get a plain <a>.
 */
export function needsFullNavigation(href: string): boolean {
  return href === "/jogador/me" || href.startsWith("/jogador/me?") || href.startsWith("/api/");
}

/** next/link for pages; a plain <a> for redirecting route handlers (see `needsFullNavigation`). */
export function NavLink({ href, ...props }: Omit<ComponentProps<"a">, "href"> & { href: string }) {
  if (needsFullNavigation(href)) return <a href={href} {...props} />;
  return <Link href={href} {...props} />;
}

import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * Paths answered by route handlers that redirect (often off-site, e.g. `/jogador/me` → Steam
 * login). A next/link client navigation would fetch them as an RSC payload, fail on the
 * cross-origin redirect (CORS) and only then fall back to a full navigation, and its prefetch
 * would start a Steam login (new state cookie) on every page view. They get a plain <a>.
 */
export function needsFullNavigation(href: string): boolean {
  return href === "/jogador/me" || href.startsWith("/jogador/me?") || href.startsWith("/api/");
}

/** next/link for pages; a plain <a> for redirecting route handlers (see `needsFullNavigation`). */
export function NavLink({ href, ...props }: Omit<ComponentProps<"a">, "href"> & { href: string }) {
  if (needsFullNavigation(href)) return <a href={href} {...props} />;
  return <Link href={href} {...props} />;
}

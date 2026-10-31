/** The logged-in user's own sheet: a redirect, to Steam's login page for visitors. */
export const MY_SHEET_HREF = "/jogador/me";

/**
 * `prefetch` for a `<Link>`: never prefetch `/jogador/me`. For a visitor it redirects off-site
 * (steamcommunity.com), so a prefetch would follow that redirect and log a CORS error on every
 * page. Other links keep Next's default.
 */
export function prefetchFor(href: string): false | undefined {
  return href === MY_SHEET_HREF ? false : undefined;
}

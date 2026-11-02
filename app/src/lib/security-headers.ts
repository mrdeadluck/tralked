/**
 * Security headers sent with every response (next.config.ts `headers()`); Vercel already sends HSTS.
 * Kept to what cannot break the site: no script/style/image policy (the art is hotlinked from
 * Steam, IGDB, SteamGridDB and press sites), no `form-action` (the Steam sign-in leaves the site
 * after a form post).
 *
 * - no page may be framed by another site (clickjacking): X-Frame-Options and `frame-ancestors`;
 * - no MIME sniffing; no `<base>` hijack; no plugins (`object-src`);
 * - other sites get only the origin as referrer;
 * - camera, microphone, location, payment and USB stay off (nothing here uses them), and so does
 *   the browser's ad-topics API.
 */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
];

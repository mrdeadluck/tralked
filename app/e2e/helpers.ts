import { expect, type Page } from "@playwright/test";
import { SignJWT } from "jose";
import pg from "pg";
import { BASE_URL, E2E_SESSION_SECRET, e2eDatabaseUrl } from "./config";

export { ROUTES, type E2ERoute } from "./routes";

/** Demo login only exists outside production, so logged-in flows need the dev-mode server. */
export const CAN_LOGIN = process.env.E2E_MODE === "dev";

export const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

/** Logs in as the seeded `lucas` user through `/api/auth/demo` (dev server only). */
export async function loginAsDemo(page: Page) {
  if (!CAN_LOGIN) {
    throw new Error("Demo login is disabled in production; run the dev config (`pnpm e2e:dev`).");
  }
  await page.goto("/api/auth/demo");
  await expect(page).toHaveURL(/\/jogador\/lucas$/);
}

/** One query against the e2e server's own database (never a development database). */
export async function sql<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

export async function userId(handle: string): Promise<string> {
  const [row] = await sql<{ id: string }>(`select id from "User" where handle = $1`, [handle]);
  if (!row) throw new Error(`Seeded user ${handle} not found: reseed the e2e database.`);
  return row.id;
}

/** A session cookie for `handle`, signed like the server's (works in dev and prod mode). */
export async function sessionCookie(handle: string) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(await userId(handle))
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(E2E_SESSION_SECRET));
  return { name: "gl_session", value: token, url: BASE_URL };
}

/** Acts as any seeded user (not only the admin demo user): sets their session cookie. */
export async function loginAs(page: Page, handle: string) {
  await page.context().clearCookies({ name: "gl_session" });
  await page.context().addCookies([await sessionCookie(handle)]);
}

import { expect, type Page } from "@playwright/test";

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

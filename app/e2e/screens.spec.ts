import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "@playwright/test";
import { CAN_LOGIN, loginAsDemo, ROUTES, VIEWPORTS } from "./helpers";

const OUT_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "__screens__");

// Full-page screenshots of every route, for visual review. Not assertions.
for (const viewport of VIEWPORTS) {
  test.describe(`screens ${viewport.name} ${viewport.width}x${viewport.height}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      // Stable captures: no entry animations mid-frame.
      reducedMotion: "reduce",
    });

    test.beforeAll(() => {
      mkdirSync(OUT_DIR, { recursive: true });
    });

    for (const route of ROUTES) {
      test(`${route.name}`, async ({ page }) => {
        test.skip(Boolean(route.auth) && !CAN_LOGIN, "needs demo login (dev server)");
        if (route.auth) await loginAsDemo(page);

        await page.goto(route.path);
        await page.waitForLoadState("networkidle");
        await page.screenshot({
          path: join(OUT_DIR, `${route.name}-${viewport.width}x${viewport.height}.png`),
          fullPage: true,
        });
      });
    }
  });
}

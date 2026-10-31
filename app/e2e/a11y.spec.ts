import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { CAN_LOGIN, loginAsDemo, ROUTES, VIEWPORTS } from "./helpers";

const BLOCKING_IMPACTS = ["serious", "critical"];

for (const viewport of VIEWPORTS) {
  test.describe(`axe ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const route of ROUTES) {
      test(`${route.name}: no serious or critical violations`, async ({ page }) => {
        test.skip(Boolean(route.auth) && !CAN_LOGIN, "needs demo login (dev server)");
        if (route.auth) await loginAsDemo(page);

        await page.goto(route.path);
        await page.waitForLoadState("networkidle");

        const { violations } = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();

        const blocking = violations
          .filter((violation) => BLOCKING_IMPACTS.includes(violation.impact ?? ""))
          .map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            help: violation.help,
            targets: violation.nodes.map((node) => node.target.join(" ")).slice(0, 5),
          }));

        expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
      });
    }
  });
}

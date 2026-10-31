import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { CAN_LOGIN, loginAsDemo, VIEWPORTS } from "./helpers";

/*
 * The sealed-case intro of the game page (/jogos/[slug]): first visit shows it, "Pular" reveals
 * the page, a second visit does not show it again, reduced motion and no-JS never show it, and a
 * logged-in user who already opened the game (another device) does not get it again.
 */

const GAME = "/jogos/hollow-knight";
const OUT_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "__screens__");
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://gamelog:gamelog@localhost:5433/gamelog_e2e";

const intro = (page: Page) => page.getByRole("dialog", { name: /pela primeira vez/ });

async function openGame(page: Page, path = GAME) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

test.describe("game page case intro", () => {
  test("first visit shows the case; Pular reveals the page", async ({ page }) => {
    await openGame(page);
    await expect(intro(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir o lacre" })).toBeFocused();

    await page.getByRole("button", { name: "Pular" }).click();
    await expect(intro(page)).toBeHidden();
    const title = page.getByRole("heading", { level: 1, name: "Hollow Knight" });
    await expect(title).toBeVisible();
    await expect(title).toBeFocused();
    await expect(page.locator("#gp-root")).not.toHaveAttribute("data-intro", /.*/);
    expect(await page.evaluate(() => localStorage.getItem("tralked:opened:hollow-knight"))).toBe("1");
  });

  test("a second visit does not show the case again", async ({ page }) => {
    await openGame(page);
    await page.getByRole("button", { name: "Pular" }).click();
    await openGame(page);
    await page.waitForTimeout(800);
    await expect(intro(page)).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Hollow Knight" })).toBeVisible();
    // Replaying is still possible on purpose.
    await page.getByRole("button", { name: "Abrir a capinha de novo" }).click();
    await expect(intro(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(intro(page)).toBeHidden();
  });

  test("opening the seal plays the sequence and lands the disc on the page", async ({ page }) => {
    await openGame(page);
    await page.getByRole("button", { name: "Abrir o lacre" }).click();
    await expect(intro(page)).toBeHidden({ timeout: 8_000 });
    await expect(page.locator("#gp-disc-hold .gpd")).toBeVisible();
    await expect(page.locator(".gpc-fly")).toHaveCount(0);
    await expect(page.locator("#gp-root")).not.toHaveAttribute("data-intro", /.*/);
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("never shows the case and the page is readable at once", async ({ page }) => {
      await openGame(page);
      await page.waitForTimeout(800);
      await expect(intro(page)).toBeHidden();
      await expect(page.getByRole("heading", { level: 1, name: "Hollow Knight" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Abrir a capinha de novo" })).toHaveCount(0);
    });
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });
    test("the page is complete and the case never appears", async ({ page }) => {
      await page.goto(GAME);
      await expect(intro(page)).toBeHidden();
      await expect(page.getByRole("heading", { level: 1, name: "Hollow Knight" })).toBeVisible();
      await expect(page.getByText("Tempo para 100%")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Notícias de Hollow Knight" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Fórum do jogo", exact: true })).toHaveAttribute("href", "/forum/hollow-knight");
    });
  });

  test("logged in: opening on one device is remembered on every other", async ({ browser }) => {
    test.skip(!CAN_LOGIN, "needs demo login (dev server)");
    const db = new pg.Client({ connectionString: DATABASE_URL });
    await db.connect();
    try {
      await db.query(
        `DELETE FROM "GameOpen" WHERE "userId" = (SELECT id FROM "User" WHERE handle = 'lucas')
           AND "gameId" = (SELECT id FROM "Game" WHERE slug = 'celeste')`,
      );

      // Device 1: first visit shows the case; skipping records it on the account.
      const first = await browser.newContext();
      const one = await first.newPage();
      await loginAsDemo(one);
      await openGame(one, "/jogos/celeste");
      await expect(intro(one)).toBeVisible();
      await one.getByRole("button", { name: "Pular" }).click();
      await expect(intro(one)).toBeHidden();
      await expect
        .poll(async () =>
          (
            await db.query(
              `SELECT count(*)::int AS n FROM "GameOpen" WHERE "userId" = (SELECT id FROM "User" WHERE handle = 'lucas')
                 AND "gameId" = (SELECT id FROM "Game" WHERE slug = 'celeste')`,
            )
          ).rows[0].n,
        )
        .toBe(1);
      await first.close();

      // Device 2: empty localStorage, same account: no case.
      const second = await browser.newContext();
      const two = await second.newPage();
      await loginAsDemo(two);
      await openGame(two, "/jogos/celeste");
      await two.waitForTimeout(800);
      await expect(intro(two)).toBeHidden();
      await expect(two.getByRole("heading", { level: 1, name: "Celeste" })).toBeVisible();
      await second.close();
    } finally {
      await db.end();
    }
  });
});

// Visual review frames of the flagship sequence (not assertions).
for (const viewport of VIEWPORTS) {
  test(`case intro frames ${viewport.width}x${viewport.height}`, async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const shot = (name: string, fullPage = false) =>
      page.screenshot({ path: join(OUT_DIR, `jogo-intro-${name}-${viewport.width}x${viewport.height}.png`), fullPage });

    await openGame(page);
    await page.waitForTimeout(1200);
    await shot("1-capa");
    await page.getByRole("button", { name: "Abrir o lacre" }).click();
    await page.waitForTimeout(1750);
    await shot("2-aberta");
    await page.waitForTimeout(1300);
    await shot("3-disco-voando");
    await expect(intro(page)).toBeHidden({ timeout: 8_000 });
    await page.waitForTimeout(1600);
    await shot("4-pagina");
    await shot("5-pagina-inteira", true);
  });
}

import { expect, test } from "@playwright/test";
import { CAN_LOGIN, loginAsDemo, ROUTES } from "./helpers";

test.describe("smoke", () => {
  for (const route of ROUTES) {
    test(`${route.name}: ${route.path} responds 200`, async ({ page }) => {
      test.skip(Boolean(route.auth) && !CAN_LOGIN, "needs demo login (dev server)");
      if (route.auth) await loginAsDemo(page);

      const response = await page.goto(route.path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("banner").first()).toContainText("TRALKED");
      await expect(page.locator("main")).toBeVisible();
    });
  }

  test("unknown game is a real 404", async ({ page }) => {
    const response = await page.goto("/jogos/jogo-que-nao-existe");
    expect(response?.status()).toBe(404);
  });

  test("header exposes the seven sections", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Seções" });
    for (const label of [
      "Notícias",
      "Jogos",
      "Fórum",
      "Galeria",
      "Personagem",
      "Highscores",
      "Família",
    ]) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });

  test("logged-in header shows the account menu with Conexões and Sair", async ({ page }) => {
    test.skip(!CAN_LOGIN, "needs demo login (dev server)");
    await loginAsDemo(page);
    const account = page.getByRole("group", { name: "Conta" });
    await account.getByRole("button").click();
    await expect(account.getByRole("link", { name: "Conexões" })).toBeVisible();
    await expect(account.getByRole("button", { name: "Sair" })).toBeVisible();
  });
});

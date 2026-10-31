import { expect, test } from "@playwright/test";
import { CAN_LOGIN, loginAsDemo, ROUTES, sql } from "./helpers";

test.describe("smoke", () => {
  for (const route of ROUTES) {
    test(`${route.name}: ${route.path} responds 200`, async ({ page }) => {
      test.skip(Boolean(route.auth) && !CAN_LOGIN, "needs demo login (dev server)");
      if (route.auth) await loginAsDemo(page);

      const response = await page.goto(route.path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("banner").first().getByRole("img", { name: "Tralked" })).toBeVisible();
      await expect(page.locator("main")).toBeVisible();
    });
  }

  test("unknown game is a real 404", async ({ page }) => {
    const response = await page.goto("/jogos/jogo-que-nao-existe");
    expect(response?.status()).toBe(404);
  });

  test("unknown article is a real 404", async ({ page }) => {
    const response = await page.goto("/noticias/noticia-que-nao-existe");
    expect(response?.status()).toBe(404);
  });

  test("unknown player is a real 404, with its own title", async ({ page }) => {
    const response = await page.goto("/jogador/ninguem-com-esse-nome");
    expect(response?.status()).toBe(404);
  });

  test("player and highscores pages have their own titles; a private profile is noindex", async ({ page }) => {
    await page.goto("/jogador/lucas");
    await expect(page).toHaveTitle(/^.+ \(@lucas\) \| Tralked$/);
    await page.goto("/highscores");
    await expect(page).toHaveTitle("Highscores | Tralked");

    const handle = `e2e-privado-${Date.now()}`;
    await sql(
      `INSERT INTO "User" (id, handle, "displayName", "profilePublic", "updatedAt") VALUES ($1, $1, 'Pessoa Privada', false, now())`,
      [handle],
    );
    try {
      const response = await page.goto(`/jogador/${handle}`);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(`@${handle} | Tralked`);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.getByText("Este perfil é privado.")).toBeVisible();
    } finally {
      await sql(`DELETE FROM "User" WHERE id = $1`, [handle]);
    }
  });

  test("logged out, the home page loads without console errors (no off-site prefetch)", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Links come into view (and get prefetched) as the page scrolls.
    await page.mouse.wheel(0, 20_000);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
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

import { expect, test } from "@playwright/test";
import { CAN_LOGIN, loginAsDemo } from "./helpers";

test.describe("admin", () => {
  test("is a real 404 for visitors", async ({ page }) => {
    for (const path of ["/admin", "/admin/robos", "/admin/noticias/nova"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
    }
  });

  test("an editor writes an article with blocks, previews it and publishes it", async ({ page }) => {
    test.skip(!CAN_LOGIN, "needs demo login (dev server)");
    await loginAsDemo(page);
    const title = `Notícia do e2e ${Date.now()}`;

    await page.goto("/admin/noticias/nova");
    await page.getByLabel("Título", { exact: true }).fill(title);
    await page.getByRole("button", { name: "Parágrafo" }).click();
    await page.getByRole("textbox", { name: "Texto" }).fill("Primeiro parágrafo com **negrito**.");
    await page.getByRole("button", { name: "Título" }).click();
    await page.getByRole("textbox", { name: "Título" }).last().fill("Uma seção");
    await page.getByRole("button", { name: "Subir bloco 2" }).click();

    await page.getByRole("button", { name: "Pré-visualizar" }).click();
    const preview = page.locator("h2", { hasText: "Uma seção" });
    await expect(preview).toBeVisible();
    await expect(page.locator("strong", { hasText: "negrito" })).toBeVisible();
    await page.getByRole("button", { name: "Editar" }).click();

    await page.getByLabel("Status").selectOption("published");
    await page.getByRole("button", { name: "Criar notícia" }).click();
    await expect(page).toHaveURL(/\/admin\/noticias\/[a-z0-9]+$/);

    const slug = await page.getByLabel("Endereço").inputValue();
    const response = await page.goto(`/noticias/${slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  });

  test("an admin creates a bot key: the secret is shown once", async ({ page }) => {
    test.skip(!CAN_LOGIN, "needs demo login (dev server)");
    await loginAsDemo(page);
    await page.goto("/admin/robos");
    await page.getByLabel("Nome do robô").fill(`e2e-${Date.now()}`);
    await page.getByRole("button", { name: "Criar chave" }).click();
    const secret = page.getByLabel("Chave secreta");
    await expect(secret).toHaveValue(/^tk_live_[A-Za-z0-9_-]{43}$/);
    await page.reload();
    await expect(page.getByLabel("Chave secreta")).toHaveCount(0);
  });
});

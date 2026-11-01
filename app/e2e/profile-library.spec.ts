import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { CAN_LOGIN, loginAs, sql } from "./helpers";

/*
 * Plano 4, F3 + F11: the full profile (games, achievements, statistics, wishlist; hours in the
 * header) and the paginated, searchable /jogos and /familia. Pagination and search must work
 * without JavaScript; with JavaScript the search runs while typing.
 */

async function noBlockingViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

const tiles = (page: Page) => page.locator("main").getByRole("heading", { level: 3 });

/*
 * "Works without JavaScript": every control is a plain link or a GET form and the server renders
 * each page from the URL alone (no client state). These tests check exactly that. (With JavaScript
 * fully disabled, Cache Components' streamed sections, the site header included, are revealed by
 * React's inline script, so a browser with JS off sees an empty body on every dynamic page of the
 * site; that is outside these pages.)
 */
test.describe("URL state: plain links and GET forms", () => {
  test("/jogos pages with numbered links and the page size choice", async ({ page }) => {
    await page.goto("/jogos?por=10&ordem=nome");
    await expect(tiles(page)).toHaveCount(10);
    const nav = page.getByRole("navigation", { name: "Páginas do catálogo" });
    await expect(nav.getByText("1–10 de 14 jogos")).toBeVisible();
    await nav.getByRole("link", { name: "Próxima página" }).click();
    await expect(page).toHaveURL(/pagina=2/);
    await expect(page).toHaveURL(/ordem=nome/);
    await expect(tiles(page)).toHaveCount(4);
    await expect(nav.locator('[aria-current="page"]')).toHaveText(/2/);
    await nav.getByRole("link", { name: "40 por página" }).click();
    await expect(tiles(page)).toHaveCount(14);
    await expect(page).not.toHaveURL(/pagina=/);
  });

  test("/jogos name search is a GET form keeping the filters; the query ignores accents and finds catalog stubs", async ({ page }) => {
    await page.goto("/jogos?plataforma=PC&pagina=2");
    const form = page.locator("main form[role=search]");
    await expect(form).toHaveAttribute("action", "/jogos");
    await expect(form).toHaveAttribute("method", "get");
    await expect(form.locator('input[type=hidden][name="plataforma"]')).toHaveValue("PC");
    await expect(form.locator('input[type=hidden][name="pagina"]')).toHaveCount(0);
    await expect(form.getByRole("searchbox", { name: "Buscar jogo pelo nome" })).toHaveAttribute("name", "q");

    // What the browser submits for "LANTÉRNA" + Enter.
    await page.goto("/jogos?plataforma=PC&q=LANT%C3%89RNA");
    await expect(page.getByRole("heading", { name: "Lanterna do Farol" })).toBeVisible();
    await expect(page.getByText("Detalhes em breve", { exact: true })).toBeVisible();
    await expect(page.getByText(/DO CATÁLOGO COMPLETO, COM DETALHES EM BREVE/)).toBeVisible();
  });

  test("profile games: sections, platform filter and pages", async ({ page }) => {
    await page.goto("/jogador/lucas/jogos?por=10");
    await expect(page.getByRole("navigation", { name: "Seções do perfil" }).getByRole("link", { name: "Jogos" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText("Horas jogadas", { exact: true })).toBeVisible();
    const rows = page.locator("main ul li h3");
    await expect(rows).toHaveCount(10);
    await page.getByRole("link", { name: /Nunca jogados/ }).click();
    await expect(page).toHaveURL(/secao=nunca/);
    await expect(page.getByRole("heading", { name: /Nunca jogados:/ })).toBeVisible();
    await expect(page.getByText("Nunca jogado").first()).toBeVisible();
  });
});

test.describe("profile sections", () => {
  test("games, achievements, statistics and wishlist render with no serious axe violations", async ({ page }) => {
    await page.goto("/jogador/lucas");
    await expect(page.getByText("Horas jogadas", { exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "Seções do perfil" }).getByRole("link", { name: "Jogos" }).click();
    await expect(page).toHaveURL(/\/jogador\/lucas\/jogos$/);
    await expect(page.getByRole("heading", { name: /^Jogados:/ })).toBeVisible();
    await noBlockingViolations(page);

    await page.goto("/jogador/lucas/conquistas?raridade=lendaria&ordem=raras");
    await expect(page.getByRole("heading", { name: "Mais raras" })).toBeVisible();
    await expect(page.locator("main").getByText("Lendária ·").first()).toBeVisible();
    await expect(page.locator("main").getByText(/^(Épica|Rara|Comum|Incomum) ·/)).toHaveCount(0);
    await noBlockingViolations(page);

    await page.goto("/jogador/lucas/estatisticas");
    await expect(page.getByRole("heading", { name: "Horas por plataforma" })).toBeVisible();
    await expect(page.getByText("Jogo mais jogado:")).toBeVisible();
    await noBlockingViolations(page);

    await page.goto("/jogador/lucas/desejos");
    await expect(page.locator("main ol > li")).toHaveCount(3);
    await noBlockingViolations(page);
  });

  test("a private profile shows visitors only its name on every section", async ({ page }) => {
    const [user] = await sql<{ id: string; handle: string }>(
      `select id, handle from "User" where "profilePublic" and handle <> 'lucas' order by handle desc limit 1`,
    );
    await sql(`update "User" set "profilePublic" = false where id = $1`, [user.id]);
    try {
      for (const section of ["jogos", "conquistas", "estatisticas", "desejos"]) {
        const res = await page.goto(`/jogador/${user.handle}/${section}`);
        expect(res?.status()).toBe(200);
        await expect(page.getByText("Este perfil é privado.")).toBeVisible();
        await expect(page.getByText("Horas jogadas")).toHaveCount(0);
      }
      expect((await page.goto("/jogador/ninguem-tem-esse-nome/jogos"))?.status()).toBe(404);
    } finally {
      await sql(`update "User" set "profilePublic" = true where id = $1`, [user.id]);
    }
  });
});

test("/jogos searches while typing, keeping the filters", async ({ page }) => {
  await page.goto("/jogos?plataforma=PC");
  await page.getByRole("searchbox", { name: "Buscar jogo pelo nome" }).pressSequentially("baldurs", { delay: 30 });
  await expect(page).toHaveURL(/q=baldurs/);
  await expect(page).toHaveURL(/plataforma=PC/);
  await expect(page.getByRole("heading", { name: "Baldur's Gate 3" })).toBeVisible();
  await expect(tiles(page)).toHaveCount(1);
  await noBlockingViolations(page);
});

test.describe("family library", () => {
  test.skip(!CAN_LOGIN, "needs a session (dev server)");

  test("paginates, filters by owner and searches inside the family library", async ({ page }) => {
    await loginAs(page, "lucas");
    await page.goto("/familia?por=10");
    await expect(page.getByRole("heading", { name: "Biblioteca da família" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Integrantes" })).toBeVisible();
    const library = page.locator("#biblioteca");
    const nav = page.getByRole("navigation", { name: "Páginas da biblioteca da família" });
    await expect(library.locator("article")).toHaveCount(10);
    await nav.getByRole("link", { name: "Página 2" }).click();
    await expect(page).toHaveURL(/pagina=2/);

    await library.getByRole("link", { name: "Todos têm" }).click();
    await expect(page).not.toHaveURL(/pagina=/);
    const owners = await library.locator("article").first().getByRole("list", { name: "Quem tem este jogo" }).getByRole("listitem").count();
    expect(owners).toBeGreaterThan(1);

    await page.goto("/familia");
    const box = page.getByRole("searchbox", { name: "Buscar na biblioteca da família" });
    await box.pressSequentially("HOLLOW", { delay: 30 });
    await expect(page).toHaveURL(/q=HOLLOW/);
    await expect(library.locator("article")).toHaveCount(1);
    await expect(library.getByRole("heading", { name: "Hollow Knight" })).toBeVisible();
    await noBlockingViolations(page);
  });
});

import { expect, test, type Page } from "@playwright/test";
import { CAN_LOGIN, loginAsDemo } from "./helpers";

/** Computed opacity of an element (Playwright counts opacity: 0 as "visible"). */
const opacity = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => Number(getComputedStyle(el).opacity));

test.describe("home without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the news sections are server-rendered and readable", async ({ page }) => {
    await page.goto("/");
    const highlights = page.getByRole("region", { name: "Destaques" });
    await expect(highlights).toBeVisible();
    await expect(highlights.getByRole("link").first()).toBeVisible();
    const latest = page.getByRole("region", { name: "Últimas notícias" });
    await expect(latest).toBeVisible();
    await expect(latest.getByRole("link").first()).toBeVisible();
    // The tab panel cards and the wire are not hidden waiting for a script.
    expect(await opacity(page, ".tkt-panel > *")).toBe(1);
    await expect(page.getByRole("region", { name: "Notícias em movimento" })).toBeVisible();
  });

  test("an article is readable with its JSON-LD", async ({ page }) => {
    await page.goto("/noticias/25-conquistas-mais-raras-da-steam-em-2026");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}");
    expect(ld).toMatchObject({ "@type": "NewsArticle", headline: expect.any(String), datePublished: expect.any(String) });
  });
});

test.describe("SEO files", () => {
  test("sitemap lists games, guides, articles, threads and static pages", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    const xml = await response.text();
    for (const path of ["/jogos/hollow-knight<", "/jogos/hollow-knight/guia<", "/noticias/25-conquistas-mais-raras-da-steam-em-2026<", "/forum/t/seed-thread-1<", "/privacidade<"]) {
      expect(xml).toContain(path);
    }
    expect(xml).not.toContain("/admin");
  });

  test("robots.txt keeps private areas out", async ({ request }) => {
    const text = await (await request.get("/robots.txt")).text();
    for (const path of ["/admin", "/conta", "/api"]) expect(text).toContain(`Disallow: ${path}`);
    expect(text).toMatch(/Sitemap: .*\/sitemap\.xml/);
  });

  test("default social image is a branded PNG", async ({ request, page }) => {
    const response = await request.get("/opengraph-image");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
    await page.goto("/");
    await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute("content", /opengraph-image/);
  });

  test("game page carries VideoGame structured data", async ({ page }) => {
    await page.goto("/jogos/hollow-knight");
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks.map((b) => JSON.parse(b))).toContainEqual(
      expect.objectContaining({ "@type": "VideoGame", name: "Hollow Knight" }),
    );
  });

  test("guide page carries HowTo structured data", async ({ page }) => {
    await page.goto("/jogos/hollow-knight/guia");
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const types = blocks.map((b) => JSON.parse(b)["@type"]);
    expect(types).toContain("HowTo");
  });
});

test.describe("system pages", () => {
  test("unknown URL: branded 404", async ({ page }) => {
    const response = await page.goto("/rota-que-nao-existe");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Essa página não existe" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ir para as notícias" })).toHaveAttribute("href", "/");
  });

  test("the first Tab offers a skip link that jumps past the header", async ({ page }) => {
    await page.goto("/noticias");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Pular para o conteúdo" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#principal")).toBeFocused();
  });

  test("footer links to the legal and community pages", async ({ page }) => {
    await page.goto("/");
    const footer = page.getByRole("contentinfo");
    for (const [name, href] of [
      ["Desenvolvedores", "/desenvolvedores"],
      ["Fórum", "/forum"],
      ["Galeria", "/galeria"],
      ["Privacidade", "/privacidade"],
      ["Termos", "/termos"],
      ["Licenças", "/licencas"],
    ]) {
      await expect(footer.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
    }
  });

  test("article page reserves a labelled ad slot and mounts the comments", async ({ page }) => {
    await page.goto("/noticias/25-conquistas-mais-raras-da-steam-em-2026");
    await expect(page.getByRole("complementary", { name: "Publicidade" })).toBeVisible();
    await expect(page.locator("#comentarios")).toHaveCount(1);
    await expect(page.locator("#comentarios").getByRole("heading", { name: "Comentários" })).toBeVisible();
  });
});

test.describe("cookie consent (fresh visitor)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("asks once, keeps only necessary cookies, remembers the choice", async ({ page, context }) => {
    await page.goto("/");
    const banner = page.getByRole("region", { name: "Aviso de cookies" });
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Só os necessários" }).click();
    await expect(banner).toBeHidden();
    const consent = (await context.cookies()).find((c) => c.name === "tk_consent");
    expect(consent?.value).toBe("necessary");
    await page.goto("/jogos");
    await expect(page.getByRole("region", { name: "Aviso de cookies" })).toBeHidden();
  });
});

test.describe("notifications", () => {
  test("logged-in bell shows unread notifications and opens /notificacoes", async ({ page }) => {
    test.skip(!CAN_LOGIN, "needs demo login (dev server)");
    await loginAsDemo(page);
    const bell = page.getByRole("button", { name: /^Notificações/ });
    await bell.click();
    const panel = page.getByRole("region", { name: "Notificações" });
    await expect(panel).toBeVisible();
    await panel.getByRole("link", { name: "Ver todas" }).click();
    await expect(page).toHaveURL(/\/notificacoes$/);
    await expect(page.getByRole("heading", { level: 1, name: "Notificações" })).toBeVisible();
  });

  test("account menu has Conta", async ({ page }) => {
    test.skip(!CAN_LOGIN, "needs demo login (dev server)");
    await loginAsDemo(page);
    const account = page.getByRole("group", { name: "Conta" });
    await account.getByRole("button").click();
    await expect(account.getByRole("link", { name: "Conta", exact: true })).toHaveAttribute("href", "/conta");
  });
});

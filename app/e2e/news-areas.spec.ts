import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { CAN_LOGIN, loginAsDemo, sql } from "./helpers";

/*
 * Plan 4 F7 (Entretenimento / Tecnologia press headlines in the tabs and the archive filter,
 * feeds per area in the admin) and F12 (article and guide lead to the game page).
 * Uses the seeded example headlines (example.com links) and the Hollow Knight guide article.
 */

const BLOCKING = ["serious", "critical"];

async function expectNoBlockingViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = violations
    .filter((v) => BLOCKING.includes(v.impact ?? ""))
    .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

test("home: the Tecnologia tab lists press headlines marked as external", async ({ page }) => {
  await page.goto("/");
  const tabs = page.getByRole("tablist", { name: "Categorias de notícias" });
  await tabs.getByRole("tab", { name: /^Tecnologia/ }).click();
  const panel = page.getByRole("tabpanel");
  const press = panel.getByRole("link", { name: /Nova geração de placas de vídeo/ }).first();
  await expect(press).toBeVisible();
  await expect(press).toHaveAttribute("href", "https://example.com/bit/placas-de-video-nova-geracao");
  await expect(press).toHaveAttribute("target", "_blank");
  await expect(press).toHaveAttribute("rel", "noopener noreferrer");
  await expect(press).toContainText("Fonte externa: Bit Exemplo");
  await expect(press).toContainText("abre em nova aba");

  await tabs.getByRole("tab", { name: /^Entretenimento/ }).click();
  await expect(panel.getByRole("link", { name: /Série animada do jogo Hades/ }).first()).toContainText("Fonte externa: Tela Fictícia");
});

test("/noticias?categoria=entretenimento: the filter shows the area's press headlines", async ({ page }) => {
  await page.goto("/noticias?categoria=entretenimento#todas");
  await expect(page.getByRole("link", { name: "Entretenimento", exact: true })).toHaveAttribute("aria-current", "page");
  const press = page.getByRole("region", { name: "Na imprensa: Entretenimento" });
  await expect(press.getByRole("listitem")).toHaveCount(3);
  const first = press.getByRole("link").first();
  await expect(first).toContainText("Série animada do jogo Hades ganha primeiro teaser (exemplo)");
  await expect(first).toContainText("Fonte externa: Tela Fictícia");
  await expect(first).toHaveAttribute("target", "_blank");
  // No technology headline in the entertainment filter.
  await expect(press).not.toContainText("placas de vídeo");
  await expectNoBlockingViolations(page);
});

test("/noticias?categoria=games has no press block (Games headlines stay on the wire and game pages)", async ({ page }) => {
  await page.goto("/noticias?categoria=games#todas");
  await expect(page.getByRole("region", { name: /Na imprensa/ })).toHaveCount(0);
});

test("article: chips under the title and the closing block lead to the game page and the guide", async ({ page }) => {
  await page.goto("/noticias/hollow-knight-guia-100-por-cento-em-7-etapas");
  const chips = page.getByRole("list", { name: "Jogo desta notícia" });
  await expect(chips).toContainText("Hollow Knight");
  // The seed has no catalog cover: the chip shows the name, never a broken image.
  await expect(chips.locator("img")).toHaveCount(0);
  await expect(chips.getByRole("link", { name: "Ver jogo: Hollow Knight" })).toHaveAttribute("href", "/jogos/hollow-knight");
  await expect(chips.getByRole("link", { name: "Guia 100% de Hollow Knight" })).toHaveAttribute("href", "/jogos/hollow-knight/guia");

  const block = page.getByRole("region", { name: "Jogo desta notícia" });
  await expect(block.getByRole("link", { name: /Ver jogo: Hollow Knight/ })).toHaveAttribute("href", "/jogos/hollow-knight");
  await expect(block.getByRole("link", { name: /Abrir guia 100% de Hollow Knight/ })).toHaveAttribute("href", "/jogos/hollow-knight/guia");

  await chips.getByRole("link", { name: "Ver jogo: Hollow Knight" }).click();
  await expect(page).toHaveURL(/\/jogos\/hollow-knight$/);
});

test("article about a game without a guide: only 'Ver jogo'", async ({ page }) => {
  await page.goto("/noticias/hades-os-3-desafios-que-mais-travam-o-100-por-cento");
  const chips = page.getByRole("list", { name: "Jogo desta notícia" });
  await expect(chips.getByRole("link", { name: "Ver jogo: Hades" })).toHaveAttribute("href", "/jogos/hades");
  await expect(chips.getByRole("link", { name: /Guia 100%/ })).toHaveCount(0);
});

test("guide: breadcrumb Jogos › Jogo › Guia and a link to the game page", async ({ page }) => {
  await page.goto("/jogos/hollow-knight/guia");
  const trail = page.getByRole("navigation", { name: "Você está em" });
  await expect(trail).toHaveText(/Jogos\s*›\s*Hollow Knight\s*›\s*Guia/);
  await expect(trail.getByRole("link", { name: "Jogos" })).toHaveAttribute("href", "/jogos");
  await expect(trail.getByRole("link", { name: "Hollow Knight" })).toHaveAttribute("href", "/jogos/hollow-knight");
  await expect(trail.getByText("Guia", { exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1, name: "Hollow Knight" })).toBeVisible();
  const gamePage = page.getByRole("link", { name: "Página do jogo: Hollow Knight" });
  await expect(gamePage).toHaveAttribute("href", "/jogos/hollow-knight");
  await gamePage.click();
  await expect(page).toHaveURL(/\/jogos\/hollow-knight$/);
});

test.describe("admin feeds per area", () => {
  const URL = "https://feeds.e2e-area.example/rss";
  test.beforeEach(async () => {
    await sql(`delete from "NewsFeed" where url = $1`, [URL]);
  });
  test.afterAll(async () => {
    await sql(`delete from "NewsFeed" where url = $1`, [URL]);
  });

  test("lists feeds by area and adds a Tecnologia feed", async ({ page }) => {
    test.skip(!CAN_LOGIN, "needs demo login (dev server)");
    await loginAsDemo(page);
    await page.goto("/admin/feeds");
    for (const area of ["Games", "Entretenimento", "Tecnologia"]) {
      await expect(page.getByRole("heading", { level: 2, name: `Feeds: ${area}` })).toBeVisible();
    }
    // The curated feeds come paused from the seed.
    const tec = page.locator("section", { has: page.getByRole("heading", { name: "Feeds: Tecnologia" }) });
    await expect(tec).toContainText("Tecnoblog");

    const form = page.locator("section", { has: page.getByRole("heading", { name: "Novo feed" }) });
    await form.getByLabel("Nome da publicação").fill("Feed E2E Área");
    await form.getByLabel("Área").selectOption("TECNOLOGIA");
    await expect(form).toContainText("Hardware, PC, consoles e IA");
    await form.getByLabel("Endereço do feed RSS").fill(URL);
    await form.getByRole("button", { name: "Adicionar feed" }).click();
    // The example host does not resolve: the SSRF guard refuses it, nothing is saved.
    await expect(form.getByRole("alert")).toContainText("não leva a um site público");
    expect(await sql(`select 1 from "NewsFeed" where url = $1`, [URL])).toHaveLength(0);
    // The pointer is still on the primary button: axe checks its hovered colors.
    await expectNoBlockingViolations(page);
    expect(await hoverContrast(form.getByRole("button", { name: "Adicionar feed" }))).toBeGreaterThanOrEqual(4.5);
    // Danger tone (Excluir) keeps readable text on hover too.
    expect(await hoverContrast(tec.getByRole("button", { name: /^Excluir o feed / }).first())).toBeGreaterThanOrEqual(4.5);
  });
});

/** Contrast ratio of a button's text against its own (or the page's) background while hovered. */
async function hoverContrast(button: Locator): Promise<number> {
  await button.hover();
  return button.evaluate((el) => {
    // Any CSS color (rgb, oklch...) to [r, g, b, alpha 0-255], through a 1px canvas.
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const rgb = (c: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    let bgEl: Element | null = el;
    let bg = getComputedStyle(el).backgroundColor;
    // Transparent: the first ancestor with a background.
    while (bgEl && (rgb(bg)[3] === 0 || bg === "transparent")) {
      bgEl = bgEl.parentElement;
      bg = bgEl ? getComputedStyle(bgEl).backgroundColor : "rgb(11, 12, 15)";
    }
    const a = lum(rgb(getComputedStyle(el).color));
    const b = lum(rgb(bg));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

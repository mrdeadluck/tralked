import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { CAN_LOGIN, loginAsDemo, sql } from "./helpers";

/*
 * Plano 4: the home "Lançamentos" card and /lancamentos (F10), and the calendar (F8). The seed
 * writes releases through the real job on the offline lists, dated around today.
 */

const PRIVATE = "cal_e2e_privado";

async function noBlockingViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")).map((v) => v.id);
  expect(blocking).toEqual([]);
}

const monthParam = (d: Date) => {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" })
    .format(d)
    .split("-");
  return `${y}-${m}`;
};

test.beforeAll(async () => {
  await sql(`DELETE FROM "User" WHERE handle = $1`, [PRIVATE]);
  await sql(
    `INSERT INTO "User" (id, handle, "displayName", "profilePublic", "updatedAt") VALUES ($1, $1, 'Privado', false, now())`,
    [PRIVATE],
  );
});
test.afterAll(async () => {
  await sql(`DELETE FROM "User" WHERE handle = $1`, [PRIVATE]);
});

test.describe("home Lançamentos card", () => {
  test("tabs and platform filter, PC first; links to the game page", async ({ page }) => {
    await page.goto("/");
    const card = page.getByRole("region", { name: "Lançamentos" });
    await expect(card.getByRole("tab", { name: /Últimos/ })).toHaveAttribute("aria-selected", "true");
    await expect(card.getByRole("button", { name: "PC" })).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByRole("link", { name: /Phantom Blade Zero/ })).toBeVisible();

    await card.getByRole("tab", { name: /Últimos/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(card.getByRole("tab", { name: /Próximos/ })).toBeFocused();
    await expect(card.getByRole("tab", { name: /Próximos/ })).toHaveAttribute("aria-selected", "true");
    await expect(card.getByRole("link", { name: /ArcheAge Chronicles/ })).toBeVisible();
    await expect(card.getByRole("link", { name: /Phantom Blade Zero/ })).toHaveCount(0);

    await card.getByRole("button", { name: "Todas" }).click();
    await expect(card.getByRole("button", { name: "Todas" })).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByRole("link", { name: "Todos os lançamentos →" })).toHaveAttribute("href", "/lancamentos/proximos/todas");

    await card.getByRole("link", { name: /ArcheAge Chronicles/ }).click();
    await expect(page).toHaveURL(/\/jogos\/archeage-chronicles$/);
  });
});

test.describe("/lancamentos", () => {
  test("lists by day with links for tabs and platforms, without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/lancamentos");
    await expect(page.getByRole("heading", { level: 1, name: "Lançamentos" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Phantom Blade Zero/ })).toBeVisible();
    await page.getByRole("navigation", { name: "Período" }).getByRole("link", { name: /Próximos/ }).click();
    await expect(page).toHaveURL(/\/lancamentos\/proximos\/pc$/);
    await expect(page.getByRole("link", { name: /DREADMOOR/ })).toBeVisible();
    await expect(page.getByText("Data a definir")).toBeVisible();
    await page.getByRole("navigation", { name: "Plataforma" }).getByRole("link", { name: "Todas" }).click();
    await expect(page).toHaveURL(/\/lancamentos\/proximos\/todas$/);
    await expect(page.getByRole("link", { name: /Crônicas da Maré Vermelha/ })).toBeVisible();
    expect((await page.request.get("/lancamentos/amanha/pc")).status()).toBe(404);
    // The default view has one canonical URL.
    await page.goto("/lancamentos/ultimos/pc");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/lancamentos$/);
    await context.close();
  });
});

test.describe("/calendario", () => {
  test("month grid and timeline without JavaScript, with month links", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/calendario");
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    await expect(page.getByRole("heading", { name: "Linha do tempo" })).toBeVisible();
    // Today's cell is marked; the timeline has the seeded releases of the month. (The streamed
    // version for this visitor is also in the HTML, hidden until a script swaps it in.)
    await expect(page.locator('a[aria-current="date"]:visible')).toHaveCount(1);
    // Both copies are in the HTML: their element ids never collide.
    const ids = await page.locator('[id^="dia-"], [id^="linha-"], [id^="cal-keys-hint"]').evaluateAll((els) => els.map((e) => e.id));
    expect(ids.length).toBeGreaterThan(2);
    expect(new Set(ids).size).toBe(ids.length);
    await expect(page.locator("main")).toContainText("Lançamento");
    await page.getByRole("navigation", { name: "Meses" }).getByRole("link", { name: /próximo mês/ }).click();
    await expect(page).toHaveURL(/\/calendario\/\d{4}-\d{2}$/);
    await expect(page.getByRole("table")).toBeVisible();
    await context.close();
  });

  test("keyboard: arrows move between days, Page Down opens the next month", async ({ page }) => {
    const month = monthParam(new Date());
    await page.goto(`/calendario/${month}`);
    const first = page.locator(`a[data-day="${month}-01"]`);
    await expect(first).toHaveAttribute("tabindex", /0|-1/);
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(`a[data-day="${month}-02"]`)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(`a[data-day="${month}-09"]`)).toBeFocused();
    // One stop in the tab order for the whole grid.
    expect(await page.locator('a[data-day][tabindex="0"]').count()).toBe(1);
    await page.keyboard.press("PageDown");
    await expect(page).not.toHaveURL(new RegExp(`/calendario/${month}$`));
    await expect(page).toHaveURL(/\/calendario\/\d{4}-\d{2}$/);
    // The focus stays on the same day of the new month.
    const next = new URL(page.url()).pathname.split("/").pop();
    await expect(page.locator(`a[data-day="${next}-09"]:visible`)).toBeFocused();
    await page.keyboard.press("PageUp");
    await expect(page).toHaveURL(new RegExp(`/calendario/${month}$`));
    await expect(page.locator(`a[data-day="${month}-09"]:visible`)).toBeFocused();
  });

  test("another player's calendar only when the profile is public", async ({ page }) => {
    await page.goto(`/calendario?jogador=${PRIVATE}`);
    await expect(page.getByText(`O perfil de @${PRIVATE} é privado`)).toBeVisible();
    await page.goto("/calendario?jogador=ninguem_existe_x");
    await expect(page.getByText("Não encontramos o jogador @ninguem_existe_x")).toBeVisible();
    await page.goto("/calendario?jogador=lucas");
    await expect(page.getByText("Conquistas, marcos de horas e missões de")).toBeVisible();
    await expect(page.getByRole("list", { name: "Legenda" })).toContainText("Conquistas");
    // Month links keep the player.
    await expect(page.getByRole("link", { name: /próximo mês/ })).toHaveAttribute("href", /\?jogador=lucas$/);
    await noBlockingViolations(page);
    // The public profile links to it; a private one shows no sheet (and so no link).
    await page.goto("/jogador/lucas");
    await expect(page.getByRole("link", { name: "Calendário de @lucas →" })).toHaveAttribute("href", "/calendario?jogador=lucas");
    await page.goto(`/jogador/${PRIVATE}`);
    await expect(page.getByRole("link", { name: /^Calendário de @/ })).toHaveCount(0);
  });

  test("logged in: the player's own achievements", async ({ page }) => {
    test.skip(!CAN_LOGIN, "needs demo login (dev server)");
    await loginAsDemo(page);
    await page.goto("/calendario");
    await expect(page.getByText("Com as suas conquistas, marcos de horas e missões.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Legenda" })).toContainText("Marco de horas");
    await page.goto("/jogador/lucas");
    await expect(page.getByRole("link", { name: "Meu calendário →" })).toHaveAttribute("href", "/calendario");
  });

  test("an invalid month is a 404", async ({ page }) => {
    expect((await page.request.get("/calendario/2026-13")).status()).toBe(404);
    expect((await page.request.get("/calendario/1900-01")).status()).toBe(404);
  });
});

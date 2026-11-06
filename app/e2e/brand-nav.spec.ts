import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loginAs, sql } from "./helpers";

/*
 * Plano 4, F5: the slogan, the "Jogos" menu (hover, keyboard, mobile drawer), the endless
 * "Em circulação" wire, "Não mostrar a abertura nos próximos jogos" and its switch in /conta.
 */

const BLOCKING = ["serious", "critical"];

async function expectNoBlockingAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => BLOCKING.includes(v.impact ?? "")).map((v) => v.id)).toEqual([]);
}

const intro = (page: Page) => page.getByRole("dialog", { name: /pela primeira vez/ });
const SKIP_LABEL = "Não mostrar a abertura nos próximos jogos";

test.describe("brand and navigation", () => {
  test("the slogan is in the header, the footer and the page title", async ({ page }) => {
    await page.goto("/");
    // The site's own banner and footer (articles on the page may have their own <header>).
    await expect(page.locator("body > header")).toContainText("Tralked — Gaming Hub");
    await expect(page.locator("body > footer")).toContainText("Tralked — Gaming Hub");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Gaming Hub/);
  });

  test("Jogos menu: opens on hover, sections then platforms, and filters the catalog", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Seções" });
    const toggle = nav.getByRole("button", { name: "Jogos", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.hover();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const options = nav.locator(`#${await toggle.getAttribute("aria-controls")} li a`);
    expect((await options.allInnerTexts()).map((t) => t.split("\n")[0])).toEqual([
      "Catálogo",
      "Lançamentos",
      "Calendário",
      "Guias 100%",
      "PC · Steam",
      "PlayStation",
      "Xbox",
      "Nintendo",
      "Retro",
    ]);
    await expectNoBlockingAxe(page);
    // Moving the pointer down into the panel keeps it open.
    await options.nth(8).hover();
    await options.nth(8).click();
    await expect(page).toHaveURL(/\/jogos\?plataforma=RETRO$/);
    await expect(
      page.getByRole("group", { name: "Filtrar por plataforma" }).getByRole("link", { name: "Retro", exact: true }),
    ).toHaveAttribute("aria-current", "true");
  });

  test("Jogos menu by keyboard: Enter opens it, Tab walks into it, Esc closes it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/forum");
    const nav = page.getByRole("navigation", { name: "Seções" });
    const toggle = nav.getByRole("button", { name: "Jogos", exact: true });
    await nav.getByRole("link", { name: "Notícias" }).focus();
    await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toContainText("Catálogo");
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("mobile drawer lists the platforms under Jogos", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "Abrir menu" }).click();
    const list = page.getByRole("navigation", { name: "Menu" }).getByRole("list", { name: "Jogos por plataforma" });
    await expect(list.getByRole("link")).toHaveText(["PC · Steam", "PlayStation", "Xbox", "Nintendo", "Retro"]);
    await expectNoBlockingAxe(page);
  });
});

test.describe("Em circulação", () => {
  test("loops endlessly: going round every story never shows the strip's end", async ({ page }) => {
    // A very wide screen and a game page (few stories): the case the old loop could not cover.
    await page.setViewportSize({ width: 2560, height: 1200 });
    await page.emulateMedia({ reducedMotion: "reduce" }); // starts paused, moves instantly
    await page.goto("/jogos/hollow-knight");
    const stage = page.getByRole("region", { name: /em movimento/ });
    await stage.scrollIntoViewIfNeeded();
    const stories = await stage.getByRole("link").count();
    expect(stories).toBeGreaterThanOrEqual(3);
    const covered = () =>
      stage.evaluate((el) => {
        const s = el.getBoundingClientRect();
        const t = el.querySelector(".tkw-track")!.getBoundingClientRect();
        return t.left <= s.left + 1 && t.right >= s.right - 1;
      });
    const focusedTitle = () => page.locator(".tkw-focus b").innerText();
    const firstTitle = await focusedTitle();
    for (let i = 0; i < stories; i++) {
      await page.getByRole("button", { name: "Próxima notícia" }).click();
      expect(await covered(), `step ${i + 1}`).toBe(true);
    }
    // After the last story comes the first again.
    expect(await focusedTitle()).toBe(firstTitle);
    // Paused (reduced motion) until the visitor resumes it.
    await expect(page.getByRole("button", { name: "Retomar notícias" })).toHaveAttribute("aria-pressed", "true");
  });

  test("keeps moving past the end of the list without stopping", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto("/jogos/hollow-knight");
    // First visit in a fresh browser: the case intro scrolls to the top while it runs; skip it first.
    await expect(intro(page)).toBeVisible();
    await intro(page).getByRole("button", { name: "Pular" }).click();
    await expect(intro(page)).toBeHidden();
    const stage = page.getByRole("region", { name: /em movimento/ });
    await stage.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0); // hovering the strip pauses it
    const x = () => stage.locator(".tkw-track").evaluate((t) => new DOMMatrix(getComputedStyle(t).transform).m41);
    const samples: number[] = [];
    for (let i = 0; i < 8; i++) {
      samples.push(await x());
      expect(await stage.evaluate((el) => {
        const s = el.getBoundingClientRect();
        const t = el.querySelector(".tkw-track")!.getBoundingClientRect();
        return t.left <= s.left + 1 && t.right >= s.right - 1;
      })).toBe(true);
      await page.waitForTimeout(250);
    }
    // It moved between every pair of samples (a wrap jumps by one copy, never stalls).
    for (let i = 1; i < samples.length; i++) expect(samples[i]).not.toBe(samples[i - 1]);
  });
});

test.describe("Não mostrar a abertura nos próximos jogos", () => {
  test("logged out: checked during the opening, the next game opens without the case", async ({ page }) => {
    await page.goto("/jogos/hades");
    await expect(intro(page)).toBeVisible();
    await intro(page).getByRole("button", { name: "Abrir", exact: true }).click();
    // Still there while the seal is being opened.
    const choice = page.getByRole("checkbox", { name: SKIP_LABEL });
    await expect(choice).toBeVisible();
    await choice.check();
    await expect(intro(page)).toBeHidden({ timeout: 8_000 });
    expect(await page.evaluate(() => localStorage.getItem("tralked:case-intro:off"))).toBe("1");

    await page.goto("/jogos/celeste");
    await page.waitForTimeout(800);
    await expect(intro(page)).toBeHidden();
    await expect(page.locator("#gp-root")).not.toHaveAttribute("data-intro", /.*/);
    await expect(page.getByRole("heading", { level: 1, name: "Celeste" })).toBeVisible();
    // The replay button still works on purpose, with the choice shown as made.
    await page.getByRole("button", { name: "Ver a abertura de novo" }).click();
    await expect(page.getByRole("checkbox", { name: SKIP_LABEL })).toBeChecked();
    await page.keyboard.press("Escape");
  });

  test("logged in: saved on the account for every device, and re-enabled in /conta", async ({ browser }) => {
    const handle = "Guardia_Selene";
    await sql(`update "User" set "caseIntroOff" = false where handle = $1`, [handle]);
    await sql(`delete from "GameOpen" where "userId" = (select id from "User" where handle = $1)`, [handle]);

    const first = await browser.newContext();
    const one = await first.newPage();
    await loginAs(one, handle);
    await one.goto("/jogos/portal-2");
    await expect(intro(one)).toBeVisible();
    await expectNoBlockingAxe(one);
    await one.getByRole("checkbox", { name: SKIP_LABEL }).check();
    await expect
      .poll(async () => (await sql<{ off: boolean }>(`select "caseIntroOff" as off from "User" where handle = $1`, [handle]))[0].off)
      .toBe(true);
    await one.getByRole("button", { name: "Pular" }).click();
    await first.close();

    // Another device (empty storage), another game: no case.
    const second = await browser.newContext();
    const two = await second.newPage();
    await loginAs(two, handle);
    await two.goto("/jogos/dead-space");
    await two.waitForTimeout(800);
    await expect(intro(two)).toBeHidden();

    // /conta turns it back on.
    await two.goto("/conta");
    const show = two.getByRole("checkbox", { name: /Mostrar a animação da capinha/ });
    await expect(show).not.toBeChecked();
    await expectNoBlockingAxe(two);
    await show.check();
    await expect(two.getByText("Animação ligada")).toBeVisible();
    expect((await sql<{ off: boolean }>(`select "caseIntroOff" as off from "User" where handle = $1`, [handle]))[0].off).toBe(false);
    await two.goto("/jogos/stardew-valley");
    await expect(intro(two)).toBeVisible();
    await second.close();
  });
});

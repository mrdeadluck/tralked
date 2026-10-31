import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { sql, VIEWPORTS } from "./helpers";

/*
 * Game titles break only between words, and are sized so their longest word fits the column:
 * no word is split across lines ("RESIDEN / T EVIL 4") and nothing overflows, at 1440 and 390.
 * Covers the booklet title (h1) and the case intro's cover and booklet titles.
 */

const OUT_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "__screens__");
const PREFIX = "e2e-titulo-";

const NAMES = [
  "Resident Evil 4",
  "Ghost of Tsushima VERSÃO DO DIRETOR",
  "Counter-Strike 2",
  "Assassin's Creed IV Black Flag",
  "Batman: Arkham Knight",
  "Supercalifragilisticexpialidocious Adventures",
];

const slugOf = (i: number) => `${PREFIX}${i}`;

test.beforeAll(async () => {
  await sql(`DELETE FROM "Game" WHERE slug LIKE $1`, [`${PREFIX}%`]);
  for (const [i, name] of NAMES.entries()) {
    await sql(
      `INSERT INTO "Game" (id, slug, name, platforms, "achievementCount", "updatedAt") VALUES ($1, $2, $3, $4, 0, now())`,
      [`${PREFIX}id-${i}`, slugOf(i), name, ["PC"]],
    );
  }
});

test.afterAll(async () => {
  await sql(`DELETE FROM "Game" WHERE slug LIKE $1`, [`${PREFIX}%`]);
});

/** Every word of the element's text sits on one line, and the element does not overflow its box. */
async function wordsUnbroken(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const text = el.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) return { ok: false, why: "no text node" };
    const value = text.textContent ?? "";
    const broken: string[] = [];
    const re = /\S+/g;
    for (let m = re.exec(value); m; m = re.exec(value)) {
      const range = document.createRange();
      range.setStart(text, m.index);
      range.setEnd(text, m.index + m[0].length);
      const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
      if (tops.size > 1) broken.push(m[0]);
    }
    const box = el.getBoundingClientRect();
    const parent = (el.parentElement as HTMLElement).getBoundingClientRect();
    const overflow = el.scrollWidth > el.clientWidth + 1 || box.right > parent.right + 1 || box.left < parent.left - 1;
    return { ok: broken.length === 0 && !overflow, broken, overflow, size: getComputedStyle(el).fontSize };
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("booklet titles never break inside a word nor overflow", async ({ page }) => {
      mkdirSync(OUT_DIR, { recursive: true });
      // Reduced motion: the page shows at once (no case intro over it).
      await page.emulateMedia({ reducedMotion: "reduce" });
      for (const [i, name] of NAMES.entries()) {
        const response = await page.goto(`/jogos/${slugOf(i)}`);
        expect(response?.status()).toBe(200);
        const title = page.getByRole("heading", { level: 1, name });
        await expect(title).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const result = await wordsUnbroken(page, "#gp-title");
        expect(result, `${name} at ${viewport.width}px`).toMatchObject({ ok: true });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: join(OUT_DIR, `titulo-${i}-${viewport.width}.png`) });
      }
    });

    test("case intro titles (cover and booklet) never break inside a word", async ({ page }) => {
      const i = NAMES.length - 1; // the 30+ character single word, no cover: the printed title shows
      await page.goto(`/jogos/${slugOf(i)}`);
      const intro = page.getByRole("dialog", { name: /pela primeira vez/ });
      await expect(intro).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await wordsUnbroken(page, ".gpc-title b")).toMatchObject({ ok: true });
      await page.waitForTimeout(1200); // the drop-in settles
      await page.screenshot({ path: join(OUT_DIR, `titulo-capa-${viewport.width}.png`) });
      await intro.getByRole("button", { name: "Pular" }).click();
      await expect(intro).toBeHidden();
    });
  });
}

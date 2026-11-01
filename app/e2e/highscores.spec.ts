import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { loginAs, sql, userId } from "./helpers";

/*
 * Plano 4, F6: the dopaminergic highscores. Every board has its own prerendered path (ranks work
 * without JS); the podium, bars and count-up are still with prefers-reduced-motion; the rank arrows
 * come from the daily snapshot (RankSnapshot), and the "Você está aqui" bar is the viewer's island.
 */

const BLOCKING = ["serious", "critical"];

async function axeBlocking(page: import("@playwright/test").Page) {
  // Contrast is measured on the settled page, not halfway through the podium's entrance.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return violations
    .filter((v) => BLOCKING.includes(v.impact ?? ""))
    .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
}

/** YYYY-MM-DD in America/Sao_Paulo, `daysBack` days ago. */
function localDay(daysBack = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    new Date(Date.now() - daysBack * 86_400_000),
  );
}

test.describe("highscores", () => {
  test("categories, platforms and genres are links with their own pages, and axe is clean", async ({ page }) => {
    await page.goto("/highscores");
    await expect(page).toHaveTitle("Highscores | Tralked");
    const podium = page.getByRole("list", { name: "Pódio" });
    await expect(podium.getByRole("listitem")).toHaveCount(3);
    const tabs = page.getByRole("navigation", { name: "Categorias do ranking" });
    await expect(tabs.getByRole("link", { name: "Nível" })).toHaveAttribute("aria-current", "page");
    expect(await axeBlocking(page)).toEqual([]);

    await tabs.getByRole("link", { name: "Horas jogadas" }).click();
    await expect(page).toHaveURL(/\/highscores\/horas$/);
    await expect(page).toHaveTitle("Highscores: Horas jogadas | Tralked");
    await expect(tabs.getByRole("link", { name: "Horas jogadas" })).toHaveAttribute("aria-current", "page");
    // The platform carries over between stat boards.
    await page.getByRole("navigation", { name: "Plataforma" }).getByRole("link", { name: "Steam" }).click();
    await expect(page).toHaveURL(/\/highscores\/horas\/steam$/);
    await tabs.getByRole("link", { name: "Acervo" }).click();
    await expect(page).toHaveURL(/\/highscores\/acervo\/steam$/);
    await expect(podium.getByRole("listitem").first()).toContainText("pontos");
    expect(await axeBlocking(page)).toEqual([]);

    await tabs.getByRole("link", { name: "Por gênero" }).click();
    await expect(page).toHaveURL(/\/highscores\/genero\/[a-z]+$/);
    await page.getByRole("navigation", { name: "Gênero" }).getByRole("link", { name: "Soulslike" }).click();
    await expect(page).toHaveURL(/\/highscores\/genero\/soulslike$/);
    expect(await axeBlocking(page)).toEqual([]);

    // Keyboard: the tabs are reachable and follow with Enter.
    await page.goto("/highscores");
    const conquistas = tabs.getByRole("link", { name: "Conquistas" });
    await conquistas.focus();
    await expect(conquistas).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/highscores\/conquistas$/);
  });

  test("unknown boards are a real 404 and old ?skill= links still land on the genre", async ({ page }) => {
    expect((await page.goto("/highscores/nope"))?.status()).toBe(404);
    expect((await page.goto("/highscores/horas/wii"))?.status()).toBe(404);
    await page.goto("/highscores?skill=rpg");
    await expect(page).toHaveURL(/\/highscores\/genero\/rpg$/);
  });

  test("ranks work without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/highscores/horas");
    const podium = page.getByRole("list", { name: "Pódio" });
    await expect(podium.getByRole("listitem")).toHaveCount(3);
    await expect(podium.getByRole("listitem").first()).toContainText(/\dh/);
    await expect(page.getByRole("list", { name: /do 4º lugar em diante/ }).getByRole("listitem").first()).toBeVisible();
    await context.close();
  });

  test("with prefers-reduced-motion nothing moves", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/highscores/horas");
    await page.waitForLoadState("networkidle");
    const animations = await page.evaluate(() =>
      [".hs-plinth", ".hs-slot-head", ".hs-fill", ".hs-delta"].map((s) => {
        const el = document.querySelector(s);
        return el ? getComputedStyle(el).animationName : "missing";
      }),
    );
    expect(animations.filter((a) => a !== "missing")).toEqual(
      animations.filter((a) => a !== "missing").map(() => "none"),
    );
    // The count-up never ran: the podium numbers are the final ones right away.
    const leader = await sql<{ playtimeMin: number }>(
      `select s."playtimeMin" from "UserRankStats" s join "User" u on u.id = s."userId"
       where s.scope = 'all' and u."profilePublic" order by s."playtimeMin" desc, u.handle asc limit 1`,
    );
    const hours = Math.floor(leader[0].playtimeMin / 60).toLocaleString("pt-BR");
    await expect(page.getByRole("list", { name: "Pódio" }).getByRole("listitem").first()).toContainText(hours);
    await context.close();
  });

  test("real arrows from the daily snapshot, and the viewer's sticky row", async ({ page, request }) => {
    const lucas = await userId("lucas");
    const yesterday = localDay(1);
    // Yesterday lucas was 3 places lower on Horas jogadas (the snapshot the arrows compare with).
    const ranks = await sql<{ userId: string; rank: number }>(
      `select s."userId", (row_number() over (order by s."playtimeMin" desc, u.handle asc))::int as rank
       from "UserRankStats" s join "User" u on u.id = s."userId"
       where s.scope = 'all' and s."playtimeMin" > 0 and u."profilePublic"`,
    );
    const now = ranks.find((r) => r.userId === lucas)!.rank;
    await sql(`delete from "RankSnapshot" where board = 'horas:all' and day = $1`, [yesterday]);
    for (const r of ranks) {
      await sql(`insert into "RankSnapshot" (board, day, "userId", rank) values ('horas:all', $1, $2, $3)`, [
        yesterday,
        r.userId,
        r.userId === lucas ? now + 3 : r.rank,
      ]);
    }
    try {
      // The daily cron takes today's snapshot and refreshes the cached boards.
      const cron = await request.get("/api/cron/highscores", { headers: { authorization: "Bearer e2e-cron-secret" } });
      expect(cron.status()).toBe(200);
      expect(await cron.json()).toMatchObject({ job: "highscores", processed: expect.any(Number) });
      const [today] = await sql<{ n: number }>(`select count(*)::int as n from "RankSnapshot" where day = $1`, [localDay()]);
      expect(today.n).toBeGreaterThan(0);

      await loginAs(page, "lucas");
      await page.goto("/highscores/horas");
      const since = `${yesterday.slice(8, 10)}/${yesterday.slice(5, 7)}`;
      await expect(page.getByText(`As setas mostram a mudança de posição desde ${since}.`)).toBeVisible();

      const bar = page.getByRole("complementary", { name: "Sua posição" });
      await expect(bar).toContainText("Você está aqui");
      await expect(bar).toContainText(`Posição ${now}`);
      await expect(bar).toContainText(`Subiu 3 posições desde ${since}`);
      await expect(bar).toContainText(now === 1 ? "Você lidera este ranking." : /Faltam .+ para alcançar @/);
      // The bar stays on screen while the board scrolls.
      expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");

      // lucas's own slot/row is marked after hydration.
      const mine = page.locator('[aria-current="true"]').filter({ hasText: "@lucas" });
      await expect(mine).toHaveCount(1);
      await expect(mine).toContainText("você");
      expect(await axeBlocking(page)).toEqual([]);

      // Logged out: the bar invites to sign in.
      await page.context().clearCookies({ name: "gl_session" });
      await page.goto("/highscores/horas");
      await expect(page.getByRole("complementary", { name: "Sua posição" }).getByRole("link", { name: "Entrar" })).toBeVisible();
    } finally {
      await sql(`delete from "RankSnapshot" where board = 'horas:all' and day = $1`, [yesterday]);
    }
  });
});

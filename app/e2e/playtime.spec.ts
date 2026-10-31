import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { loginAs, sql } from "./helpers";

/*
 * Plano 4, F1/F2: a sync imports the whole Steam library (never-played games too), the wishlist
 * and pays hours milestones; the sheet shows the new attributes Resistência and Acervo; the full
 * catalog's name-only stubs stay out of /jogos; the steam-catalog cron answers (offline: app list
 * only). Runs on the Steam fixture (STEAM_MODE=fixture), against the e2e database.
 */

/** A seeded player with a Steam account other than lucas (lucas is the screens' demo user). */
async function steamPlayer(): Promise<{ id: string; handle: string }> {
  const [row] = await sql<{ id: string; handle: string }>(
    `select id, handle from "User" where "steamId" is not null and handle <> 'lucas' order by handle limit 1`,
  );
  if (!row) throw new Error("No seeded Steam player: reseed the e2e database.");
  return row;
}

test.describe("full sync and playtime RPG", () => {
  test("a sync pays hours, records never-played games and the wishlist; the sheet shows Resistência and Acervo", async ({ page }) => {
    const player = await steamPlayer();
    // Free the 2-minute sync slot (earlier runs on the same database).
    await sql(`update "User" set "lastSyncAttemptAt" = null where id = $1`, [player.id]);
    await loginAs(page, player.handle);
    await page.goto(`/jogador/${player.handle}`);

    const attributes = page.locator("section").filter({ has: page.getByRole("heading", { name: "Atributos" }) });
    await expect(attributes.getByText("Resistência", { exact: true })).toBeVisible();
    await expect(attributes.getByText("Acervo", { exact: true })).toBeVisible();
    await expect(attributes.getByRole("progressbar", { name: /Progresso de Resistência/ })).toBeVisible();

    await page.getByRole("button", { name: "Sincronizar conquistas" }).click();
    await expect
      .poll(async () => (await sql<{ n: number }>(
        `select count(*)::int as n from "XpLedgerEntry" where "userId" = $1 and source = 'playtime' and "voidedAt" is null`,
        [player.id],
      ))[0].n, { timeout: 60_000 })
      .toBeGreaterThan(0);

    const [library] = await sql<{ owned: number; never: number; wished: number }>(
      `select
         (select count(*)::int from "UserGame" where "userId" = $1 and platform = 'steam') as owned,
         (select count(*)::int from "UserGame" where "userId" = $1 and platform = 'steam' and "playtimeMin" = 0 and "unlockedCount" = 0) as never,
         (select count(*)::int from "WishlistItem" where "userId" = $1) as wished`,
      [player.id],
    );
    expect(library.never).toBeGreaterThanOrEqual(3);
    expect(library.owned).toBeGreaterThanOrEqual(17);
    expect(library.wished).toBe(3);

    const [acervo] = await sql<{ points: number }>(
      `select points from "AttributeProgress" where "userId" = $1 and attribute = 'acervo'`,
      [player.id],
    );
    expect(acervo.points).toBeGreaterThan(0);

    await page.reload();
    await expect(attributes.getByText("Resistência", { exact: true })).toBeVisible();
    const results = await new AxeBuilder({ page }).include("main").analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });

  test("name-only stubs of the full Steam catalog stay out of /jogos but have a page", async ({ page }) => {
    await page.goto("/jogos");
    await expect(page.getByRole("link", { name: /Hollow Knight/ }).first()).toBeVisible();
    await expect(page.getByText("Lanterna do Farol")).toHaveCount(0);
    expect((await page.goto("/jogos/lanterna-do-farol"))?.status()).toBe(200);
  });

  test("the steam-catalog cron job needs the secret and answers offline with the app list only", async ({ request }) => {
    expect((await request.get("/api/cron/steam-catalog")).status()).toBe(401);
    const res = await request.get("/api/cron/steam-catalog", { headers: { authorization: "Bearer e2e-cron-secret" } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ job: "steam-catalog", details: { skipped: "offline" }, appList: { status: "ok" } });
  });
});

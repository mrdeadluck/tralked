import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { CAN_LOGIN, loginAs, sql } from "./helpers";

/**
 * Connections the Exophase way (/conta/conexoes): one field per service, saved at once and linked
 * without a code; an account already on another profile is refused and can be claimed with a code
 * in the profile (offline fixture profiles: src/lib/integrations/*\/fixture.ts); clearing a field
 * asks before disconnecting. Accounts created here are prefixed `e2c_` and removed first.
 *
 * PSN, Xbox and RetroAchievements only have fixtures outside production, so the flows run on the
 * dev server (`pnpm e2e:dev`); the production build (`pnpm e2e`) checks they show "Em breve".
 */

const RUN = Date.now().toString(36);
const BLOCKING_IMPACTS = ["serious", "critical"];

test.beforeAll(async () => {
  await sql(`delete from "User" where handle like 'e2c\\_%'`);
  // Morrigan77 is a seeded account of the old Steam login (no credentials): a previous run may have recovered it.
  await sql(`update "User" set email = null, "passwordHash" = null, "googleSub" = null where handle = 'Morrigan77'`);
});

/**
 * A new account (e-mail + password, as after the sign-up) whose session this page takes. Inserted
 * directly: the sign-up form has its own spec and a per-IP limit this file would exhaust.
 */
async function newAccount(page: Page, suffix: string) {
  const handle = `e2c_${suffix}_${RUN}`.slice(0, 20);
  const id = `e2c${suffix}${RUN}`;
  await sql(
    `insert into "User" (id, handle, "displayName", email, "passwordHash", "updatedAt") values ($1, $2, $3, $4, 'scrypt$e2e', now())`,
    [id, handle, `E2E ${suffix}`, `${handle}@e2e.tralked.dev`],
  );
  await loginAs(page, handle);
  await page.goto("/conta/conexoes");
  return { handle, id };
}
const services = (page: Page) => page.getByRole("form", { name: "Serviços" });
const field = (page: Page, name: string) => services(page).getByLabel(name, { exact: true });
/** The service's row: its field, badge, status and messages. */
const row = (page: Page, name: string) => services(page).getByRole("listitem").filter({ has: page.getByLabel(name, { exact: true }) });

async function save(page: Page) {
  await services(page).getByRole("button", { name: "Salvar alterações" }).click();
}

/** Simulates pasting a fixture code: the pending claim gets the code the fixture profile shows. */
async function pasteCode(userId: string, platform: string, code: string) {
  await sql(
    `update "LinkedAccount" set "verifyCode" = $3, "lastSyncAttemptAt" = null where "userId" = $1 and platform = $2`,
    [userId, platform, code],
  );
}

async function expectNoBlockingAxe(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = violations
    .filter((v) => BLOCKING_IMPACTS.includes(v.impact ?? ""))
    .map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

test.describe("connections (Exophase model)", () => {
  test("production without platform credentials: PSN, Xbox and RetroAchievements are 'Em breve'", async ({ page }) => {
    test.skip(CAN_LOGIN, "production build only (the dev server uses the fixtures)");
    await loginAs(page, "urso");
    await page.goto("/conta/conexoes");
    for (const name of ["PlayStation", "Xbox", "RetroAchievements"]) {
      await expect(field(page, name)).toBeDisabled();
      await expect(row(page, name)).toContainText("Em breve");
    }
    await expect(field(page, "Steam")).toBeEnabled();
    await expectNoBlockingAxe(page);
  });

  test("several fields at once: saved, linked without a code (not verified) and syncing", async ({ page }) => {
    test.skip(!CAN_LOGIN, "PSN/Xbox/RA fixtures only exist outside production");
    const { id } = await newAccount(page, "varios");

    // A private Steam profile is refused with the privacy help; nothing is linked.
    await field(page, "Steam").fill("perfil-fechado");
    await save(page);
    await expect(row(page, "Steam")).toContainText("Seu perfil Steam está privado");
    await expect(row(page, "Steam").getByRole("link", { name: "Como deixar o perfil público" })).toHaveAttribute(
      "href",
      "#ajuda-privacidade",
    );
    await expect(field(page, "Steam")).toBeFocused();

    await field(page, "Steam").fill("https://steamcommunity.com/id/tralked-dois/");
    await field(page, "PlayStation").fill("Tralked-Teste");
    await field(page, "Xbox").fill("Tralked Teste");
    await field(page, "RetroAchievements").fill("TralkedTeste");
    await save(page);
    await expect(services(page).getByText("Alterações salvas.")).toBeVisible();

    await expect(field(page, "Steam")).toHaveValue("76561198000000044");
    for (const [name, handle] of [
      ["Steam", "Tralked Dois"],
      ["PlayStation", "Tralked-Teste"],
      ["Xbox", "Tralked Teste"],
      ["RetroAchievements", "TralkedTeste"],
    ]) {
      await expect(row(page, name)).toContainText(`Conectada como ${handle} · não verificada`);
      await expect(row(page, name)).toContainText("Não verificada");
    }
    const rows = await sql<{ platform: string; active: boolean; verified: boolean }>(
      `select platform, "linkedAt" is not null as active, "verifiedAt" is not null as verified
         from "LinkedAccount" where "userId" = $1 order by platform`,
      [id],
    );
    expect(rows).toEqual(["psn", "retro", "steam", "xbox"].map((platform) => ({ platform, active: true, verified: false })));

    // Each new connection imports in the background (fixtures), and the page shows the result.
    await expect
      .poll(
        async () =>
          (
            await sql<{ n: string }>(
              `select count(*) as n from "LinkedAccount" where "userId" = $1 and platform <> 'steam' and "lastSyncedAt" is not null`,
              [id],
            )
          )[0].n,
        { timeout: 60_000 },
      )
      .toBe("3");
    await expect.poll(async () => (await sql(`select 1 from "UserGame" where "userId" = $1 limit 1`, [id])).length, { timeout: 60_000 }).toBe(1);
    await expect(row(page, "PlayStation")).toContainText("Última sincronização", { timeout: 20_000 });

    // The character sheet shows the connections as not verified.
    await page.goto("/jogador/me");
    await expect(page.getByRole("list", { name: "Plataformas conectadas" })).toContainText("não verificada");
  });

  test("an account on another profile is refused; 'Reivindicar' with the code moves it", async ({ page }) => {
    const holder = await newAccount(page, "dono");
    await field(page, "Steam").fill("tralked-teste");
    await save(page);
    await expect(row(page, "Steam")).toContainText("Conectada como Tralked Teste");

    const claimant = await newAccount(page, "reivindica");
    await field(page, "Steam").fill("76561198000000042");
    await save(page);
    await expect(row(page, "Steam")).toContainText("Essa conta já está conectada a outro perfil.");
    await expect(field(page, "Steam")).toHaveAttribute("aria-invalid", "true");
    await row(page, "Steam").getByRole("button", { name: "É sua? Reivindicar" }).click();

    const claim = row(page, "Steam").getByRole("region", { name: /Reivindicar a conta Steam/ });
    await expect(claim.locator("code")).toHaveText(/^TRK-[A-Z2-9]{6}$/);
    await expect(row(page, "Steam")).toContainText("Reivindicação pendente");
    await expectNoBlockingAxe(page);

    // Not in the profile yet: refused.
    await claim.getByRole("button", { name: "Já colei o código" }).click();
    await expect(row(page, "Steam").getByRole("alert")).toContainText('Não encontramos o código no campo "Resumo"');

    await pasteCode(claimant.id, "steam", "TRK-STEAM2");
    await claim.getByRole("button", { name: "Já colei o código" }).click();
    await expect(row(page, "Steam")).toContainText("agora é sua (verificada)");
    await expect(row(page, "Steam")).toContainText("Conectada como Tralked Teste · verificada");

    const [mine] = await sql<{ active: boolean; verified: boolean }>(
      `select "linkedAt" is not null as active, "verifiedAt" is not null as verified from "LinkedAccount" where "userId" = $1 and platform = 'steam'`,
      [claimant.id],
    );
    expect(mine).toEqual({ active: true, verified: true });
    const [previous] = await sql<{ active: boolean; steamId: string | null }>(
      `select l."linkedAt" is not null as active, u."steamId" from "LinkedAccount" l join "User" u on u.id = l."userId"
        where l."userId" = $1 and l.platform = 'steam'`,
      [holder.id],
    );
    expect(previous).toEqual({ active: false, steamId: null });
    const notices = await sql(`select 1 from "Notification" where "userId" = $1 and title = 'Sua conexão Steam foi reivindicada'`, [
      holder.id,
    ]);
    expect(notices).toHaveLength(1);
  });

  test("an old Steam-login account: typing its Steam is refused, only the claim recovers the history", async ({ page }) => {
    const fresh = await newAccount(page, "volta");
    await field(page, "Steam").fill("morrigan77");
    await save(page);
    await expect(row(page, "Steam")).toContainText("Essa conta já está conectada a outro perfil.");
    const [legacy] = await sql<{ passwordHash: string | null }>(`select "passwordHash" from "User" where handle = 'Morrigan77'`);
    expect(legacy.passwordHash).toBeNull();

    await row(page, "Steam").getByRole("button", { name: "É sua? Reivindicar" }).click();
    await expect(row(page, "Steam").locator("code")).toHaveText(/^TRK-[A-Z2-9]{6}$/);
    await pasteCode(fresh.id, "steam", "TRK-HERDA2");
    await row(page, "Steam").getByRole("button", { name: "Já colei o código" }).click();

    await expect(page).toHaveURL(/\/conta\/conexoes\?historico=1$/);
    await expect(page.getByRole("status").filter({ hasText: "Encontramos o seu histórico do Tralked." })).toContainText(
      "@Morrigan77",
    );
    expect(await sql(`select id from "User" where id = $1`, [fresh.id])).toHaveLength(0);
  });

  test("clearing a field asks first; confirmed, the account is disconnected", async ({ page }) => {
    test.skip(!CAN_LOGIN, "PSN fixtures only exist outside production");
    const { id } = await newAccount(page, "limpa");
    await field(page, "PlayStation").fill("Sem-Data");
    await save(page);
    await expect(row(page, "PlayStation")).toContainText("Conectada como Sem-Data");

    await field(page, "PlayStation").fill("");
    await save(page);
    const dialog = page.getByRole("dialog", { name: "Desconectar PlayStation?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("O XP vindo dessa conta é anulado");
    await expectNoBlockingAxe(page);

    // Cancel: nothing happens.
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toBeHidden();
    const active = async () =>
      (await sql<{ active: boolean }>(`select "linkedAt" is not null as active from "LinkedAccount" where "userId" = $1 and platform = 'psn'`, [id]))[0]
        .active;
    expect(await active()).toBe(true);

    // Escape closes it as well.
    await save(page);
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await active()).toBe(true);

    await save(page);
    await dialog.getByRole("button", { name: "Desconectar e salvar" }).click();
    await expect(row(page, "PlayStation")).toContainText("PlayStation desconectada.");
    await expect(row(page, "PlayStation")).toContainText("Não conectada");
    await expect(field(page, "PlayStation")).toHaveValue("");
    expect(await active()).toBe(false);
  });
});

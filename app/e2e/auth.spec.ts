import { existsSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { MAIL_LOG_FILE } from "./config";
import { CAN_LOGIN, sql } from "./helpers";

/**
 * Tralked's own accounts: sign-up, login, wrong password, forgot/reset password. Connecting
 * Steam (and claiming an account of the old Steam login) is in connections.spec.ts. Runs in both
 * modes: nothing here needs the demo login. Accounts created here are prefixed `e2e_` and removed
 * first.
 */

const RUN = Date.now().toString(36);
const PASSWORD = "senha-e2e-1234";

test.beforeAll(async () => {
  await sql(`delete from "User" where handle like 'e2e\\_%'`);
});

async function signup(page: Page, suffix: string) {
  const handle = `e2e_${suffix}_${RUN}`.slice(0, 20);
  const email = `${handle}@e2e.tralked.dev`;
  await page.goto("/cadastrar");
  await page.getByLabel("Nome de exibição").fill(`E2E ${suffix}`);
  await page.getByLabel("@ do personagem").fill(handle);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha do Tralked").fill(PASSWORD);
  await page.getByLabel(/Li e aceito/).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/conta\/conexoes\?bemvindo=1$/);
  return { handle, email };
}

type LoggedMail = { kind: string; to: string; subject: string; link: string | null };

/** The e-mails the dev e2e server wrote since `offset` (characters of MAIL_LOG_FILE). */
function mailsSince(offset: number): LoggedMail[] {
  if (!existsSync(MAIL_LOG_FILE)) return [];
  return readFileSync(MAIL_LOG_FILE, "utf8")
    .slice(offset)
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LoggedMail);
}

const mailLogSize = () => (existsSync(MAIL_LOG_FILE) ? readFileSync(MAIL_LOG_FILE, "utf8").length : 0);

async function login(page: Page, email: string, password: string) {
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

/**
 * The generic login error, once this submission's answer is in: two failures show the same
 * text, so also wait for the form to settle (button back, password cleared by React's reset).
 */
async function expectWrongCredentials(page: Page) {
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("E-mail ou senha incorretos.");
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Senha", { exact: true })).toHaveValue("");
}

async function logout(page: Page, handle: string) {
  const menu = page.getByRole("group", { name: "Conta" });
  await menu.getByRole("button", { name: new RegExp(handle) }).click();
  await menu.getByRole("button", { name: "Sair" }).click();
  await expect(page.getByRole("banner").getByRole("link", { name: "Entrar" })).toBeVisible();
}

test.describe("Tralked account", () => {
  test("a visitor's Personagem goes to /entrar, never to Steam", async ({ page }) => {
    await page.goto("/jogador/me");
    await expect(page).toHaveURL(/\/entrar\?returnTo=%2Fjogador%2Fme$/);
    await expect(page.getByRole("heading", { level: 1, name: "Entrar" })).toBeVisible();
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Entrar" })).toHaveAttribute("href", "/entrar?returnTo=%2Fjogador%2Fme");
    await expect(page.locator('a[href*="/api/auth/steam"]')).toHaveCount(0);
  });

  test("sign up lands on Conexões; logout; wrong password is generic; login comes back", async ({ page }) => {
    const { handle, email } = await signup(page, "conta");
    await expect(page.getByRole("status").filter({ hasText: "Conta criada." })).toBeVisible();
    await expect(page.getByRole("form", { name: "Serviços" }).getByLabel("Steam", { exact: true })).toHaveValue("");

    await logout(page, handle);

    await page.goto("/entrar?returnTo=%2Fjogador%2Fme");
    await login(page, email, "senha-errada-99");
    await expectWrongCredentials(page);
    // What was typed stays (the password does not).
    await expect(page.getByLabel("E-mail", { exact: true })).toHaveValue(email);
    await expect(page.getByLabel("Senha", { exact: true })).toHaveValue("");

    await login(page, `nao-existe-${RUN}@e2e.tralked.dev`, PASSWORD);
    await expectWrongCredentials(page);

    await login(page, email.toUpperCase(), PASSWORD);
    await expect(page).toHaveURL(new RegExp(`/jogador/${handle}$`));
  });

  test("forgot password: same answer for any e-mail, and the link sets a new password once", async ({ page }) => {
    // A production build without RESEND_API_KEY never prints or writes the link (test below).
    test.skip(!CAN_LOGIN, "the reset link is only written outside production (dev server)");
    const { handle, email } = await signup(page, "senha");
    await logout(page, handle);
    const before = mailLogSize();

    await page.goto("/esqueci-senha");
    await page.getByLabel("E-mail da conta").fill(`nao-existe-${RUN}@e2e.tralked.dev`);
    await page.getByRole("button", { name: "Enviar link" }).click();
    const answer = page.getByRole("status").filter({ hasText: "Se existir uma conta" });
    await expect(answer).toBeVisible();
    const unknownAnswer = await answer.textContent();

    await page.getByLabel("E-mail da conta").fill(email);
    await page.getByRole("button", { name: "Enviar link" }).click();
    await expect(answer).toHaveText(unknownAnswer ?? "");

    // Without RESEND_API_KEY the dev server logs the e-mail; the e2e server also writes it to a file.
    let link = "";
    await expect(async () => {
      const mails = mailsSince(before);
      expect(mails.filter((m) => m.to.startsWith("nao-existe-"))).toHaveLength(0);
      link = mails.findLast((m) => m.to === email && m.kind === "password-reset")?.link ?? "";
      expect(link).toContain("/redefinir-senha?token=");
    }).toPass({ timeout: 10_000 });

    const url = new URL(link);
    await page.goto(url.pathname + url.search);
    await page.getByLabel("Nova senha", { exact: true }).fill("nova-senha-e2e-1");
    await page.getByLabel("Repita a nova senha").fill("nova-senha-e2e-1");
    await page.getByRole("button", { name: "Salvar senha e entrar" }).click();
    await expect(page).toHaveURL(new RegExp(`/jogador/${handle}$`));

    // Used once: the same link no longer works.
    await page.goto(url.pathname + url.search);
    await expect(page.getByRole("heading", { name: "Este link não vale mais" })).toBeVisible();

    await logout(page, handle);
    await page.goto("/entrar");
    await login(page, email, PASSWORD);
    await expectWrongCredentials(page);
    await login(page, email, "nova-senha-e2e-1");
    await expect(page).toHaveURL(new RegExp(`/jogador/${handle}$`));
  });

  test("sign-up sends the welcome e-mail; its link confirms the e-mail and /conta shows the badge", async ({ page }) => {
    test.skip(!CAN_LOGIN, "e-mails are only written outside production (dev server)");
    const before = mailLogSize();
    const { email } = await signup(page, "conf");

    await page.goto("/conta");
    await expect(page.getByText("E-mail não confirmado")).toBeVisible();
    // Asking again works (limited per account).
    await page.getByRole("button", { name: "Reenviar e-mail de confirmação" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Enviamos um novo link de confirmação" })).toBeVisible();

    let link = "";
    await expect(async () => {
      const mails = mailsSince(before).filter((m) => m.to === email);
      expect(mails.map((m) => m.kind).sort()).toEqual(["email-confirmation", "welcome"]);
      link = mails.find((m) => m.kind === "welcome")?.link ?? "";
      expect(link).toContain("/confirmar-email?token=");
    }).toPass({ timeout: 10_000 });

    // Opening the link (GET) confirms nothing: the button does.
    const url = new URL(link);
    await page.goto(url.pathname + url.search);
    await expect(page.getByRole("heading", { level: 1, name: "Confirmar e-mail" })).toBeVisible();
    await page.getByRole("button", { name: "Confirmar e-mail" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "E-mail confirmado" })).toBeVisible();

    await page.goto("/conta");
    await expect(page.getByText("E-mail confirmado")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reenviar e-mail de confirmação" })).toHaveCount(0);
  });

  test("production without RESEND_API_KEY: forgot password says e-mail is off", async ({ page }) => {
    test.skip(CAN_LOGIN, "only the production build has e-mail off");
    await page.goto("/esqueci-senha");
    await expect(page.getByText("O envio de e-mails do Tralked está desativado no momento").first()).toBeVisible();
    await page.getByLabel("E-mail da conta").fill(`alguem-${RUN}@e2e.tralked.dev`);
    await page.getByRole("button", { name: "Enviar link" }).click();
    await expect(page.getByRole("main").getByText(/não conseguimos mandar o link agora/)).toBeVisible();
  });
});

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Real database and password hashing; the request (headers, cookies, redirect, after) is mocked.
const createSession = vi.fn();
const redirect = vi.fn((to: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), { to });
});
const afterTasks: (() => Promise<void>)[] = [];

vi.mock("./session", () => ({ createSession }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }) }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<void>) => afterTasks.push(task),
}));

const { prisma } = await import("@/lib/db");
const { forgotPasswordAction, loginAction, resetPasswordAction, signupAction } = await import("./actions");
const { createPasswordResetToken } = await import("./password-reset");
const { resetAuthLimits } = await import("./rate-limit");

const MARK = "tact_";
const DOMAIN = "@actions.test";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** Runs an action that may redirect; returns its state or where it redirected. */
async function run<T>(action: Promise<T>): Promise<T | { redirectedTo: string }> {
  try {
    return await action;
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return { redirectedTo: (error as Error & { to: string }).to };
    throw error;
  }
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: MARK } } });
}
beforeEach(async () => {
  vi.clearAllMocks();
  afterTasks.length = 0;
  resetAuthLimits();
  await cleanup();
});
afterAll(cleanup);

const signup = (overrides: Record<string, string> = {}) =>
  run(
    signupAction(
      {},
      form({ displayName: "Bia", handle: `${MARK}bia`, email: `bia${DOMAIN}`, password: "senha da bia", terms: "on", ...overrides }),
    ),
  );

describe("signupAction", () => {
  it("creates the account, opens the session and lands on the connections page", async () => {
    expect(await signup()).toEqual({ redirectedTo: "/conta/conexoes?bemvindo=1" });
    const user = await prisma.user.findUniqueOrThrow({ where: { handle: `${MARK}bia` } });
    expect(createSession).toHaveBeenCalledWith(user.id);
    expect(user.emailVerifiedAt).toBeNull();
  });

  it("sends the welcome e-mail (with the confirmation link) after the response", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await signup();
      expect(afterTasks).toHaveLength(1);
      expect(info).not.toHaveBeenCalled();
      for (const task of afterTasks) await task();
      expect(info).toHaveBeenCalledTimes(1);
      expect(String(info.mock.calls[0][0])).toMatch(/^\[e-mail\] welcome para bia@.*\/confirmar-email\?token=/);
    } finally {
      info.mockRestore();
    }
  });

  it("explains invalid fields, keeps what was typed (never the password) and creates nothing", async () => {
    const state = await signup({ email: "bia", password: "curta", terms: "" });
    expect(state).toMatchObject({
      errors: {
        email: "Informe um e-mail válido.",
        password: "A senha precisa ter pelo menos 8 caracteres.",
        terms: expect.stringContaining("Termos"),
      },
      values: { displayName: "Bia", handle: `${MARK}bia`, email: "bia" },
    });
    expect(JSON.stringify(state)).not.toContain("curta");
    expect(createSession).not.toHaveBeenCalled();
    expect(await prisma.user.count({ where: { handle: `${MARK}bia` } })).toBe(0);
  });

  it("refuses an e-mail or @ already in use", async () => {
    await signup();
    expect(await signup({ handle: `${MARK}outra` })).toMatchObject({ errors: { email: expect.stringContaining("já tem uma conta") } });
    expect(await signup({ email: `outra${DOMAIN}` })).toMatchObject({ errors: { handle: "Esse @ já está em uso. Escolha outro." } });
  });
});

describe("loginAction", () => {
  beforeEach(async () => {
    await signup();
    vi.clearAllMocks();
  });

  const login = (email: string, password: string, returnTo = "/forum") =>
    run(loginAction({}, form({ email, password, returnTo })));

  it("logs in and goes back to a same-site returnTo (never another origin)", async () => {
    expect(await login(`BIA${DOMAIN}`, "senha da bia")).toEqual({ redirectedTo: "/forum" });
    expect(createSession).toHaveBeenCalledTimes(1);
    // The default (and any unsafe) returnTo lands on the user's own sheet.
    expect(await login(`bia${DOMAIN}`, "senha da bia", "//evil.example.com")).toEqual({ redirectedTo: `/jogador/${MARK}bia` });
  });

  it("answers a wrong password and an unknown e-mail with the same generic message", async () => {
    const wrong = await login(`bia${DOMAIN}`, "senha errada");
    const unknown = await login(`ninguem${DOMAIN}`, "senha da bia");
    expect(wrong).toEqual({ message: "E-mail ou senha incorretos.", values: { email: `bia${DOMAIN}` } });
    expect(unknown).toEqual({ message: "E-mail ou senha incorretos.", values: { email: `ninguem${DOMAIN}` } });
    expect(await login(`bia${DOMAIN}`, "x".repeat(129))).toMatchObject({ message: "E-mail ou senha incorretos." });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("asks for both fields", async () => {
    expect(await login("", "")).toMatchObject({ errors: { email: "Informe o e-mail.", password: "Informe a senha." } });
  });

  it("locks an e-mail after 5 wrong passwords, even for the right one", async () => {
    for (let i = 0; i < 5; i++) expect(await login(`bia${DOMAIN}`, `errada ${i}`)).toMatchObject({ message: "E-mail ou senha incorretos." });
    expect(await login(`bia${DOMAIN}`, "senha da bia")).toMatchObject({ message: expect.stringMatching(/^Muitas tentativas/) });
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("forgotPasswordAction / resetPasswordAction", () => {
  it("answers the same for any e-mail; only a registered one gets a link", async () => {
    await signup();
    afterTasks.length = 0; // the sign-up's welcome e-mail
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const known = await run(forgotPasswordAction({}, form({ email: `bia${DOMAIN}` })));
      const unknown = await run(forgotPasswordAction({}, form({ email: `ninguem${DOMAIN}` })));
      expect({ ...known, values: undefined }).toEqual({ ...unknown, values: undefined });
      expect(known).toMatchObject({ done: true, message: expect.stringContaining("Se existir uma conta") });
      for (const task of afterTasks) await task();
      const user = await prisma.user.findUniqueOrThrow({ where: { handle: `${MARK}bia` } });
      expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);
      expect(info).toHaveBeenCalledTimes(1);
      expect(String(info.mock.calls[0][0])).toContain("/redefinir-senha?token=");
    } finally {
      info.mockRestore();
    }
  });

  it("in production without RESEND_API_KEY says e-mail is off and creates no link", async () => {
    await signup();
    afterTasks.length = 0;
    vi.stubEnv("NODE_ENV", "production");
    try {
      const state = await run(forgotPasswordAction({}, form({ email: `bia${DOMAIN}` })));
      expect(state).toMatchObject({ message: expect.stringContaining("envio de e-mails do Tralked está desativado") });
      expect(state).not.toHaveProperty("done");
      expect(afterTasks).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("sets the new password with a valid link and logs in; refuses mismatched or used links", async () => {
    await signup();
    const user = await prisma.user.findUniqueOrThrow({ where: { handle: `${MARK}bia` } });
    const token = await createPasswordResetToken(user.id);
    vi.clearAllMocks();

    expect(await run(resetPasswordAction({}, form({ token, password: "nova senha 1", confirm: "outra" })))).toMatchObject({
      errors: { confirm: "As senhas não são iguais." },
    });
    expect(await run(resetPasswordAction({}, form({ token, password: "nova senha 1", confirm: "nova senha 1" })))).toEqual({
      redirectedTo: `/jogador/${MARK}bia`,
    });
    expect(createSession).toHaveBeenCalledWith(user.id);
    expect(await run(resetPasswordAction({}, form({ token, password: "nova senha 2", confirm: "nova senha 2" })))).toMatchObject({
      message: expect.stringContaining("expirou ou já foi usado"),
    });
  });
});

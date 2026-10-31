import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
const destroySession = vi.fn();
const updateTag = vi.fn();
const redirect = vi.fn(() => {
  throw new Error("NEXT_REDIRECT");
});
const deleteAccount = vi.fn();
const updateProfileSettings = vi.fn();
const changeEmail = vi.fn();
const changePassword = vi.fn();
const visibilityTags = vi.fn();

const refresh = vi.fn();
const sendEmailConfirmation = vi.fn();
const afterTasks: (() => Promise<void>)[] = [];

vi.mock("@/lib/auth/session", () => ({ getSessionUser, destroySession }));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  updateTag,
  refresh,
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<void>) => afterTasks.push(task),
}));
vi.mock("@/lib/auth/email-verification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/email-verification")>()),
  sendEmailConfirmation,
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/accounts/delete", () => ({ deleteAccount }));
vi.mock("@/lib/accounts/privacy", () => ({ visibilityTags }));
vi.mock("@/lib/accounts/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accounts/settings")>()),
  updateProfileSettings,
}));

vi.mock("@/lib/auth/credentials", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/credentials")>()),
  changeEmail,
  changePassword,
}));

const userUpdate = vi.fn<(args: unknown) => Promise<object>>(async () => ({}));
// Only prisma.user.update is replaced (the case intro switch); everything else stays real.
vi.mock("@/lib/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db")>();
  const user = new Proxy(mod.prisma.user, { get: (target, key) => (key === "update" ? userUpdate : Reflect.get(target, key)) });
  return { ...mod, prisma: new Proxy(mod.prisma, { get: (target, key) => (key === "user" ? user : Reflect.get(target, key)) }) };
});

const {
  changeEmailAction,
  changePasswordAction,
  deleteAccountAction,
  resendEmailConfirmationAction,
  setCaseIntroAction,
  updateProfileAction,
} = await import("./actions");
const { resetAuthLimits } = await import("@/lib/auth/rate-limit");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  afterTasks.length = 0;
  resetAuthLimits();
  getSessionUser.mockResolvedValue({ id: "u1", handle: "eu" });
  updateProfileSettings.mockResolvedValue({ visibilityChanged: false });
  visibilityTags.mockResolvedValue(["gallery", "forum", "photo:p1", "player:eu"]);
});

describe("setCaseIntroAction", () => {
  it("needs a session", async () => {
    getSessionUser.mockResolvedValue(null);
    expect(await setCaseIntroAction({ off: true })).toMatchObject({ ok: false });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("saves the choice on the account", async () => {
    expect(await setCaseIntroAction({ off: true })).toEqual({ ok: true });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { caseIntroOff: true } });
    expect(await setCaseIntroAction({ off: false })).toEqual({ ok: true });
    expect(userUpdate).toHaveBeenLastCalledWith({ where: { id: "u1" }, data: { caseIntroOff: false } });
  });

  it("refuses anything but a boolean", async () => {
    for (const input of [{ off: "true" }, { off: 1 }, null, { off: true, extra: 1 }]) {
      expect(await setCaseIntroAction(input)).toMatchObject({ ok: false });
    }
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe("updateProfileAction", () => {
  it("needs a session", async () => {
    getSessionUser.mockResolvedValue(null);
    expect(await updateProfileAction({ bio: "oi", profilePublic: true })).toMatchObject({ ok: false });
    expect(updateProfileSettings).not.toHaveBeenCalled();
  });

  it("saves a trimmed plain-text bio and the visibility", async () => {
    expect(await updateProfileAction({ bio: "  Caçador de platinas \r\n", profilePublic: false })).toEqual({ ok: true });
    expect(updateProfileSettings).toHaveBeenCalledWith("u1", { bio: "Caçador de platinas", profilePublic: false });
    expect(updateTag).not.toHaveBeenCalled(); // visibility did not change
  });

  it("going private (or public) refreshes the gallery, photo, forum and profile caches at once", async () => {
    updateProfileSettings.mockResolvedValue({ visibilityChanged: true });
    expect(await updateProfileAction({ bio: "", profilePublic: false })).toEqual({ ok: true });
    expect(visibilityTags).toHaveBeenCalledWith("u1");
    for (const tag of ["gallery", "forum", "photo:p1", "player:eu"]) expect(updateTag).toHaveBeenCalledWith(tag);
  });

  it("refuses HTML, bios over 280 characters and malformed input", async () => {
    const results = await Promise.all([
      updateProfileAction({ bio: "<script>alert(1)</script>", profilePublic: true }),
      updateProfileAction({ bio: "a".repeat(281), profilePublic: true }),
      updateProfileAction({ bio: "ok", profilePublic: "sim" }),
      updateProfileAction("nope"),
    ]);
    for (const result of results) expect(result.ok).toBe(false);
    expect(results[0]).toMatchObject({ error: expect.stringMatching(/HTML/) });
    expect(results[1]).toMatchObject({ error: expect.stringMatching(/280/) });
    expect(updateProfileSettings).not.toHaveBeenCalled();
  });
});

describe("deleteAccountAction", () => {
  it("needs a session and the typed confirmation", async () => {
    getSessionUser.mockResolvedValueOnce(null);
    expect(await deleteAccountAction({ confirmation: "EXCLUIR" })).toMatchObject({ ok: false });
    expect(await deleteAccountAction({ confirmation: "excluir" })).toMatchObject({ ok: false });
    expect(await deleteAccountAction({})).toMatchObject({ ok: false });
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(destroySession).not.toHaveBeenCalled();
  });

  it("deletes only the logged-in user, logs out, refreshes their public pages and goes home", async () => {
    deleteAccount.mockResolvedValue({ photoIds: ["p1"], threadIds: ["t1"], guideGameSlugs: ["hollow-knight"] });

    await expect(deleteAccountAction({ confirmation: "EXCLUIR", userId: "someone-else" })).rejects.toThrow("NEXT_REDIRECT");

    expect(deleteAccount).toHaveBeenCalledWith("u1");
    expect(destroySession).toHaveBeenCalled();
    expect(updateTag).toHaveBeenCalledWith("photo:p1");
    expect(updateTag).toHaveBeenCalledWith("thread:t1");
    expect(updateTag).toHaveBeenCalledWith("game:hollow-knight");
    expect(updateTag).toHaveBeenCalledWith("player:eu");
    expect(redirect).toHaveBeenCalledWith("/?conta=excluida");
  });

  it("keeps the session when the deletion fails", async () => {
    deleteAccount.mockRejectedValue(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await deleteAccountAction({ confirmation: "EXCLUIR" })).toMatchObject({ ok: false });
    expect(destroySession).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("changeEmailAction / changePasswordAction", () => {
  it("need a session and valid fields", async () => {
    getSessionUser.mockResolvedValueOnce(null);
    expect(await changeEmailAction({}, form({ email: "eu@exemplo.com" }))).toMatchObject({ message: expect.any(String) });
    expect(await changeEmailAction({}, form({ email: "nao-e-email" }))).toMatchObject({ errors: { email: "Informe um e-mail válido." } });
    expect(await changePasswordAction({}, form({ password: "curta", confirm: "curta" }))).toMatchObject({
      errors: { password: expect.stringContaining("8 caracteres") },
    });
    expect(await changePasswordAction({}, form({ password: "senha nova 1", confirm: "senha nova 2" }))).toMatchObject({
      errors: { confirm: "As senhas não são iguais." },
    });
    expect(changeEmail).not.toHaveBeenCalled();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("change only the logged-in user's credentials, checking the current password", async () => {
    changeEmail.mockResolvedValueOnce({ ok: true });
    expect(await changeEmailAction({}, form({ email: " Eu@Exemplo.com ", current: "atual", userId: "outro" }))).toMatchObject({ done: true });
    expect(changeEmail).toHaveBeenCalledWith("u1", "eu@exemplo.com", "atual");

    changePassword.mockResolvedValueOnce({ ok: false, reason: "wrong_password" });
    expect(await changePasswordAction({}, form({ current: "errada", password: "senha nova 1", confirm: "senha nova 1" }))).toEqual({
      errors: { current: "A senha atual não confere." },
    });
    expect(changePassword).toHaveBeenCalledWith("u1", "errada", "senha nova 1");

    changeEmail.mockResolvedValueOnce({ ok: false, reason: "email_taken" });
    expect(await changeEmailAction({}, form({ email: "dele@exemplo.com" }))).toMatchObject({
      errors: { email: "Esse e-mail já é usado por outra conta." },
    });
  });

  it("a new e-mail refreshes the page and sends its confirmation after the response", async () => {
    changeEmail.mockResolvedValueOnce({ ok: true, changed: true });
    expect(await changeEmailAction({}, form({ email: "novo@exemplo.com" }))).toMatchObject({
      done: true,
      message: expect.stringContaining("confirmar o endereço novo"),
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(afterTasks).toHaveLength(1);
    expect(sendEmailConfirmation).not.toHaveBeenCalled();
    await afterTasks[0]();
    expect(sendEmailConfirmation).toHaveBeenCalledWith("u1");
  });

  it("toggling the e-mail saves it but stops mailing past the per-account limit", async () => {
    changeEmail.mockResolvedValue({ ok: true, changed: true });
    for (let i = 0; i < 3; i++) {
      const address = i % 2 ? "a@exemplo.com" : "b@exemplo.com";
      expect(await changeEmailAction({}, form({ email: address }))).toMatchObject({ done: true });
    }
    expect(afterTasks).toHaveLength(3);
    expect(await changeEmailAction({}, form({ email: "a@exemplo.com" }))).toMatchObject({
      done: true,
      message: expect.stringContaining("não foi enviado agora"),
    });
    expect(changeEmail).toHaveBeenCalledTimes(4); // saved anyway
    expect(afterTasks).toHaveLength(3);
  });

  it("stops mailing one recipient past its daily limit, whatever the account", async () => {
    changeEmail.mockResolvedValue({ ok: true, changed: true });
    for (let i = 0; i < 4; i++) {
      getSessionUser.mockResolvedValueOnce({ id: `conta-${i}`, handle: `h${i}` });
      await changeEmailAction({}, form({ email: "alvo@exemplo.com" }));
    }
    expect(afterTasks).toHaveLength(3);
  });
});

describe("resendEmailConfirmationAction", () => {
  it("needs a session and an unconfirmed e-mail", async () => {
    getSessionUser.mockResolvedValueOnce(null);
    expect(await resendEmailConfirmationAction()).toMatchObject({ ok: false });
    getSessionUser.mockResolvedValueOnce({ id: "u1", email: null, emailVerifiedAt: null });
    expect(await resendEmailConfirmationAction()).toMatchObject({ ok: false, error: expect.stringContaining("Salve um e-mail") });
    getSessionUser.mockResolvedValueOnce({ id: "u1", email: "eu@exemplo.com", emailVerifiedAt: new Date() });
    expect(await resendEmailConfirmationAction()).toEqual({ ok: true, message: "Este e-mail já está confirmado." });
    expect(sendEmailConfirmation).not.toHaveBeenCalled();
  });

  it("sends at most 3 per hour per account, and says when e-mail is off", async () => {
    getSessionUser.mockResolvedValue({ id: "u-resend", email: "eu@exemplo.com", emailVerifiedAt: null });
    sendEmailConfirmation.mockResolvedValue("logged");
    for (let i = 0; i < 3; i++) {
      expect(await resendEmailConfirmationAction()).toMatchObject({ ok: true, message: expect.stringContaining("eu@exemplo.com") });
    }
    expect(await resendEmailConfirmationAction()).toMatchObject({ ok: false, error: expect.stringContaining("Tente de novo") });
    expect(sendEmailConfirmation).toHaveBeenCalledTimes(3);

    getSessionUser.mockResolvedValue({ id: "u-off", email: "eu@exemplo.com", emailVerifiedAt: null });
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(await resendEmailConfirmationAction()).toMatchObject({ ok: false, error: expect.stringContaining("desativado") });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(sendEmailConfirmation).toHaveBeenCalledTimes(3);
  });
});

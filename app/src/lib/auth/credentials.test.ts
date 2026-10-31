import { afterAll, beforeEach, describe, expect, it } from "vitest";

// Real Prisma against the test database.
const { prisma } = await import("@/lib/db");
const { authenticate, changeEmail, changePassword, createAccount, signupSchema } = await import("./credentials");
const { hashPassword } = await import("./password");

const MARK = "tcred_";
const EMAIL_DOMAIN = "@credentials.test";

async function cleanup() {
  await prisma.user.deleteMany({
    where: { OR: [{ handle: { startsWith: MARK } }, { email: { endsWith: EMAIL_DOMAIN } }] },
  });
}
beforeEach(cleanup);
afterAll(cleanup);

const valid = {
  displayName: "Ana Teste",
  handle: `${MARK}ana`,
  email: `Ana${EMAIL_DOMAIN}`,
  password: "uma senha boa",
  terms: "on",
};

const fieldErrors = (input: unknown) => {
  const result = signupSchema.safeParse(input);
  // The first message of each field, as the forms show it.
  return result.success ? {} : Object.fromEntries(result.error.issues.toReversed().map((i) => [String(i.path[0]), i.message]));
};

describe("signupSchema", () => {
  it("accepts a valid sign-up and normalizes the e-mail", () => {
    const parsed = signupSchema.parse({ ...valid, email: `  ANA${EMAIL_DOMAIN} ` });
    expect(parsed.email).toBe(`ana${EMAIL_DOMAIN}`);
    expect(parsed.terms).toBe(true);
  });

  it("explains each invalid field in pt-BR", () => {
    expect(fieldErrors({ ...valid, email: "não-é-email" })).toHaveProperty("email", "Informe um e-mail válido.");
    expect(fieldErrors({ ...valid, password: "curta" })).toHaveProperty("password", "A senha precisa ter pelo menos 8 caracteres.");
    expect(fieldErrors({ ...valid, password: "x".repeat(129) })).toHaveProperty("password", "A senha pode ter no máximo 128 caracteres.");
    expect(fieldErrors({ ...valid, handle: "a b" })).toHaveProperty("handle");
    expect(fieldErrors({ ...valid, handle: "ab" })).toHaveProperty("handle");
    // "me" is the /jogador/me alias (and too short anyway): never a handle.
    expect(fieldErrors({ ...valid, handle: "ME" })).toHaveProperty("handle");
    expect(fieldErrors({ ...valid, displayName: "  " })).toHaveProperty("displayName");
    expect(fieldErrors({ ...valid, terms: undefined })).toHaveProperty("terms");
  });
});

describe("createAccount / authenticate (database)", () => {
  it("creates an account with a hashed password and logs in with it (e-mail in any case)", async () => {
    const created = await createAccount(signupSchema.parse(valid));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.user).toMatchObject({ handle: `${MARK}ana`, email: `ana${EMAIL_DOMAIN}`, role: "user", steamId: null });
    expect(created.user.passwordHash).toMatch(/^scrypt\$/);
    expect(created.user.passwordHash).not.toContain(valid.password);

    expect((await authenticate(`ANA${EMAIL_DOMAIN}`, valid.password))?.id).toBe(created.user.id);
    expect(await authenticate(`ana${EMAIL_DOMAIN}`, "senha errada")).toBeNull();
    expect(await authenticate(`ninguem${EMAIL_DOMAIN}`, valid.password)).toBeNull();
  });

  it("refuses an e-mail or @ already in use (case-insensitive)", async () => {
    expect((await createAccount(signupSchema.parse(valid))).ok).toBe(true);
    expect(await createAccount(signupSchema.parse({ ...valid, handle: `${MARK}outra`, email: `ANA${EMAIL_DOMAIN}` }))).toEqual({
      ok: false,
      field: "email",
    });
    expect(await createAccount(signupSchema.parse({ ...valid, handle: `${MARK}ANA`, email: `outra${EMAIL_DOMAIN}` }))).toEqual({
      ok: false,
      field: "handle",
    });
  });

  it("never logs into an account without a password (legacy Steam or Google-only)", async () => {
    await prisma.user.create({ data: { handle: `${MARK}legado`, displayName: "Legado", email: `legado${EMAIL_DOMAIN}` } });
    expect(await authenticate(`legado${EMAIL_DOMAIN}`, "")).toBeNull();
    expect(await authenticate(`legado${EMAIL_DOMAIN}`, "qualquer coisa")).toBeNull();
  });
});

describe("changePassword / changeEmail (database)", () => {
  it("asks for the current password when there is one", async () => {
    const user = await prisma.user.create({
      data: { handle: `${MARK}troca`, displayName: "Troca", email: `troca${EMAIL_DOMAIN}`, passwordHash: await hashPassword("senha antiga") },
    });
    expect(await changePassword(user.id, "errada!!", "senha nova 1")).toEqual({ ok: false, reason: "wrong_password" });
    expect(await changePassword(user.id, "senha antiga", "senha nova 1")).toEqual({ ok: true });
    expect(await authenticate(`troca${EMAIL_DOMAIN}`, "senha nova 1")).not.toBeNull();
    expect(await authenticate(`troca${EMAIL_DOMAIN}`, "senha antiga")).toBeNull();

    expect(await changeEmail(user.id, `nova${EMAIL_DOMAIN}`, "errada!!")).toEqual({ ok: false, reason: "wrong_password" });
    expect(await changeEmail(user.id, `nova${EMAIL_DOMAIN}`, "senha nova 1")).toEqual({ ok: true, changed: true });
    expect(await authenticate(`nova${EMAIL_DOMAIN}`, "senha nova 1")).not.toBeNull();
  });

  it("lets an account without a password define one, and refuses an e-mail of someone else", async () => {
    await prisma.user.create({ data: { handle: `${MARK}dono`, displayName: "Dono", email: `dono${EMAIL_DOMAIN}` } });
    const user = await prisma.user.create({ data: { handle: `${MARK}semsenha`, displayName: "Sem senha" } });
    expect(await changeEmail(user.id, `DONO${EMAIL_DOMAIN}`, undefined)).toEqual({ ok: false, reason: "email_taken" });
    expect(await changeEmail(user.id, `semsenha${EMAIL_DOMAIN}`, undefined)).toEqual({ ok: true, changed: true });
    expect(await changePassword(user.id, undefined, "primeira senha")).toEqual({ ok: true });
    expect(await authenticate(`semsenha${EMAIL_DOMAIN}`, "primeira senha")).not.toBeNull();
  });

  it("a new e-mail starts unconfirmed; saving the same one keeps the confirmation", async () => {
    const verifiedAt = new Date("2026-10-30T12:00:00Z");
    const user = await prisma.user.create({
      data: { handle: `${MARK}conf`, displayName: "Conf", email: `conf${EMAIL_DOMAIN}`, emailVerifiedAt: verifiedAt },
    });
    expect(await changeEmail(user.id, ` CONF${EMAIL_DOMAIN} `, undefined)).toEqual({ ok: true, changed: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toEqual(verifiedAt);
    expect(await changeEmail(user.id, `conf2${EMAIL_DOMAIN}`, undefined)).toEqual({ ok: true, changed: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeNull();
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";

const { prisma } = await import("@/lib/db");
const { inviteUser } = await import("./invite");
const { resetPassword } = await import("./password-reset");
const { authenticate } = await import("./credentials");

const MARK = "tinvite_";

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: MARK } } });
}
beforeEach(cleanup);
afterAll(cleanup);

describe("inviteUser (database)", () => {
  it("sets the e-mail of an account without credentials and returns a set-password link", async () => {
    const admin = await prisma.user.create({ data: { handle: `${MARK}MrDead`, displayName: "MrDead", role: "admin", steamId: "76561198000099101" } });
    const result = await inviteUser(`@${MARK}mrdead`, " MrDead@Exemplo.com ");
    expect(result).toMatchObject({ ok: true, handle: `${MARK}MrDead`, email: "mrdead@exemplo.com" });
    if (!result.ok) return;
    const token = new URL(result.link).searchParams.get("token")!;
    expect(new URL(result.link).pathname).toBe("/redefinir-senha");

    expect(await resetPassword(token, "senha do admin")).toEqual({ ok: true, userId: admin.id });
    expect((await authenticate("mrdead@exemplo.com", "senha do admin"))?.role).toBe("admin");
  });

  it("refuses an unknown handle, an invalid e-mail and an e-mail of another account", async () => {
    await prisma.user.create({ data: { handle: `${MARK}a`, displayName: "A", email: "a@exemplo.com" } });
    await prisma.user.create({ data: { handle: `${MARK}b`, displayName: "B" } });
    expect(await inviteUser(`${MARK}ninguem`, "x@exemplo.com")).toEqual({ ok: false, reason: "not_found" });
    expect(await inviteUser(`${MARK}b`, "nao-e-email")).toEqual({ ok: false, reason: "invalid_email" });
    expect(await inviteUser(`${MARK}b`, "A@exemplo.com")).toEqual({ ok: false, reason: "email_taken" });
  });
});

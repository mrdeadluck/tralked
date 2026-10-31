import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = await import("@/lib/db");
const { authenticate } = await import("./credentials");
const { hashPassword } = await import("./password");
const { createPasswordResetToken, isResetTokenValid, passwordResetLink, requestPasswordReset, resetPassword, RESET_TTL_MS } =
  await import("./password-reset");

const MARK = "treset_";
const DOMAIN = "@reset.test";
const T0 = new Date("2026-10-31T12:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: MARK } } });
}
beforeEach(cleanup);
afterAll(cleanup);

const newUser = async (suffix: string, password?: string) =>
  prisma.user.create({
    data: {
      handle: `${MARK}${suffix}`,
      displayName: suffix,
      email: `${suffix}${DOMAIN}`,
      passwordHash: password ? await hashPassword(password) : null,
    },
  });

describe("password reset tokens (database)", () => {
  it("stores only the SHA-256 of a random token and builds the /redefinir-senha link", async () => {
    const user = await newUser("hash");
    const token = await createPasswordResetToken(user.id, T0);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(rows[0].tokenHash).not.toContain(token);
    expect(rows[0].expiresAt).toEqual(later(RESET_TTL_MS));
    expect(new URL(passwordResetLink(token)).pathname).toBe("/redefinir-senha");
    expect(new URL(passwordResetLink(token)).searchParams.get("token")).toBe(token);
  });

  it("sets the new password once: single use, and the account's other links stop working", async () => {
    const user = await newUser("uso", "senha antiga");
    const first = await createPasswordResetToken(user.id, T0);
    const second = await createPasswordResetToken(user.id, T0);
    expect(await isResetTokenValid(first, later(1000))).toBe(true);

    expect(await resetPassword(first, "senha nova 1", later(1000))).toEqual({ ok: true, userId: user.id, handle: user.handle });
    expect(await authenticate(`uso${DOMAIN}`, "senha nova 1")).not.toBeNull();
    expect(await authenticate(`uso${DOMAIN}`, "senha antiga")).toBeNull();

    expect(await isResetTokenValid(first, later(2000))).toBe(false);
    expect(await resetPassword(first, "outra senha 2", later(2000))).toEqual({ ok: false });
    expect(await resetPassword(second, "outra senha 2", later(2000))).toEqual({ ok: false });
  });

  it("refuses an expired, unknown or malformed token", async () => {
    const user = await newUser("expira");
    const token = await createPasswordResetToken(user.id, T0);
    expect(await isResetTokenValid(token, later(RESET_TTL_MS))).toBe(false);
    expect(await resetPassword(token, "senha nova 1", later(RESET_TTL_MS + 1))).toEqual({ ok: false });
    expect(await resetPassword("nao-existe", "senha nova 1", T0)).toEqual({ ok: false });
    expect(await isResetTokenValid("", T0)).toBe(false);
  });

  it("requestPasswordReset creates a link only for a registered e-mail and logs it outside production", async () => {
    const user = await newUser("pedido");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await requestPasswordReset(`  PEDIDO${DOMAIN} `, T0);
      await requestPasswordReset(`ninguem${DOMAIN}`, T0);
      expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);
      expect(info).toHaveBeenCalledTimes(1);
      expect(String(info.mock.calls[0][0])).toMatch(/\/redefinir-senha\?token=[A-Za-z0-9_-]{43}/);
    } finally {
      info.mockRestore();
    }
  });

  it("in production without RESEND_API_KEY creates no link and prints none", async () => {
    const user = await newUser("semchave");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    try {
      await requestPasswordReset(`semchave${DOMAIN}`, T0);
      expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);
      expect(info).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      info.mockRestore();
    }
  });
});

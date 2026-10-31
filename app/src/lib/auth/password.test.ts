import { describe, expect, it } from "vitest";
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN, verifyPassword } from "./password";

describe("password hashing (scrypt)", () => {
  it("verifies the right password and refuses a wrong one", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("never stores the password itself and salts every hash", async () => {
    const a = await hashPassword("senha-secreta-1");
    const b = await hashPassword("senha-secreta-1");
    expect(a).not.toContain("senha-secreta-1");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it("uses a strong work factor (N >= 2^15, 64-byte key, 16-byte salt)", async () => {
    const [, n, r, p, salt, key] = (await hashPassword("abcdefgh")).split("$");
    expect(Number(n)).toBeGreaterThanOrEqual(2 ** 15);
    expect(Number(r)).toBeGreaterThanOrEqual(8);
    expect(Number(p)).toBeGreaterThanOrEqual(1);
    expect(Buffer.from(salt, "base64")).toHaveLength(16);
    expect(Buffer.from(key, "base64")).toHaveLength(64);
  });

  it("answers false (never throws) for a missing or malformed stored hash", async () => {
    expect(await verifyPassword("whatever1", null)).toBe(false);
    expect(await verifyPassword("whatever1", "")).toBe(false);
    expect(await verifyPassword("whatever1", "plain-text-password")).toBe(false);
    expect(await verifyPassword("whatever1", "scrypt$abc$8$1$AAAA$BBBB")).toBe(false);
    // Absurd parameters would burn CPU/memory: refused before hashing.
    expect(await verifyPassword("whatever1", `scrypt$${2 ** 30}$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA`)).toBe(false);
  });

  it("keeps the documented length limits", () => {
    expect(PASSWORD_MIN).toBe(8);
    expect(PASSWORD_MAX).toBe(128);
  });
});

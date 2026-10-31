import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const cookieSet = vi.fn((name: string, value: string) => void store.set(name, value));
const cookieDelete = vi.fn((name: string) => void store.delete(name));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
    set: cookieSet,
    delete: cookieDelete,
  }),
}));

const { OID_STATE_COOKIE, consumeOidState, createOidState } = await import("./oid-state");

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("oid state", () => {
  it("sets a short-lived httpOnly lax cookie holding a random nonce", async () => {
    const state = await createOidState();
    const another = await createOidState();
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(another).not.toBe(state);

    const [name, value, options] = cookieSet.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(name).toBe(OID_STATE_COOKIE);
    expect(OID_STATE_COOKIE).toBe("gl_oid_state");
    expect(value).toBe(state);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  });

  it("accepts the matching state once and clears the cookie", async () => {
    const state = await createOidState();
    await expect(consumeOidState(state)).resolves.toBe(true);
    expect(cookieDelete).toHaveBeenCalledWith(OID_STATE_COOKIE);
    await expect(consumeOidState(state)).resolves.toBe(false);
  });

  it("rejects mismatched, missing and cookie-less states (still clearing the cookie)", async () => {
    await createOidState();
    await expect(consumeOidState("something-else")).resolves.toBe(false);
    expect(store.has(OID_STATE_COOKIE)).toBe(false);

    await createOidState();
    await expect(consumeOidState(null)).resolves.toBe(false);

    await expect(consumeOidState("anything")).resolves.toBe(false);
  });
});

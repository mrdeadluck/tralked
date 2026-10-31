import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = await import("@/lib/db");
const { confirmSubscription, newsletterToken, RESEND_WINDOW_MS, subscribe } = await import("./subscribe");
const { subscribeNewsletterAction } = await import("./actions");

const EMAIL = "t11-leitora@exemplo.com";
const OTHER = "t11-outra@exemplo.com";

async function cleanup() {
  await prisma.newsletterSubscriber.deleteMany({ where: { email: { in: [EMAIL, OTHER] } } });
}

beforeEach(cleanup);
afterAll(cleanup);

describe("newsletter double opt-in", () => {
  it("stores the address unconfirmed and logs the confirmation link (simulated e-mail)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await subscribeNewsletterAction({ email: `  ${EMAIL.toUpperCase()} ` });
    expect(result).toEqual({ ok: true, email: EMAIL });
    const row = await prisma.newsletterSubscriber.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(row.confirmedAt).toBeNull();
    expect(info).toHaveBeenCalledTimes(1);
    const logged = String(info.mock.calls[0][0]);
    expect(logged).toContain("/newsletter/confirmar?");
    expect(logged).toContain(`token=${newsletterToken(EMAIL)}`);
    info.mockRestore();
  });

  it("refuses malformed input without writing", async () => {
    for (const input of [{ email: "não é e-mail" }, { email: "" }, { email: `${"a".repeat(250)}@x.com` }, "x", { email: EMAIL, extra: 1 }]) {
      expect(await subscribeNewsletterAction(input)).toMatchObject({ ok: false });
    }
    expect(await prisma.newsletterSubscriber.count({ where: { email: EMAIL } })).toBe(0);
  });

  it("sends at most one confirmation per address in the resend window", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const t0 = 1_000_000;
    expect(await subscribe(OTHER, t0)).toBe(true);
    expect(await subscribe(OTHER, t0 + 1000)).toBe(false);
    expect(await subscribe(OTHER, t0 + RESEND_WINDOW_MS + 1)).toBe(true);
    expect(await prisma.newsletterSubscriber.count({ where: { email: OTHER } })).toBe(1);
    info.mockRestore();
  });

  it("confirms only with the token of that address", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await subscribe(EMAIL);
    await subscribe(OTHER);
    expect(await confirmSubscription(EMAIL, newsletterToken(OTHER))).toBe("invalid");
    expect(await confirmSubscription(EMAIL, "abc")).toBe("invalid");
    expect(await confirmSubscription(EMAIL, undefined)).toBe("invalid");
    expect(await confirmSubscription("t11-ninguem@exemplo.com", newsletterToken("t11-ninguem@exemplo.com"))).toBe("invalid");
    expect(await confirmSubscription(EMAIL, newsletterToken(EMAIL))).toBe("confirmed");
    expect(await confirmSubscription(EMAIL, newsletterToken(EMAIL))).toBe("already");
    const rows = await prisma.newsletterSubscriber.findMany({ where: { email: { in: [EMAIL, OTHER] } }, orderBy: { email: "asc" } });
    expect(rows.map((r) => [r.email, r.confirmedAt !== null])).toEqual([
      [EMAIL, true],
      [OTHER, false],
    ]);
    vi.restoreAllMocks();
  });
});

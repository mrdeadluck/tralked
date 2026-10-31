import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const ip = vi.hoisted(() => ({ value: "203.0.113.1" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": `${ip.value}, 10.0.0.1` }),
}));
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect }));
const afterTasks = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<void>) => afterTasks.push(task),
}));
const runAfterTasks = async () => {
  for (const task of afterTasks.splice(0)) await task();
};

const { prisma } = await import("@/lib/db");
const { checkToken, confirmSubscription, newsletterToken, RESEND_WINDOW_MS, subscribe, TOKEN_TTL_DAYS } = await import(
  "./subscribe"
);
const { confirmNewsletterAction, subscribeNewsletterAction } = await import("./actions");

const EMAIL = "t11-leitora@exemplo.com";
const OTHER = "t11-outra@exemplo.com";
const DAY = 86_400_000;
let ipSeq = 0;

async function cleanup() {
  await prisma.newsletterSubscriber.deleteMany({ where: { email: { in: [EMAIL, OTHER] } } });
}

beforeEach(async () => {
  await cleanup();
  afterTasks.length = 0;
  ip.value = `203.0.113.${++ipSeq}`;
  vi.restoreAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterAll(cleanup);

describe("newsletter sign-up", () => {
  it("stores the address unconfirmed and logs the confirmation link (simulated e-mail outside production)", async () => {
    const result = await subscribeNewsletterAction({ email: `  ${EMAIL.toUpperCase()} ` });
    expect(result).toEqual({ ok: true, email: EMAIL, delivery: "sent" });
    const row = await prisma.newsletterSubscriber.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(row.confirmedAt).toBeNull();
    // Sent after the response: the answer never waits on (or reveals) the e-mail.
    expect(console.info).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(1);
    await runAfterTasks();
    const logged = String(vi.mocked(console.info).mock.calls[0][0]);
    expect(logged).toContain("/newsletter/confirmar?");
    const token = new URL(logged.slice(logged.indexOf("http"))).searchParams.get("token");
    expect(checkToken(EMAIL, token)).toEqual({ status: "valid", email: EMAIL });
  });

  it("in production, without an e-mail provider, only registers (and says so)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(await subscribeNewsletterAction({ email: EMAIL })).toEqual({ ok: true, email: EMAIL, delivery: "registered" });
      expect(afterTasks).toHaveLength(0);
      expect(console.info).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses malformed input without writing", async () => {
    for (const input of [{ email: "não é e-mail" }, { email: "" }, { email: `${"a".repeat(250)}@x.com` }, "x", { email: EMAIL, extra: 1 }]) {
      expect(await subscribeNewsletterAction(input)).toMatchObject({ ok: false });
    }
    expect(await prisma.newsletterSubscriber.count({ where: { email: EMAIL } })).toBe(0);
  });

  it("limits sign-ups per IP address", async () => {
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await subscribeNewsletterAction({ email: i % 2 ? EMAIL : OTHER }));
    expect(results.slice(0, 5).every((r) => r.ok)).toBe(true);
    expect(results[5]).toMatchObject({ ok: false, error: expect.stringContaining("Muitas inscrições") });
    ip.value = "198.51.100.7";
    expect(await subscribeNewsletterAction({ email: EMAIL })).toMatchObject({ ok: true });
  });

  it("sends at most one confirmation per address in the resend window", async () => {
    // Later than any send made by the other tests (the window is kept in memory).
    const t0 = Date.now() + DAY;
    expect(await subscribe(OTHER, t0)).toBe(true);
    expect(await subscribe(OTHER, t0 + 1000)).toBe(false);
    expect(await subscribe(OTHER, t0 + RESEND_WINDOW_MS + 1)).toBe(true);
    expect(await prisma.newsletterSubscriber.count({ where: { email: OTHER } })).toBe(1);
  });
});

describe("newsletter confirmation", () => {
  it("only the token of that address, within 7 days, confirms", async () => {
    const now = Date.now();
    await subscribe(EMAIL, now);
    await subscribe(OTHER, now);
    expect(await confirmSubscription(EMAIL, newsletterToken(OTHER, now), now)).toBe("invalid");
    expect(await confirmSubscription(EMAIL, "abc", now)).toBe("invalid");
    expect(await confirmSubscription(EMAIL, undefined, now)).toBe("invalid");
    expect(await confirmSubscription("t11-ninguem@exemplo.com", newsletterToken("t11-ninguem@exemplo.com", now), now)).toBe(
      "invalid",
    );
    const token = newsletterToken(EMAIL, now);
    // A tampered expiry breaks the signature.
    const [exp, mac] = token.split(".");
    expect(await confirmSubscription(EMAIL, `${Number(exp) + 999999}.${mac}`, now)).toBe("invalid");
    expect(await confirmSubscription(EMAIL, token, now + (TOKEN_TTL_DAYS + 1) * DAY)).toBe("expired");
    expect(await confirmSubscription(EMAIL, token, now + (TOKEN_TTL_DAYS - 1) * DAY)).toBe("confirmed");
    expect(await confirmSubscription(EMAIL, token, now)).toBe("already");
    const rows = await prisma.newsletterSubscriber.findMany({ where: { email: { in: [EMAIL, OTHER] } }, orderBy: { email: "asc" } });
    expect(rows.map((r) => [r.email, r.confirmedAt !== null])).toEqual([
      [EMAIL, true],
      [OTHER, false],
    ]);
  });

  it("checking the link (GET) never confirms; the POST action does and redirects with the result", async () => {
    await subscribe(EMAIL);
    const token = newsletterToken(EMAIL);
    expect(checkToken(EMAIL, token)).toMatchObject({ status: "valid" });
    expect((await prisma.newsletterSubscriber.findUniqueOrThrow({ where: { email: EMAIL } })).confirmedAt).toBeNull();

    const form = new FormData();
    form.set("email", EMAIL);
    form.set("token", token);
    await expect(confirmNewsletterAction(form)).rejects.toThrow("NEXT_REDIRECT /newsletter/confirmar?resultado=confirmed");
    expect((await prisma.newsletterSubscriber.findUniqueOrThrow({ where: { email: EMAIL } })).confirmedAt).not.toBeNull();

    const bad = new FormData();
    bad.set("email", EMAIL);
    await expect(confirmNewsletterAction(bad)).rejects.toThrow("resultado=invalid");
  });
});

describe("account deletion", () => {
  it("removes the subscription even when the account e-mail has another case", async () => {
    const { deleteAccount } = await import("@/lib/accounts/delete");
    const user = await prisma.user.create({ data: { handle: "t11-news-del", displayName: "X", email: "  T11-Leitora@Exemplo.com " } });
    await prisma.newsletterSubscriber.create({ data: { email: EMAIL } });
    await deleteAccount(user.id);
    expect(await prisma.newsletterSubscriber.count({ where: { email: EMAIL } })).toBe(0);
  });
});

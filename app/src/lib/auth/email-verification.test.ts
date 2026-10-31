import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect }));

const { prisma } = await import("@/lib/db");
const {
  checkEmailVerificationToken,
  confirmEmail,
  emailVerificationLink,
  emailVerificationToken,
  sendEmailConfirmation,
  sendWelcomeEmail,
  VERIFY_TTL_DAYS,
} = await import("./email-verification");
const { confirmEmailAction } = await import("./email-actions");

const MARK = "tverify_";
const DAY = 86_400_000;

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: MARK } } });
}
beforeEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterAll(cleanup);

const newUser = (suffix: string, email: string | null = `${suffix}@verify.test`) =>
  prisma.user.create({ data: { handle: `${MARK}${suffix}`, displayName: `Ana ${suffix}`, email } });

describe("e-mail confirmation link", () => {
  it("confirms the account's current e-mail once, within 7 days", async () => {
    const user = await newUser("ok");
    const now = Date.now();
    const token = emailVerificationToken(user.id, user.email!, now);
    expect(new URL(emailVerificationLink(user.id, user.email!, now)).pathname).toBe("/confirmar-email");

    // Checking (GET) changes nothing.
    expect(await checkEmailVerificationToken(token, now)).toMatchObject({ status: "valid", userId: user.id, email: user.email });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeNull();

    expect(await confirmEmail(token, now + (VERIFY_TTL_DAYS + 1) * DAY)).toBe("expired");
    expect(await confirmEmail(token, now + DAY)).toBe("confirmed");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeInstanceOf(Date);
    expect(await confirmEmail(token, now + DAY)).toBe("already");
  });

  it("refuses forged, tampered, other-user and stale (e-mail changed) links", async () => {
    const user = await newUser("forja");
    const other = await newUser("outra");
    const now = Date.now();
    const token = emailVerificationToken(user.id, user.email!, now);
    const [id, exp, mac] = token.split(".");
    for (const bad of [undefined, "", "abc", `${id}.${Number(exp) + 999}.${mac}`, `${other.id}.${exp}.${mac}`, `${id}.${exp}.${"A".repeat(43)}`]) {
      expect(await confirmEmail(bad, now)).toBe("invalid");
    }
    // A link for another address of the same account (forged with the wrong e-mail).
    expect(await confirmEmail(emailVerificationToken(user.id, "x@verify.test", now), now)).toBe("invalid");

    await prisma.user.update({ where: { id: user.id }, data: { email: "nova@verify.test" } });
    expect(await confirmEmail(token, now)).toBe("invalid");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeNull();
  });

  it("the page's POST action confirms and redirects with the result", async () => {
    const user = await newUser("acao");
    const form = new FormData();
    form.set("token", emailVerificationToken(user.id, user.email!));
    await expect(confirmEmailAction(form)).rejects.toThrow("NEXT_REDIRECT /confirmar-email?resultado=confirmed");
    await expect(confirmEmailAction(new FormData())).rejects.toThrow("resultado=invalid");
  });
});

describe("confirmation and welcome e-mails", () => {
  it("sends the confirmation to the current e-mail, never to a confirmed or missing one", async () => {
    const user = await newUser("envio");
    expect(await sendEmailConfirmation(user.id)).toBe("logged");
    const logged = String(vi.mocked(console.info).mock.calls[0][0]);
    expect(logged).toContain(`email-confirmation para envio@verify.test`);
    const link = new URL(logged.slice(logged.indexOf("http")));
    expect(await confirmEmail(link.searchParams.get("token"))).toBe("confirmed");

    expect(await sendEmailConfirmation(user.id)).toBe("already");
    expect(await sendEmailConfirmation((await newUser("semmail", null)).id)).toBe("no_email");
    expect(console.info).toHaveBeenCalledTimes(1);
  });

  it("the welcome carries the confirmation link only while the e-mail is unconfirmed", async () => {
    const user = await newUser("bemvindo");
    expect(await sendWelcomeEmail(user.id)).toBe("logged");
    expect(String(vi.mocked(console.info).mock.calls[0][0])).toMatch(/welcome para .*\/confirmar-email\?token=/);
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    expect(await sendWelcomeEmail(user.id)).toBe("logged");
    expect(String(vi.mocked(console.info).mock.calls[1][0])).toMatch(/welcome para .*\/conta\/conexoes$/);
  });

  it("in production without RESEND_API_KEY nothing is sent", async () => {
    const user = await newUser("prod");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(await sendEmailConfirmation(user.id)).toBe("unavailable");
      expect(console.info).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

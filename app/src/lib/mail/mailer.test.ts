import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mailAvailable, mailMode, RESEND_ENDPOINT, sendMail, type MailConfig, type MailMessage } from "./mailer";
import {
  emailConfirmationEmail,
  escapeHtml,
  newsletterConfirmationEmail,
  passwordResetEmail,
  welcomeEmail,
} from "./templates";

const LINK = "http://localhost:3000/redefinir-senha?token=abc";
const message: MailMessage = passwordResetEmail("leitora@exemplo.com", LINK);
const FROM = "Tralked <no-reply@tralked.com>";

afterEach(() => vi.restoreAllMocks());

describe("mail mode", () => {
  it("uses Resend with a key, the dev log without one, and is off in production without one", () => {
    expect(mailMode({ apiKey: "re_x", from: FROM, production: true })).toBe("resend");
    expect(mailMode({ apiKey: "re_x", from: FROM, production: false })).toBe("resend");
    expect(mailMode({ from: FROM, production: false })).toBe("log");
    expect(mailMode({ from: FROM, production: true })).toBe("off");
    expect(mailAvailable({ from: FROM, production: true })).toBe(false);
    expect(mailAvailable({ from: FROM, production: false })).toBe(true);
  });
});

describe("sendMail", () => {
  it("posts to Resend with the key, a User-Agent, the idempotency key, html and text", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: "49a3999c" }), { status: 200 }));
    const config: MailConfig = { apiKey: "re_test_123", from: FROM, production: true, fetch };
    const status = await sendMail({ ...message, idempotencyKey: "welcome/u1" }, config);
    expect(status).toBe("sent");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_123");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["User-Agent"]).toMatch(/^Tralked\//);
    expect(headers["Idempotency-Key"]).toBe("welcome/u1");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: FROM, to: ["leitora@exemplo.com"], subject: message.subject });
    expect(body.html).toContain(LINK);
    expect(body.text).toContain(LINK);
    expect(body.tags).toEqual([{ name: "category", value: "password-reset" }]);
  });

  it("reports a refusal without logging the key or the link", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ name: "validation_error", message: "x" }), { status: 422 }),
    );
    expect(await sendMail(message, { apiKey: "re_secret", from: FROM, production: true, fetch })).toBe("failed");
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("422");
    expect(logged).toContain("validation_error");
    expect(logged).not.toContain("re_secret");
    expect(logged).not.toContain("token=abc");

    const offline = vi.fn(async () => {
      throw new Error("network down");
    });
    expect(await sendMail(message, { apiKey: "re_secret", from: FROM, production: true, fetch: offline })).toBe("failed");
  });

  it("outside production without a key logs the e-mail and appends it to DEV_MAIL_LOG_FILE", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const dir = mkdtempSync(path.join(os.tmpdir(), "tralked-mail-"));
    const file = path.join(dir, "mail.log");
    try {
      const fetch = vi.fn();
      expect(await sendMail(message, { from: FROM, production: false, logFile: file, fetch })).toBe("logged");
      expect(fetch).not.toHaveBeenCalled();
      expect(String(info.mock.calls[0][0])).toContain(LINK);
      expect(JSON.parse(readFileSync(file, "utf8").trim())).toEqual({
        kind: "password-reset",
        to: "leitora@exemplo.com",
        subject: message.subject,
        link: LINK,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("in production without a key sends nothing and prints no link", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.fn();
    expect(await sendMail(message, { from: FROM, production: true, fetch })).toBe("unavailable");
    expect(fetch).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).not.toContain("token=");
  });
});

describe("templates", () => {
  it("escapes what comes from users and keeps html and text in pt-BR with the link", () => {
    const evil = `<script>alert("x")</script>`;
    // Only a verified (Google) address is greeted by name.
    const named = welcomeEmail("a@b.com", { displayName: evil });
    expect(named.html).not.toContain("<script>");
    expect(named.html).toContain(escapeHtml(evil));
    expect(named.text).toContain(evil); // plain text is not HTML

    const mail = emailConfirmationEmail("a@b.com", "http://localhost:3000/confirmar-email?token=a.1.b&x=<y>");
    expect(mail.html).toContain("token=a.1.b&amp;x=&lt;y&gt;");
    expect(mail.html).toContain('lang="pt-BR"');
    expect(mail.html).not.toMatch(/<img\b/);
    expect(mail.text).toContain("Confirmar e-mail: http://localhost:3000/confirmar-email?token=a.1.b&x=<y>");
  });

  it("e-mails to an unconfirmed address greet neutrally (no display name)", () => {
    const welcome = welcomeEmail("a@b.com", { confirmLink: LINK });
    expect(welcome.text).toContain("Bem-vindo ao Tralked!");
    expect(welcome.html).toContain("Bem-vindo ao Tralked!");
    expect(emailConfirmationEmail("a@b.com", LINK).text).toContain("Oi! Confirme que a@b.com");
  });

  it("covers every transactional e-mail", () => {
    const all = [
      passwordResetEmail("a@b.com", LINK),
      emailConfirmationEmail("a@b.com", LINK),
      welcomeEmail("a@b.com", { confirmLink: LINK }),
      welcomeEmail("a@b.com", { displayName: "Ana" }),
      newsletterConfirmationEmail("a@b.com", LINK),
    ];
    for (const mail of all) {
      expect(mail.subject).toMatch(/Tralked/);
      expect(mail.html).toContain("TRAL");
      expect(mail.text).toContain("Gaming Hub");
      expect(mail.link).toMatch(/^http/);
    }
    // The Google sign-up welcome (no confirmation) points at Conexões.
    expect(all[3].link).toContain("/conta/conexoes");
    expect(all[2].link).toBe(LINK);
  });
});

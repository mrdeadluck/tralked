import { appendFileSync } from "node:fs";
import { env } from "@/lib/env";
import { timeoutSignal } from "@/lib/integrations/http";

/**
 * Transactional e-mail. Three modes, chosen per call:
 *
 * - `resend`: RESEND_API_KEY is set → POST https://api.resend.com/emails (from MAIL_FROM).
 * - `log`: no key, outside production → the e-mail goes to the server log (and, when
 *   DEV_MAIL_LOG_FILE is set, as a JSON line to that file, which the e2e tests read).
 * - `off`: production without a key → nothing is sent and nothing that could take over an
 *   account is printed; callers ask `mailAvailable()` first and tell the user e-mail is off.
 */

export type MailKind = "password-reset" | "email-confirmation" | "welcome" | "newsletter-confirmation";

export type MailMessage = {
  kind: MailKind;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** The main link of the e-mail (logged in dev, never in production). */
  link?: string;
  /** Resend's Idempotency-Key: a retry with the same key never sends twice (24 h). */
  idempotencyKey?: string;
};

/** sent: accepted by Resend; logged: dev log; unavailable: production without a key; failed: Resend refused or did not answer. */
export type MailStatus = "sent" | "logged" | "unavailable" | "failed";

export type MailConfig = {
  apiKey?: string;
  from: string;
  production: boolean;
  logFile?: string;
  fetch?: typeof fetch;
};

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
// Resend rejects requests without a User-Agent (403, error 1010).
const USER_AGENT = "Tralked/1.0 (+https://tralked.com)";

export function mailConfig(): MailConfig {
  return {
    apiKey: env.RESEND_API_KEY,
    from: env.MAIL_FROM,
    production: process.env.NODE_ENV === "production",
    logFile: process.env.DEV_MAIL_LOG_FILE?.trim() || undefined,
  };
}

export function mailMode(config: MailConfig = mailConfig()): "resend" | "log" | "off" {
  if (config.apiKey) return "resend";
  return config.production ? "off" : "log";
}

/** Whether e-mails reach someone (a real send, or the dev log). False only in production without a key. */
export function mailAvailable(config: MailConfig = mailConfig()): boolean {
  return mailMode(config) !== "off";
}

/** Sends one e-mail. Never throws: failures are logged (without links or secrets) and returned. */
export async function sendMail(message: MailMessage, config: MailConfig = mailConfig()): Promise<MailStatus> {
  const mode = mailMode(config);
  if (mode === "off") {
    console.warn(`[e-mail] RESEND_API_KEY não configurada: e-mail "${message.kind}" não enviado.`);
    return "unavailable";
  }
  if (mode === "log") {
    console.info(`[e-mail] ${message.kind} para ${message.to} · ${message.subject}${message.link ? `: ${message.link}` : ""}`);
    if (config.logFile) {
      try {
        appendFileSync(
          config.logFile,
          `${JSON.stringify({ kind: message.kind, to: message.to, subject: message.subject, link: message.link ?? null })}\n`,
        );
      } catch (error) {
        console.error("[e-mail] Could not write DEV_MAIL_LOG_FILE", error instanceof Error ? error.message : String(error));
      }
    }
    return "logged";
  }

  const fetchImpl = config.fetch ?? globalThis.fetch;
  try {
    const res = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        tags: [{ name: "category", value: message.kind.replace(/[^A-Za-z0-9_-]/g, "_") }],
      }),
      signal: timeoutSignal(),
    });
    if (!res.ok) {
      // Resend answers `{ name, message, statusCode }`; the name says what to fix (never the key).
      let name = "";
      try {
        const body = (await res.json()) as { name?: unknown };
        if (typeof body.name === "string") name = body.name.slice(0, 80);
      } catch {
        // Not JSON: the status is enough.
      }
      console.error(`[e-mail] Resend refused "${message.kind}" with HTTP ${res.status}${name ? ` (${name})` : ""}`);
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error(`[e-mail] Resend request for "${message.kind}" failed`, error instanceof Error ? error.message : String(error));
    return "failed";
  }
}

/** Whether a status means the e-mail is on its way (or in the dev log). */
export const delivered = (status: MailStatus) => status === "sent" || status === "logged";
